"use server";
import { roleMutation } from "@/lib/roles/service";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { refreshScheduleReminderAfterSave } from "@/server/reminders/schedule";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAccessMatter, assertCanHandleMatter, isManager } from "@/lib/permissions";
import { parseSms, splitSmsBatch, toDate, type ParsedSms } from "@/lib/sms-parser";
import { enrichWithAi } from "@/lib/sms-parser-ai";
import { normalizeStoredParsed as normalizeStoredParsedCore, tryExtractAttachments, runSmsAttachmentExtraction, mergeAttachmentResults, needsManualFromResults } from "./extract-core";
import { fileSmsInboundFilesToMatter } from "./inbound-filing";
import { createHash } from "node:crypto";
import { deriveProcessingState } from "@/lib/sms/processing-state";
import {
  smsParseAndSaveSchema,
  smsBackfillCaseNumberSchema,
  smsListFilterSchema,
  smsMatchToMatterSchema,
  smsGenerateHearingSchema,
  smsGenerateDeadlineSchema,
  smsIdSchema
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { recordTimelineEvent } from "@/server/timeline/record";
import { storage } from "@/lib/storage";
import { sha256 } from "@/lib/storage/crypto";
import { validateUploadedFile } from "@/lib/storage/file-validator";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 解析并保存（支持批量）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function findMatchingMatter(caseNumbers: string[]): Promise<string | null> {
  if (caseNumbers.length === 0) return null;
  const proc = await prisma.matterProcedure.findFirst({
    where: {
      caseNumber: { in: caseNumbers },
      matter: { deletedAt: null }
    },
    select: { matterId: true }
  });
  return proc?.matterId ?? null;
}

function smsTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeStoredParsed(rawText: string, parsedJson: Prisma.JsonValue): ParsedSms {
  return normalizeStoredParsedCore(rawText, parsedJson);
}

export async function parseAndSaveSms(input: z.infer<typeof smsParseAndSaveSchema>) {
  const session = await requireSession("matters.write");
  const data = smsParseAndSaveSchema.parse(input);

  const messages = data.batch ? splitSmsBatch(data.rawText) : [data.rawText.trim()];
  if (messages.length === 0) throw new Error("没有可解析的内容");

  const createdIds: string[] = [];
  const duplicateCount = { value: 0 };

  let aiEnrichedCount = 0;
  for (const text of messages) {
    // B1 粘贴幂等：同一收件人同一原文只建一条（v3 §11「重复粘贴、双击不重复创建」）；
    // DB 侧 SmsMessage_receiver_text_unique 部分唯一索引兜底并发。
    const textHash = smsTextHash(text);
    const dup = await prisma.smsMessage.findFirst({
      where: { receivedById: session.user.id, rawTextHash: textHash },
      select: { id: true }
    });
    if (dup) {
      duplicateCount.value++;
      createdIds.push(dup.id);
      continue;
    }
    let parsed: ParsedSms = parseSms(text);
    if (data.useAi) {
      parsed = await enrichWithAi(text, parsed);
      if (parsed.aiEnriched) aiEnrichedCount++;
    }
    const matchedMatterId = await findMatchingMatter(parsed.caseNumbers);

    const created = await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.create({
      data: {
        rawText: text,
        rawTextHash: textHash,
        receivedById: session.user.id,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        smsType: parsed.smsType,
        matchedMatterId,
        matchedBy: matchedMatterId ? "AUTO_CASE_NUMBER" : "UNMATCHED",
        processingState: data.extractAttachments && parsed.urls.length > 0 ? "PROCESSING" : "READY_FOR_REVIEW"
      },
      select: { id: true }
    }));
    createdIds.push(created.id);

    if (data.extractAttachments && parsed.urls.length > 0) {
      const attachmentResults = await tryExtractAttachments({
        smsId: created.id,
        userId: session.user.id,
        parsed,
        matterId: matchedMatterId
      });
      if (attachmentResults.length > 0) {
        parsed = {
          ...parsed,
          attachmentResults: mergeAttachmentResults(parsed.attachmentResults, attachmentResults)
        };
        await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
          where: { id: created.id },
          data: {
            parsedJson: parsed as unknown as Prisma.InputJsonValue,
            needsManualAction: needsManualFromResults(parsed.attachmentResults),
            processingState: deriveProcessingState(parsed.attachmentResults, Boolean(matchedMatterId))
          }
        }));
        const { enqueueJob } = await import("@/server/cron/queue");
        // 同步取件有失败时入队重试（队列 25s 起指数退避；成功即止，幂等去重）
        if (attachmentResults.some(r => r.status === "FAILED")) {
          // 2026-09-20 P2-4 修复：payload 带上粘贴人，队列重试在无请求上下文的 cron 里
          // 以系统身份复跑（worker 校验 userId 必须是来件收件人），不再调用需要
          // getServerSession 的 server action 壳。
          await enqueueJob({ type: "sms.attachment_fetch", payload: { smsId: created.id, userId: session.user.id }, dedupeKey: `sms-fetch:${created.id}`, maxAttempts: 3 });
        }
        // B2：取得文件后自动入队阅读分析（AI/OCR 未配置时文件降级 NEEDS_OCR，保存与人工确认照常）
        if (attachmentResults.some(r => r.status === "DOWNLOADED")) {
          await enqueueJob({ type: "sms.file_analysis", payload: { smsId: created.id }, dedupeKey: `sms-analyze:${created.id}`, maxAttempts: 2 }).catch(err => {
            // 2026-09-20 P3 修复：入队失败不再完全静默（至少留服务端警告，可手动重跑分析）
            console.warn("[sms] 分析任务入队失败", { smsId: created.id, err: err instanceof Error ? err.message : String(err) });
          });
        }
      } else {
        await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
          where: { id: created.id },
          data: { processingState: "READY_FOR_REVIEW" }
        }));
      }
    }

    // 通知关联案件的负责人
    if (matchedMatterId) {
      const matter = await prisma.matter.findUnique({
        where: { id: matchedMatterId },
        select: { ownerId: true }
      });
      if (matter && matter.ownerId !== session.user.id) {
        await createNotification({
          userId: matter.ownerId,
          type: "SMS_ARRIVAL",
          title: "收到新法院短信",
          content: `案件收到新的法院短信，类型：${parsed.smsType ?? "未知"}`,
          href: "/inbox",
          refType: "SmsMessage",
          refId: created.id
        });
      }
    }
  }

  await audit({
    userId: session.user.id,
    action: "SMS_PARSE_SAVE",
    targetType: "SmsMessage",
    targetId: createdIds.join(","),
    detail: { count: createdIds.length - duplicateCount.value, duplicate: duplicateCount.value, batch: data.batch, useAi: data.useAi, aiEnrichedCount }
  });

  revalidatePath("/inbox");
  return { ok: true, ids: createdIds, count: createdIds.length, duplicates: duplicateCount.value, aiEnrichedCount };
}

export async function extractSmsAttachments(input: z.infer<typeof smsIdSchema>) {
  const session = await requireSession("matters.write");
  const data = smsIdSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.id },
    select: { receivedById: true, matchedMatterId: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id && !sms.matchedMatterId) {
    throw new Error("无权处理这条短信");
  }
  // 2026-09-20 第五轮审计修复 + 复查 P3-6 调整：非收件人处理已挂案件的他人来件
  // 须本案经办/合伙人（handle 口径，不再凭读可见性改写他人 SMS 记录）；收件人本人
  // 对自己来件放行（材料入卷的经办校验由下载管道内的 assertDocumentWritable 承担，
  // 非经办的收件人取件会得到明确的门禁错误而非被第一关拦死）。
  if (sms.receivedById !== session.user.id && sms.matchedMatterId) {
    await assertCanHandleMatter(session.user, sms.matchedMatterId);
  }

  // B1 先取件后匹配：未匹配案件同样取件（入私有暂存），手动「立即提取/重试」不再要求先关联案件
  const result = await runSmsAttachmentExtraction({ smsId: data.id, actor: session.user, source: "manual" });

  // 2026-09-20 P3 修复：手动提取成功后同样入队分析（此前仅粘贴路径入队，
  // 手动重试的文件永不进入阅读管道）
  if (result.count > 0) {
    const { enqueueJob } = await import("@/server/cron/queue");
    await enqueueJob({ type: "sms.file_analysis", payload: { smsId: data.id }, dedupeKey: `sms-analyze:${data.id}`, maxAttempts: 2 }).catch(err => {
      console.warn("[sms] 分析任务入队失败（可在来件详情手动重跑分析）", { smsId: data.id, err: err instanceof Error ? err.message : String(err) });
    });
  }

  revalidatePath("/inbox");
  if (result.matchedMatterId) await revalidateMatter(result.matchedMatterId);
  return { ok: true as const, count: result.count, attachmentResults: result.attachmentResults };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 列表
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function listSmsMessages(input?: z.input<typeof smsListFilterSchema>) {
  const session = await requireSession("matters.write");
  const filter = smsListFilterSchema.parse(input ?? {});

  const where: Prisma.SmsMessageWhereInput = {};
  if (filter.scope === "mine") where.receivedById = session.user.id;
  // 全所短信含他人收到的法院来件：仅合伙人岗位可列，其余账号一律回到本人收件箱
  if (filter.scope === "all" && !isManager(session.user.role)) throw new Error("仅合伙人可查看全所短信");
  if (filter.processed === "unprocessed") where.processed = false;
  if (filter.processed === "processed") where.processed = true;
  if (filter.smsType) where.smsType = filter.smsType;
  if (filter.needsManual) where.needsManualAction = true;

  return prisma.smsMessage.findMany({
    where,
    orderBy: [{ processed: "asc" }, { receivedAt: "desc" }],
    include: {
      receivedBy: { select: { id: true, name: true } },
      inboundFiles: {
        orderBy: { downloadedAt: "asc" },
        select: { id: true, originalName: true, displayName: true, mimeType: true, size: true, state: true, uploadSource: true, downloadedAt: true, documentId: true, sourceUrl: true, analysisState: true, docType: true, analysisError: true }
      },
      suggestions: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, fieldKey: true, currentValue: true, suggestedValue: true, sourcePage: true, sourceExcerpt: true, status: true, fileId: true, payload: true }
      },
      matchedMatter: {
        select: {
          id: true,
          internalCode: true,
          title: true,
          procedures: {
            where: { engagement: "ENGAGED" },
            orderBy: { order: "asc" },
            select: { id: true, type: true, customLabel: true, caseNumber: true }
          }
        }
      }
    }
  });
}

export async function getSmsMessage(id: string) {
  const session = await requireSession("matters.write");
  const row = await prisma.smsMessage.findUnique({ where: { id }, select: { receivedById: true, matchedMatterId: true } });
  if (row && row.receivedById !== session.user.id) {
    // 他人短信只有在已挂案件且本人可见该案时才可读（与 extractSmsAttachments 同口径）
    if (!row.matchedMatterId) throw new Error("无权查看他人收到的短信");
    await assertCanAccessMatter(session.user.id, session.user.role, row.matchedMatterId, session.user.rolePermissions);
  }
  return prisma.smsMessage.findUnique({
    where: { id },
    include: {
      receivedBy: { select: { id: true, name: true } },
      matchedMatter: {
        select: {
          id: true,
          internalCode: true,
          title: true,
          procedures: {
            where: { engagement: "ENGAGED" },
            orderBy: { order: "asc" },
            select: { id: true, type: true, customLabel: true, caseNumber: true }
          }
        }
      }
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 手动指派 Matter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function matchSmsToMatter(input: z.infer<typeof smsMatchToMatterSchema>) {
  const session = await requireSession("matters.write");
  const data = smsMatchToMatterSchema.parse(input);
  const sms = await prisma.smsMessage.findUnique({ where: { id: data.smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id) {
    if (!sms.matchedMatterId) throw new Error("只能处理本人收到的短信");
    // 2026-09-20 第五轮审计修复：改绑是结构性写入（影响案件档案），非收件人
    // 须本案经办/合伙人（handle 口径），不再凭读可见性放行
    await assertCanHandleMatter(session.user, sms.matchedMatterId);
  }
  if (data.matterId) {
    await assertCanHandleMatter(session.user, data.matterId);
    await assertMatterWritable(data.matterId);
  }

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
    where: { id: data.smsId },
    data: {
      matchedMatterId: data.matterId,
      matchedBy: data.matterId ? "MANUAL" : "UNMATCHED"
    }
  }));

  // B1：匹配案件后把私有来件区的暂存文件转正为正式材料（先取件后匹配的收口）
  let filedCount = 0;
  if (data.matterId) {
    filedCount = await fileSmsInboundFilesToMatter({ smsId: data.smsId, matterId: data.matterId, userId: session.user.id });
  }

  await audit({
    userId: session.user.id,
    action: "SMS_MATCH_MATTER",
    targetType: "SmsMessage",
    targetId: data.smsId,
    detail: { matterId: data.matterId, filedInboundFiles: filedCount }
  });

  revalidatePath("/inbox");
  if (data.matterId) await revalidateMatter(data.matterId);
  return { ok: true, filedFiles: filedCount };
}

/**
 * B1：人工接续补传（v3 §4.2）——需登录/验证码/暂不支持平台的来件，
 * 律师完成平台必要步骤后把下载的文件补传回同一条来件，走同一分析流程，
 * 不要求重新登记整套材料。仅来件接收人可补传；同内容幂等。
 *
 * 2026-09-20 第五轮审计 P2-7 修复：补传到已匹配来件的文件此前直接标 FILED 但
 * 未建 Document（页面显示「已入卷」而案件里没有材料，且被转正查询永久排除）；
 * 统一落 PENDING_REVIEW，经「整理建议确认 → 转正」真正入卷，与私有暂存同一动线。
 */
export async function uploadSmsInboundFile(formData: FormData) {
  const session = await requireSession("matters.write");
  const smsId = String(formData.get("smsId") ?? "");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!smsId || files.length === 0) throw new Error("请选择要补传的文件");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true, matchedMatterId: true } });
  if (!sms) throw new Error("来件不存在");
  if (sms.receivedById !== session.user.id) throw new Error("仅来件接收人可补传文件");

  const saved: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const validated = validateUploadedFile(file, { purpose: "document", maxBytes: 20 * 1024 * 1024 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = sha256(buffer);
    const storageKey = await storage.writeFile("sms-inbound", buffer);
    const res = await prisma.smsInboundFile.createMany({
      data: [{
        smsId,
        matterId: sms.matchedMatterId,
        sourceUrl: "manual-upload",
        storageKey,
        originalName: file.name,
        mimeType: validated.mimeType,
        size: buffer.length,
        sha256: hash,
        downloadedById: session.user.id,
        uploadSource: "MANUAL_UPLOAD",
        state: "PENDING_REVIEW"
      }],
      skipDuplicates: true
    });
    if (res.count) saved.push(file.name); else skipped.push(file.name);
  }
  await audit({
    userId: session.user.id,
    action: "SMS_INBOUND_FILE_UPLOAD",
    targetType: "SmsMessage",
    targetId: smsId,
    detail: { saved: saved.length, skippedDuplicates: skipped.length }
  });
  // 复查修复 P2-2：来件已匹配案件时补传文件随即转正（归属此前已确认，无需再走
  // 建议确认动线）——否则 PENDING_REVIEW 文件无任何转正出口（MATTER_MATCH 建议
  // 只在未匹配来件上产生，UI 的案件选择器也只在未匹配时渲染）。
  // 收件人非本案经办时转正会被门禁拒绝，文件保留待确认由经办律师处置。
  let filedCount = 0;
  if (saved.length > 0 && sms.matchedMatterId) {
    try {
      filedCount = await fileSmsInboundFilesToMatter({ smsId, matterId: sms.matchedMatterId, userId: session.user.id });
    } catch {
      filedCount = 0; // 留 PENDING_REVIEW：非经办收件人补传，由案件经办律师后续处置
    }
  }
  revalidatePath("/inbox");
  if (sms.matchedMatterId) await revalidateMatter(sms.matchedMatterId);
  return { ok: true, saved, skippedDuplicates: skipped, filedFiles: filedCount };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一键生成 Hearing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateHearingFromSms(input: z.infer<typeof smsGenerateHearingSchema>) {
  const session = await requireSession("matters.write");
  const data = smsGenerateHearingSchema.parse(input);
  // 幂等：同一条短信只允许生成一次开庭，双击/重放直接返回既有产物，避免重复实体与重复责任行
  const existing = await prisma.smsMessage.findUnique({ where: { id: data.smsId }, select: { generatedHearingId: true } });
  if (existing?.generatedHearingId) throw new Error("该短信已生成过开庭，请勿重复生成");

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { id: true, matterId: true }
  });
  if (!proc) throw new Error("程序不存在");
  await assertCanHandleMatter(session.user, proc.matterId);
  await assertMatterWritable(proc.matterId);

  const hearing = await roleMutation(session.user, "matters.write", async roleDb => roleDb.hearing.create({
    data: {
      procedureId: data.procedureId,
      title: data.title.trim(),
      startsAt: data.startsAt,
      room: data.room?.trim() || null,
      judge: data.judge?.trim() || null,
      notes: data.notes?.trim() || null
    }
  }));

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
    where: { id: data.smsId },
    data: {
      generatedHearingId: hearing.id,
      processed: true,
      processedAt: new Date()
    }
  }));

  await audit({
    userId: session.user.id,
    action: "SMS_GENERATE_HEARING",
    targetType: "Hearing",
    targetId: hearing.id,
    detail: { smsId: data.smsId, procedureId: data.procedureId }
  });

  revalidatePath("/inbox");
  await revalidateMatter(proc.matterId);
  await refreshScheduleReminderAfterSave("Hearing", hearing.id);
  return { ok: true, hearingId: hearing.id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一键生成 Deadline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateDeadlineFromSms(input: z.infer<typeof smsGenerateDeadlineSchema>) {
  const session = await requireSession("matters.write");
  const data = smsGenerateDeadlineSchema.parse(input);
  // 幂等：同一条短信只允许生成一次期限
  const existingDeadline = await prisma.smsMessage.findUnique({ where: { id: data.smsId }, select: { generatedDeadlineId: true } });
  if (existingDeadline?.generatedDeadlineId) throw new Error("该短信已生成过期限，请勿重复生成");

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { id: true, matterId: true }
  });
  if (!proc) throw new Error("程序不存在");
  await assertCanHandleMatter(session.user, proc.matterId);
  await assertMatterWritable(proc.matterId);

  const deadline = await roleMutation(session.user, "matters.write", async roleDb => roleDb.deadline.create({
    data: {
      procedureId: data.procedureId,
      title: data.title.trim(),
      category: data.category,
      dueAt: data.dueAt,
      basis: data.basis?.trim() || null,
      remindDays: data.remindDays
    }
  }));

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
    where: { id: data.smsId },
    data: {
      generatedDeadlineId: deadline.id,
      processed: true,
      processedAt: new Date()
    }
  }));

  await audit({
    userId: session.user.id,
    action: "SMS_GENERATE_DEADLINE",
    targetType: "Deadline",
    targetId: deadline.id,
    detail: { smsId: data.smsId, procedureId: data.procedureId }
  });

  revalidatePath("/inbox");
  await revalidateMatter(proc.matterId);
  await refreshScheduleReminderAfterSave("Deadline", deadline.id);
  return { ok: true, deadlineId: deadline.id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 标记已处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function markSmsProcessed(input: z.infer<typeof smsIdSchema>) {
  const session = await requireSession("matters.write");
  const data = smsIdSchema.parse(input);

  // 对象级校验（与 deleteSms 同口径）：仅收件人可标记，防止跨收件箱篡改处理状态
  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.id },
    select: { receivedById: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id) {
    throw new Error("仅收件人可标记处理状态");
  }

  // B1（v3 §6.3）：标记已处理前核对未处置文件——有暂存待确认文件或需人工取件时
  // 须填写去向说明，不得让角标消失掩盖遗漏；状态机同步置 NO_ACTION_NEEDED。
  const pendingFiles = await prisma.smsInboundFile.count({ where: { smsId: data.id, state: "PENDING_REVIEW" } });
  const note = String((input as { note?: string }).note ?? "").trim().slice(0, 500);
  if ((pendingFiles > 0) && !note) {
    throw new Error(`尚有 ${pendingFiles} 个来件文件待确认，请先处置文件或填写去向说明再标记`);
  }
  await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.update({
    where: { id: data.id },
    data: { processed: true, processedAt: new Date(), processingState: "NO_ACTION_NEEDED", processingNote: note || null }
  }));

  await audit({
    userId: session.user.id,
    action: "SMS_MARK_PROCESSED",
    targetType: "SmsMessage",
    targetId: data.id
  });

  revalidatePath("/inbox");
  return { ok: true };
}

export async function deleteSms(input: z.infer<typeof smsIdSchema>) {
  const session = await requireSession("matters.write");
  const data = smsIdSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.id },
    select: { receivedById: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id) {
    throw new Error("仅收件人可删除");
  }

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.smsMessage.delete({ where: { id: data.id } }));

  await audit({
    userId: session.user.id,
    action: "SMS_DELETE",
    targetType: "SmsMessage",
    targetId: data.id
  });

  revalidatePath("/inbox");
  return { ok: true };
}

// 把解析出的字符串日期尽量转 JS Date（UI 预填用）
export async function parseDateString(s: string) {
  await requireSession("matters.write");
  const d = toDate(s);
  return d ? d.toISOString() : null;
}

/**
 * v0.51: 立案/受理短信解析出的案号回填到程序（收件箱闭环）。
 * 只允许回填短信里真实解析出的案号；只填空案号的程序，已有案号不覆盖
 * （更正走程序信息编辑，留痕清晰）。
 */
export async function backfillCaseNumberFromSms(
  input: z.infer<typeof smsBackfillCaseNumberSchema>
) {
  const session = await requireSession("matters.write");
  const data = smsBackfillCaseNumberSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.smsId },
    select: { id: true, rawText: true, parsedJson: true, matchedMatterId: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (!sms.matchedMatterId) throw new Error("请先关联案件");
  await assertCanHandleMatter(session.user, sms.matchedMatterId);
  await assertMatterWritable(sms.matchedMatterId);

  const parsed = normalizeStoredParsed(sms.rawText, sms.parsedJson);
  if (!parsed.caseNumbers.includes(data.caseNumber)) {
    throw new Error("只能回填本条短信解析出的案号");
  }

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { id: true, matterId: true, caseNumber: true, type: true, customLabel: true }
  });
  if (!procedure || procedure.matterId !== sms.matchedMatterId) {
    throw new Error("程序与短信关联的案件不匹配");
  }
  if (procedure.caseNumber === data.caseNumber) {
    return { ok: true, unchanged: true };
  }
  if (procedure.caseNumber) {
    throw new Error(`该程序已有案号 ${procedure.caseNumber}，如需更正请在程序信息中修改`);
  }

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.matterProcedure.update({
    where: { id: procedure.id },
    data: { caseNumber: data.caseNumber }
  }));

  const matchedMatterId = sms.matchedMatterId;
  await roleMutation(session.user, "matters.write", async roleDb => recordTimelineEvent(roleDb, {
      matterId: matchedMatterId,
      eventType: "PROCEDURE_UPDATED",
      title: `案号回填：${data.caseNumber}（来自法院短信）`,
      occurredAt: new Date(),
      refType: "MatterProcedure",
      refId: procedure.id
    }));

  await audit({
    userId: session.user.id,
    action: "SMS_CASE_NUMBER_BACKFILL",
    targetType: "MatterProcedure",
    targetId: procedure.id,
    detail: { smsId: sms.id, matterId: sms.matchedMatterId, caseNumber: data.caseNumber }
  });

  revalidatePath("/inbox");
  await revalidateMatter(sms.matchedMatterId);
  return { ok: true, unchanged: false };
}
