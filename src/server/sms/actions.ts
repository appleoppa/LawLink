"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAccessMatter, assertCanAssociateMatter } from "@/lib/permissions";
import { parseSms, splitSmsBatch, toDate, type ParsedSms } from "@/lib/sms-parser";
import { enrichWithAi } from "@/lib/sms-parser-ai";
import { downloadSmsAttachments } from "./attachments";
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

async function findDefaultProcedureId(matterId: string, caseNumbers: string[]): Promise<string | null> {
  const byCaseNumber = caseNumbers.length > 0
    ? await prisma.matterProcedure.findFirst({
        where: {
          matterId,
          caseNumber: { in: caseNumbers },
          engagement: "ENGAGED"
        },
        orderBy: { order: "asc" },
        select: { id: true }
      })
    : null;
  if (byCaseNumber) return byCaseNumber.id;

  const firstEngaged = await prisma.matterProcedure.findFirst({
    where: { matterId, engagement: "ENGAGED" },
    orderBy: { order: "asc" },
    select: { id: true }
  });
  return firstEngaged?.id ?? null;
}

function normalizeStoredParsed(rawText: string, parsedJson: Prisma.JsonValue): ParsedSms {
  const parsed = parseSms(rawText);
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) return parsed;
  const stored = parsedJson as Partial<ParsedSms>;
  return {
    ...parsed,
    ...stored,
    caseNumbers: Array.isArray(stored.caseNumbers) ? stored.caseNumbers : parsed.caseNumbers,
    dates: Array.isArray(stored.dates) ? stored.dates : parsed.dates,
    phones: Array.isArray(stored.phones) ? stored.phones : parsed.phones,
    amounts: Array.isArray(stored.amounts) ? stored.amounts : parsed.amounts,
    urls: Array.isArray(stored.urls) ? stored.urls : parsed.urls,
    platforms: Array.isArray(stored.platforms) ? stored.platforms : parsed.platforms,
    importantItems: Array.isArray(stored.importantItems) ? stored.importantItems : parsed.importantItems,
    credentials: Array.isArray(stored.credentials) ? stored.credentials : parsed.credentials,
    documentLinks: Array.isArray(stored.documentLinks) ? stored.documentLinks : parsed.documentLinks,
    attachmentResults: Array.isArray(stored.attachmentResults) ? stored.attachmentResults : parsed.attachmentResults
  };
}

// v0.48: 待人工状态冗余到 SmsMessage.needsManualAction 供 SQL 过滤
function needsManualFromResults(results: ParsedSms["attachmentResults"]) {
  return results.some((r) => r.status === "LOGIN_REQUIRED" || r.status === "SKIPPED_NO_MATTER");
}

function mergeAttachmentResults(
  existing: ParsedSms["attachmentResults"],
  incoming: ParsedSms["attachmentResults"]
) {
  const incomingUrls = new Set(incoming.map((r) => r.url));
  return [...incoming, ...existing.filter((r) => !incomingUrls.has(r.url))].slice(0, 30);
}

function skippedNoMatterResults(parsed: ParsedSms): ParsedSms["attachmentResults"] {
  return parsed.urls.map((url) => ({
    url,
    status: "SKIPPED_NO_MATTER",
    message: "请先关联案件，再提取送达附件",
    checkedAt: new Date().toISOString()
  }));
}

async function tryExtractAttachments({
  smsId,
  userId,
  parsed,
  matterId
}: {
  smsId: string;
  userId: string;
  parsed: ParsedSms;
  matterId: string | null;
}) {
  if (parsed.urls.length === 0) return [];
  if (!matterId) return skippedNoMatterResults(parsed);
  try {
    const procedureId = await findDefaultProcedureId(matterId, parsed.caseNumbers);
    return await downloadSmsAttachments({ smsId, userId, parsed, matterId, procedureId });
  } catch (err) {
    return parsed.urls.map((url) => ({
      url,
      status: "FAILED" as const,
      message: err instanceof Error ? err.message : "附件提取失败",
      checkedAt: new Date().toISOString()
    }));
  }
}

export async function parseAndSaveSms(input: z.infer<typeof smsParseAndSaveSchema>) {
  const session = await requireSession();
  const data = smsParseAndSaveSchema.parse(input);

  const messages = data.batch ? splitSmsBatch(data.rawText) : [data.rawText.trim()];
  if (messages.length === 0) throw new Error("没有可解析的内容");

  const createdIds: string[] = [];

  let aiEnrichedCount = 0;
  for (const text of messages) {
    let parsed: ParsedSms = parseSms(text);
    if (data.useAi) {
      parsed = await enrichWithAi(text, parsed);
      if (parsed.aiEnriched) aiEnrichedCount++;
    }
    const matchedMatterId = await findMatchingMatter(parsed.caseNumbers);

    const created = await prisma.smsMessage.create({
      data: {
        rawText: text,
        receivedById: session.user.id,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        smsType: parsed.smsType,
        matchedMatterId,
        matchedBy: matchedMatterId ? "AUTO_CASE_NUMBER" : "UNMATCHED"
      },
      select: { id: true }
    });
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
        await prisma.smsMessage.update({
          where: { id: created.id },
          data: {
            parsedJson: parsed as unknown as Prisma.InputJsonValue,
            needsManualAction: needsManualFromResults(parsed.attachmentResults)
          }
        });
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
    detail: { count: createdIds.length, batch: data.batch, useAi: data.useAi, aiEnrichedCount }
  });

  revalidatePath("/inbox");
  return { ok: true, ids: createdIds, count: createdIds.length, aiEnrichedCount };
}

export async function extractSmsAttachments(input: z.infer<typeof smsIdSchema>) {
  const session = await requireSession();
  const data = smsIdSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.id },
    select: {
      id: true,
      rawText: true,
      parsedJson: true,
      receivedById: true,
      matchedMatterId: true
    }
  });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id && !sms.matchedMatterId) {
    throw new Error("无权处理这条短信");
  }
  if (!sms.matchedMatterId) {
    const parsed = normalizeStoredParsed(sms.rawText, sms.parsedJson);
    const attachmentResults = skippedNoMatterResults(parsed);
    const mergedNoMatter = mergeAttachmentResults(parsed.attachmentResults, attachmentResults);
    await prisma.smsMessage.update({
      where: { id: sms.id },
      data: {
        parsedJson: {
          ...parsed,
          attachmentResults: mergedNoMatter
        } as unknown as Prisma.InputJsonValue,
        needsManualAction: needsManualFromResults(mergedNoMatter)
      }
    });
    revalidatePath("/inbox");
    return { ok: true, count: attachmentResults.length, attachmentResults };
  }

  await assertCanAccessMatter(session.user.id, session.user.role, sms.matchedMatterId);
  const parsed = normalizeStoredParsed(sms.rawText, sms.parsedJson);
  if (parsed.urls.length === 0) throw new Error("短信中没有可提取的链接");

  const attachmentResults = await tryExtractAttachments({
    smsId: sms.id,
    userId: session.user.id,
    parsed,
    matterId: sms.matchedMatterId
  });

  const merged = mergeAttachmentResults(parsed.attachmentResults, attachmentResults);
  await prisma.smsMessage.update({
    where: { id: sms.id },
    data: {
      parsedJson: {
        ...parsed,
        attachmentResults: merged
      } as unknown as Prisma.InputJsonValue,
      needsManualAction: needsManualFromResults(merged)
    }
  });

  await audit({
    userId: session.user.id,
    action: "SMS_EXTRACT_ATTACHMENTS",
    targetType: "SmsMessage",
    targetId: sms.id,
    detail: { count: attachmentResults.length }
  });

  revalidatePath("/inbox");
  if (sms.matchedMatterId) await revalidateMatter(sms.matchedMatterId);
  return { ok: true, count: attachmentResults.length, attachmentResults };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 列表
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function listSmsMessages(input?: z.input<typeof smsListFilterSchema>) {
  const session = await requireSession();
  const filter = smsListFilterSchema.parse(input ?? {});

  const where: Prisma.SmsMessageWhereInput = {};
  if (filter.scope === "mine") where.receivedById = session.user.id;
  if (filter.processed === "unprocessed") where.processed = false;
  if (filter.processed === "processed") where.processed = true;
  if (filter.smsType) where.smsType = filter.smsType;
  if (filter.needsManual) where.needsManualAction = true;

  return prisma.smsMessage.findMany({
    where,
    orderBy: [{ processed: "asc" }, { receivedAt: "desc" }],
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

export async function getSmsMessage(id: string) {
  await requireSession();
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
  const session = await requireSession();
  const data = smsMatchToMatterSchema.parse(input);
  if (data.matterId) {
    await assertCanAssociateMatter(session.user.id, data.matterId);
    await assertMatterWritable(data.matterId);
  }

  await prisma.smsMessage.update({
    where: { id: data.smsId },
    data: {
      matchedMatterId: data.matterId,
      matchedBy: data.matterId ? "MANUAL" : "UNMATCHED"
    }
  });

  await audit({
    userId: session.user.id,
    action: "SMS_MATCH_MATTER",
    targetType: "SmsMessage",
    targetId: data.smsId,
    detail: { matterId: data.matterId }
  });

  revalidatePath("/inbox");
  return { ok: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一键生成 Hearing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateHearingFromSms(input: z.infer<typeof smsGenerateHearingSchema>) {
  const session = await requireSession();
  const data = smsGenerateHearingSchema.parse(input);

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { id: true, matterId: true }
  });
  if (!proc) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, proc.matterId);
  await assertMatterWritable(proc.matterId);

  const hearing = await prisma.hearing.create({
    data: {
      procedureId: data.procedureId,
      title: data.title.trim(),
      startsAt: data.startsAt,
      room: data.room?.trim() || null,
      judge: data.judge?.trim() || null,
      notes: data.notes?.trim() || null
    }
  });

  await prisma.smsMessage.update({
    where: { id: data.smsId },
    data: {
      generatedHearingId: hearing.id,
      processed: true,
      processedAt: new Date()
    }
  });

  await audit({
    userId: session.user.id,
    action: "SMS_GENERATE_HEARING",
    targetType: "Hearing",
    targetId: hearing.id,
    detail: { smsId: data.smsId, procedureId: data.procedureId }
  });

  revalidatePath("/inbox");
  await revalidateMatter(proc.matterId);
  return { ok: true, hearingId: hearing.id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 一键生成 Deadline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateDeadlineFromSms(input: z.infer<typeof smsGenerateDeadlineSchema>) {
  const session = await requireSession();
  const data = smsGenerateDeadlineSchema.parse(input);

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { id: true, matterId: true }
  });
  if (!proc) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, proc.matterId);
  await assertMatterWritable(proc.matterId);

  const deadline = await prisma.deadline.create({
    data: {
      procedureId: data.procedureId,
      title: data.title.trim(),
      category: data.category,
      dueAt: data.dueAt,
      basis: data.basis?.trim() || null,
      remindDays: data.remindDays
    }
  });

  await prisma.smsMessage.update({
    where: { id: data.smsId },
    data: {
      generatedDeadlineId: deadline.id,
      processed: true,
      processedAt: new Date()
    }
  });

  await audit({
    userId: session.user.id,
    action: "SMS_GENERATE_DEADLINE",
    targetType: "Deadline",
    targetId: deadline.id,
    detail: { smsId: data.smsId, procedureId: data.procedureId }
  });

  revalidatePath("/inbox");
  await revalidateMatter(proc.matterId);
  return { ok: true, deadlineId: deadline.id };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 标记已处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function markSmsProcessed(input: z.infer<typeof smsIdSchema>) {
  const session = await requireSession();
  const data = smsIdSchema.parse(input);

  await prisma.smsMessage.update({
    where: { id: data.id },
    data: { processed: true, processedAt: new Date() }
  });

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
  const session = await requireSession();
  const data = smsIdSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.id },
    select: { receivedById: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (sms.receivedById !== session.user.id && session.user.role !== "ADMIN") {
    throw new Error("仅收件人或管理员可删除");
  }

  await prisma.smsMessage.delete({ where: { id: data.id } });

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
  await requireSession();
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
  const session = await requireSession();
  const data = smsBackfillCaseNumberSchema.parse(input);

  const sms = await prisma.smsMessage.findUnique({
    where: { id: data.smsId },
    select: { id: true, rawText: true, parsedJson: true, matchedMatterId: true }
  });
  if (!sms) throw new Error("短信不存在");
  if (!sms.matchedMatterId) throw new Error("请先关联案件");
  await assertCanAssociateMatter(session.user.id, sms.matchedMatterId);
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

  await prisma.matterProcedure.update({
    where: { id: procedure.id },
    data: { caseNumber: data.caseNumber }
  });

  await prisma.timelineEvent.create({
    data: {
      matterId: sms.matchedMatterId,
      eventType: "PROCEDURE_UPDATED",
      title: `案号回填：${data.caseNumber}（来自法院短信）`,
      occurredAt: new Date(),
      refType: "MatterProcedure",
      refId: procedure.id
    }
  });

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
