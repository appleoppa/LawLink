"use server";
/**
 * B3 确认与执行（docs/SYSTEM-AUDIT-REMEDIATION-V3-20260920.md §5.4/§6）：
 * 律师对整理建议逐项或批量确认——正式应用前在事务内复核人、权限与目标状态；
 * 同批无冲突建议一次确认，应用原子提交（单项失败整批回滚，可重试）。
 * AI 只准备建议；正式业务变更仅在本 action 生效。缴费类通知只建待办，不自动记财务。
 */
import { z } from "zod";
import { Prisma, type SmsSuggestion } from "@prisma/client";

type SuggestionRow = SmsSuggestion & { sms: { id: string; receivedById: string; matchedMatterId: string | null; generatedHearingId: string | null; generatedDeadlineId: string | null } };
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertCanHandleMatter, assertCanAssociateMatter } from "@/lib/permissions";
import { assertMatterWritable } from "@/lib/archive/guard";
import { revalidateMatter } from "@/server/matters/route";
import { revalidatePath } from "next/cache";
import { responsibilityReady } from "@/server/reminders/responsibility";
import { recordTimelineEvent } from "@/server/timeline/record";
import { fileSmsInboundFilesToMatter } from "./actions";

const decisionInput = z.object({
  ids: z.array(z.string().cuid()).min(1, "请选择要处理的建议").max(50),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().max(500).optional()
});

/** 建议清单（收件人本人或案件经办可读） */
export async function listSmsSuggestions(smsId: string) {
  const session = await requireSession("matters.write");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new Error("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new Error("只能处理本人收到的来件");
    await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
  }
  return prisma.smsSuggestion.findMany({
    where: { smsId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: { file: { select: { originalName: true, displayName: true, docType: true, analysisState: true } } }
  });
}

/** 分析触发入口（取件后手动/队列调用共用；对象级权限与列表一致） */
export async function analyzeSmsInboundFiles(input: { smsId: string; fileIds?: string[] }) {
  const session = await requireSession("matters.write");
  const sms = await prisma.smsMessage.findUnique({ where: { id: input.smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new Error("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new Error("只能处理本人收到的来件");
    await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
  }
  const { analyzeInboundFile } = await import("./analysis");
  const files = await prisma.smsInboundFile.findMany({
    where: { smsId: input.smsId, ...(input.fileIds?.length ? { id: { in: input.fileIds } } : {}), state: { in: ["PENDING_REVIEW", "FILED"] } },
    select: { id: true }
  });
  const results: { fileId: string; state: string; suggestionCount: number }[] = [];
  for (const f of files) results.push({ fileId: f.id, ...(await analyzeInboundFile(f.id)) });
  revalidatePath("/inbox");
  return { ok: true, results };
}

export async function decideSmsSuggestions(input: z.input<typeof decisionInput>) {
  const data = decisionInput.parse(input);
  const session = await requireSession("matters.write");
  const rows = await prisma.smsSuggestion.findMany({
    where: { id: { in: data.ids }, status: "PENDING" },
    include: { sms: { select: { id: true, receivedById: true, matchedMatterId: true, generatedHearingId: true, generatedDeadlineId: true } } }
  });
  if (rows.length !== data.ids.length) throw new Error("部分建议已处理或不存在，请刷新");

  const sms = rows[0].sms;
  if (sms.receivedById !== session.user.id && !sms.matchedMatterId) throw new Error("只能处理本人收到的来件");
  const targetMatterId = sms.matchedMatterId ?? (rows.find(r => r.kind === "MATTER_MATCH")?.targetId ?? null);
  if (targetMatterId) await assertCanHandleMatter(session.user, targetMatterId);

  const applied = await prisma.$transaction(async tx => {
    let matterTouched: string | null = null;
    for (const row of rows) {
      if (data.decision === "REJECTED") {
        await tx.smsSuggestion.update({ where: { id: row.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: session.user.id, decidedAt: new Date() } });
        continue;
      }
      // 应用前复核目标当前状态（条件更新 + 状态守卫）
      const fresh = await tx.smsSuggestion.findUnique({ where: { id: row.id }, select: { status: true } });
      if (fresh?.status !== "PENDING") throw new Error("建议已被处理，请刷新后重试");
      await applySuggestion(tx, row);
      await tx.smsSuggestion.update({ where: { id: row.id }, data: { status: "ACCEPTED", decidedById: session.user.id, decidedAt: new Date() } });
      if (row.kind === "MATTER_MATCH" && row.targetId) matterTouched = row.targetId;
      if (row.kind !== "MATTER_MATCH" && sms.matchedMatterId) matterTouched = sms.matchedMatterId;
    }
    return matterTouched;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

  await audit({
    userId: session.user.id,
    action: data.decision === "ACCEPTED" ? "SMS_SUGGESTIONS_APPLIED" : "SMS_SUGGESTIONS_REJECTED",
    targetType: "SmsMessage",
    targetId: sms.id,
    detail: { ids: data.ids, note: data.note }
  });

  // MATTER_MATCH 应用后补做文件转正（读盘属事务外 IO；失败不回滚匹配，文件可单独重试转正）
  const matched = rows.find(r => r.kind === "MATTER_MATCH" && r.targetId);
  let filedFiles = 0;
  if (data.decision === "ACCEPTED" && matched?.targetId) {
    filedFiles = await fileSmsInboundFilesToMatter({ smsId: sms.id, matterId: matched.targetId, userId: session.user.id });
  }

  revalidatePath("/inbox");
  if (applied) await revalidateMatter(applied);
  return { ok: true, count: rows.length, filedFiles };
}

/** 单条建议的正式应用（事务内；调用方已做对象级权限） */
async function applySuggestion(tx: Prisma.TransactionClient, row: SuggestionRow) {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  if (row.kind === "DOC_TYPE") return; // 展示类：分析时已落 file.docType

  if (row.kind === "MATTER_MATCH") {
    if (!row.targetId) throw new Error("匹配建议缺少目标案件");
    await assertMatterWritable(row.targetId);
    await tx.smsMessage.update({ where: { id: row.smsId }, data: { matchedMatterId: row.targetId, matchedBy: "MANUAL" } });
    // 私有暂存文件随即转正（同一事务外执行读取磁盘——转正在事务后补做，见 decideSmsSuggestions 尾部）
    return;
  }

  const matterId = row.sms.matchedMatterId;
  if (!matterId) throw new Error("请先确认来件归属案件，再应用档案修正与事项建议");
  await assertMatterWritable(matterId);

  if (row.kind === "FIELD_CHANGE") {
    if (!row.targetId || !row.fieldKey || !row.suggestedValue) throw new Error("字段建议不完整");
    const proc = await tx.matterProcedure.findUnique({ where: { id: row.targetId }, select: { matterId: true } });
    if (!proc || proc.matterId !== matterId) throw new Error("目标程序不再属于本案，请刷新");
    if (!["caseNumber", "handlingAgency"].includes(row.fieldKey)) throw new Error(`不支持自动修正字段：${row.fieldKey}`);
    await tx.matterProcedure.update({ where: { id: row.targetId }, data: { [row.fieldKey]: row.suggestedValue } });
    await recordTimelineEvent(tx, { matterId, eventType: "PROCEDURE_UPDATED", title: `来件确认修正：${row.fieldKey === "caseNumber" ? "案号" : "法院"} → ${row.suggestedValue}`, occurredAt: new Date(), refType: "SmsSuggestion", refId: row.id });
    return;
  }

  if (row.kind === "HEARING") {
    if (row.sms.generatedHearingId) return; // 幂等：同来件已建开庭不重复
    const procedureId = await defaultProcedureId(tx, matterId);
    const startsAt = parseDateTime(String(payload.dateText ?? ""), String(payload.timeText ?? "09:00"));
    const hearing = await tx.hearing.create({
      data: { procedureId, title: String(payload.title ?? "法院文书开庭"), startsAt, room: payload.note ? String(payload.note).slice(0, 200) : null }
    });
    if (await responsibilityReady(tx)) {
      await tx.$executeRaw`INSERT INTO "WorkResponsibility" (id,"workKind","targetId","matterId","assigneeId",state,"createdAt","updatedAt") SELECT gen_random_uuid(),'HEARING',${hearing.id},${matterId},COALESCE((SELECT "leadLawyerId" FROM "MatterProcedure" WHERE id=${procedureId}),"ownerId"),'OPEN',NOW(),NOW() FROM "Matter" WHERE id=${matterId}`;
    }
    await tx.smsMessage.update({ where: { id: row.smsId }, data: { generatedHearingId: hearing.id } });
    await recordTimelineEvent(tx, { matterId, eventType: "HEARING_ADDED", title: `来件确认登记开庭：${payload.title ?? ""}`, occurredAt: new Date(), refType: "Hearing", refId: hearing.id });
    return;
  }

  if (row.kind === "DEADLINE") {
    if (row.sms.generatedDeadlineId) return;
    const procedureId = await defaultProcedureId(tx, matterId);
    const dueAt = parseDateTime(String(payload.dateText ?? ""), "18:00");
    const deadline = await tx.deadline.create({
      data: { procedureId, title: String(payload.title ?? "法院文书期限"), category: "CUSTOM", dueAt, basis: `法院来件确认（${row.sourceExcerpt ?? "文书"}）` }
    });
    if (await responsibilityReady(tx)) {
      await tx.$executeRaw`INSERT INTO "WorkResponsibility" (id,"workKind","targetId","matterId","assigneeId",state,"createdAt","updatedAt") SELECT gen_random_uuid(),'DEADLINE',${deadline.id},${matterId},COALESCE((SELECT "leadLawyerId" FROM "MatterProcedure" WHERE id=${procedureId}),"ownerId"),'OPEN',NOW(),NOW() FROM "Matter" WHERE id=${matterId}`;
    }
    await tx.smsMessage.update({ where: { id: row.smsId }, data: { generatedDeadlineId: deadline.id } });
    await recordTimelineEvent(tx, { matterId, eventType: "DEADLINE_ADDED", title: `来件确认建立期限：${payload.title ?? ""}`, occurredAt: new Date(), refType: "Deadline", refId: deadline.id });
    return;
  }

  throw new Error(`未知建议类型：${row.kind}`);
}

async function defaultProcedureId(tx: Prisma.TransactionClient, matterId: string): Promise<string> {
  const proc = await tx.matterProcedure.findFirst({ where: { matterId, engagement: "ENGAGED" }, orderBy: { order: "asc" }, select: { id: true } });
  if (!proc) throw new Error("本案还没有代理程序，请先建立程序再确认事项建议");
  return proc.id;
}

function parseDateTime(dateText: string, timeText: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!m) throw new Error(`文书日期格式无法解析：${dateText}，请人工核对后手工登记`);
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim()) ?? ["09:00", "09", "00"];
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${String(t[1]).padStart(2, "0")}:${t[2]}:00+08:00`);
}
