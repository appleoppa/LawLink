"use server";
/**
 * B3 确认与执行（docs/SYSTEM-AUDIT-REMEDIATION-V3-20260920.md §5.4/§6）：
 * 律师对整理建议逐项或批量确认——正式应用前在事务内复核人、权限与目标状态；
 * 同批无冲突建议一次确认，应用原子提交（单项失败整批回滚，可重试）。
 * AI 只准备建议；正式业务变更仅在本 action 生效。缴费类通知只建待办，不自动记财务。
 */
import { z } from "zod";
import { Prisma, type SmsSuggestion } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

type SuggestionRow = SmsSuggestion & { sms: { id: string; receivedById: string; matchedMatterId: string | null; generatedHearingId: string | null; generatedDeadlineId: string | null } };
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertCanHandleMatter, assertCanAssociateMatter } from "@/lib/permissions";
import { assertMatterWritable } from "@/lib/archive/guard";
import { revalidateMatter } from "@/server/matters/route";
import { revalidatePath } from "next/cache";
import { responsibilityReady } from "@/server/reminders/responsibility";
import { refreshScheduleReminderAfterSave } from "@/server/reminders/schedule";
import { recordTimelineEvent } from "@/server/timeline/record";
import { fileSmsInboundFilesToMatter } from "./inbound-filing";

const decisionInput = z.object({
  ids: z.array(z.string().cuid()).min(1, "请选择要处理的建议").max(50),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().max(500).optional()
});

/** 建议清单（收件人本人或案件经办可读） */
export async function listSmsSuggestions(smsId: string) {
  const session = await requireSession("matters.write");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new ActionError("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new ActionError("只能处理本人收到的来件");
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
  if (!sms) throw new ActionError("来件不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new ActionError("只能处理本人收到的来件");
    await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
  }
  const { analyzeInboundFile } = await import("./analysis");
  // 2026-09-20 P3 修复：含 ANALYZING——分析中途崩溃卡死的文件可经本入口手动重跑
  const files = await prisma.smsInboundFile.findMany({
    where: { smsId: input.smsId, ...(input.fileIds?.length ? { id: { in: input.fileIds } } : {}), state: { in: ["PENDING_REVIEW", "FILED"] }, documentId: null, analysisState: { in: ["PENDING", "ANALYZING", "FAILED", "NEEDS_OCR"] } },
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
  if (rows.length !== data.ids.length) throw new ActionError("部分建议已处理或不存在，请刷新");
  // 2026-09-20 第五轮审计 P1-2 修复：下方收件人/案件校验只基于第一条建议所属来件，
  // 混入其他来件的建议可越过对象校验（REJECTED 分支曾无任何复核即改状态）——
  // 一次只允许处理同一条来件的建议，混批直接拒绝。
  if (new Set(rows.map(r => r.smsId)).size > 1) throw new ActionError("一次只能处理同一条来件的建议");
  // 复查修复 P2-1/P3-4：findMany 无 orderBy，返回序不可靠——「归属+事项」建议同批确认时
  // 事项类若先执行会因归属未落库整批回滚；双 MATTER_MATCH 指向不同案件则事务内互相
  // 覆盖归属。MATTER_MATCH 排最前（稳定排序保持其余相对序），多条且目标不一致直接拒绝。
  const matchTargets = new Set(rows.filter(r => r.kind === "MATTER_MATCH").map(r => r.targetId));
  if (matchTargets.size > 1) throw new ActionError("本批包含指向不同案件的匹配建议，请逐条确认归属");
  const ordered = [...rows].sort((a, b) => (a.kind === "MATTER_MATCH" ? 0 : 1) - (b.kind === "MATTER_MATCH" ? 0 : 1));

  const sms = rows[0].sms;
  if (sms.receivedById !== session.user.id && !sms.matchedMatterId) throw new ActionError("只能处理本人收到的来件");
  const targetMatterId = sms.matchedMatterId ?? (rows.find(r => r.kind === "MATTER_MATCH")?.targetId ?? null);
  if (targetMatterId) await assertCanHandleMatter(session.user, targetMatterId);

  const applied = await prisma.$transaction(async tx => {
    const touchedMatters = new Set<string>();
    const createdEvents: { kind: "HEARING" | "DEADLINE"; id: string }[] = [];
    for (const row of ordered) {
      if (data.decision === "REJECTED") {
        await tx.smsSuggestion.update({ where: { id: row.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: session.user.id, decidedAt: new Date() } });
        continue;
      }
      // 应用前复核目标当前状态（条件更新 + 状态守卫）
      const fresh = await tx.smsSuggestion.findUnique({ where: { id: row.id }, select: { status: true } });
      if (fresh?.status !== "PENDING") throw new ActionError("建议已被处理，请刷新后重试");
      const applied2 = await applySuggestion(tx, row);
      await tx.smsSuggestion.update({ where: { id: row.id }, data: { status: "ACCEPTED", decidedById: session.user.id, decidedAt: new Date() } });
      if (applied2?.matterId) touchedMatters.add(applied2.matterId);
      if (applied2?.hearingId) createdEvents.push({ kind: "HEARING", id: applied2.hearingId });
      if (applied2?.deadlineId) createdEvents.push({ kind: "DEADLINE", id: applied2.deadlineId });
    }
    return { touchedMatters: [...touchedMatters], createdEvents };
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

  // 2026-09-20 第五轮审计 P2-8 修复：该来件全部建议处理完（无 PENDING 残留）时
  // 推进到 ORGANIZED（已整理）——此前该终态全仓无写入路径，确认完成后状态停在原地。
  // 复查补充：仅采纳（ACCEPTED）后推进——全部拒绝时文件可能仍未处置，标记「已整理」
  // 会掩盖待确认文件（与 markSmsProcessed 的 note 防线冲突）。
  if (data.decision === "ACCEPTED") {
    const remaining = await prisma.smsSuggestion.count({ where: { smsId: sms.id, status: "PENDING" } });
    if (remaining === 0) {
      await prisma.smsMessage.updateMany({ where: { id: sms.id, processed: false, processingState: { notIn: ["ORGANIZED", "NO_ACTION_NEEDED"] } }, data: { processingState: "ORGANIZED" } });
    }
  }

  revalidatePath("/inbox");
  // 2026-09-20 P3 修复：此前只 revalidate 最后一个案件；改逐个刷新。建开庭/期限后
  // 同步即时评估日程提醒（此前只靠 2 分钟队列补扫兜底）。
  for (const m of applied.touchedMatters) await revalidateMatter(m);
  for (const ev of applied.createdEvents) await refreshScheduleReminderAfterSave(ev.kind === "HEARING" ? "Hearing" : "Deadline", ev.id);
  return { ok: true, count: rows.length, filedFiles };
}

/** 单条建议的正式应用（事务内；调用方已做对象级权限）。返回触达案件与新建 Hearing/Deadline id。 */
async function applySuggestion(tx: Prisma.TransactionClient, row: SuggestionRow): Promise<{ matterId?: string; hearingId?: string; deadlineId?: string } | undefined> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  if (row.kind === "DOC_TYPE") return undefined; // 展示类：分析时已落 file.docType

  if (row.kind === "MATTER_MATCH") {
    if (!row.targetId) throw new ActionError("匹配建议缺少目标案件");
    // 2026-09-20 第五轮审计 P2-2 修复：内层复核此前用 associate 口径（仅主办/成员），
    // 比外层 assertCanHandleMatter 更严——合伙人确认非经办案件建议必被整批回滚。改用
    // 同口径（allowPrincipal），与外层一致，归档拦截仍由 guard 承担。
    await assertMatterWritable(row.targetId, { allowPrincipal: true });
    await tx.smsMessage.update({ where: { id: row.smsId }, data: { matchedMatterId: row.targetId, matchedBy: "MANUAL" } });
    // 私有暂存文件随即转正（同一事务外执行读取磁盘——转正在事务后补做，见 decideSmsSuggestions 尾部）
    return { matterId: row.targetId };
  }

  // 2026-09-20 P3 修复：归属与幂等守卫统一在事务内重读——同批「先确认归属、后应用
  // 开庭/字段建议」时，事务外预载快照的 matchedMatterId 仍是 null 会误拒整批。
  const smsNow = await tx.smsMessage.findUnique({ where: { id: row.smsId }, select: { matchedMatterId: true, generatedHearingId: true, generatedDeadlineId: true } });
  const matterId = smsNow?.matchedMatterId ?? null;
  if (!matterId) throw new ActionError("请先确认来件归属案件，再应用档案修正与事项建议");
  await assertMatterWritable(matterId, { allowPrincipal: true });

  if (row.kind === "FIELD_CHANGE") {
    if (!row.targetId || !row.fieldKey || !row.suggestedValue) throw new ActionError("字段建议不完整");
    const proc = await tx.matterProcedure.findUnique({ where: { id: row.targetId }, select: { matterId: true, caseNumber: true, handlingAgency: true } });
    if (!proc || proc.matterId !== matterId) throw new ActionError("目标程序不再属于本案，请刷新");
    if (!["caseNumber", "handlingAgency"].includes(row.fieldKey)) throw new ActionError(`不支持自动修正字段：${row.fieldKey}`);
    // 2026-09-20 P3 修复：复核建议时原值——建议创建后律师手工改过的案号/法院
    // 不被确认动作静默覆盖（此前无条件整串替换）。复查补充：建议值已生效（同批
    // 前一条或此前确认过同值）时跳过而非拒绝，避免同字段多条建议互相顶死无出路。
    const current = (row.fieldKey === "caseNumber" ? proc.caseNumber : proc.handlingAgency) ?? "";
    if (current === row.suggestedValue) return { matterId };
    if (current !== (row.currentValue ?? "")) {
      const label = row.fieldKey === "caseNumber" ? "案号" : "法院";
      throw new ActionError(`程序${label}在建议生成后已被修改（现为「${current || "空"}」），请重新检索生成建议`);
    }
    await tx.matterProcedure.update({ where: { id: row.targetId }, data: { [row.fieldKey]: row.suggestedValue } });
    await recordTimelineEvent(tx, { matterId, eventType: "PROCEDURE_UPDATED", title: `来件确认修正：${row.fieldKey === "caseNumber" ? "案号" : "法院"} → ${row.suggestedValue}`, occurredAt: new Date(), refType: "SmsSuggestion", refId: row.id });
    return { matterId };
  }

  if (row.kind === "HEARING") {
    // 2026-09-20 第五轮审计 P1-3 修复 + P3 合并：守卫读事务内重读（smsNow，见上文），
    // 同批两条开庭建议不再都见 null 建两个开庭；跨批时旧入口已建的开庭也让本条跳过。
    if (smsNow?.generatedHearingId) return undefined; // 幂等：同来件已建开庭不重复
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
    return { matterId, hearingId: hearing.id };
  }

  if (row.kind === "DEADLINE") {
    if (smsNow?.generatedDeadlineId) return undefined;
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
    return { matterId, deadlineId: deadline.id };
  }

  throw new ActionError(`未知建议类型：${row.kind}`);
}

async function defaultProcedureId(tx: Prisma.TransactionClient, matterId: string): Promise<string> {
  const proc = await tx.matterProcedure.findFirst({ where: { matterId, engagement: "ENGAGED" }, orderBy: { order: "asc" }, select: { id: true } });
  if (!proc) throw new ActionError("本案还没有代理程序，请先建立程序再确认事项建议");
  return proc.id;
}

function parseDateTime(dateText: string, timeText: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
  if (!m) throw new ActionError(`文书日期格式无法解析：${dateText}，请人工核对后手工登记`);
  // 2026-09-20 P3 修复：时刻存在但格式不合法时不再静默回退 09:00（开庭时刻可能错），
  // 抛错让律师人工核对；缺省（传 "09:00"）仍为合法默认。复查补充：校验范围（24:30、
  // 09:99 这类过正则的越界值此前交给 Date 构造抛底层错误）。
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!t) throw new ActionError(`文书时刻格式无法解析：${timeText}，请人工核对后手工登记`);
  const hh = Number(t[1]), mm = Number(t[2]);
  if (hh > 23 || mm > 59) throw new ActionError(`文书时刻越界：${timeText}，请人工核对后手工登记`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);
}
