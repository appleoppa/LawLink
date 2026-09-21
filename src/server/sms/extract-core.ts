/**
 * B1 附件取件核心（内部模块，非 "use server"）。
 *
 * 2026-09-20 第五轮审计 P2-4 修复：队列取件重试此前直接调用 "use server" 的
 * extractSmsAttachments，其 requireSession → getServerSession 在无请求上下文的
 * cron 定时器中必然抛错，重试是死功能。核心逻辑移入本模块（不依赖会话与
 * revalidate），server action 壳做权限后调用；cron worker 以入队粘贴人身份复跑。
 *
 * 本模块不做权限校验（调用方负责：server action 走收件人/经办断言；
 * worker 校验 payload.userId 必须是来件收件人）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RoleUser } from "@/lib/roles/catalog";
import { roleMutation } from "@/lib/roles/service";
import { audit } from "@/server/audit";
import { parseSms, type ParsedSms } from "@/lib/sms-parser";
import { deriveProcessingState } from "@/lib/sms/processing-state";
import { downloadSmsAttachments } from "./attachments";
import { ActionError } from "@/lib/action-error";

export function normalizeStoredParsed(rawText: string, parsedJson: Prisma.JsonValue): ParsedSms {
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
export function needsManualFromResults(results: ParsedSms["attachmentResults"]) {
  return results.some((r) => r.status === "LOGIN_REQUIRED" || r.status === "SKIPPED_NO_MATTER");
}

export function mergeAttachmentResults(
  existing: ParsedSms["attachmentResults"],
  incoming: ParsedSms["attachmentResults"]
) {
  const incomingUrls = new Set(incoming.map((r) => r.url));
  return [...incoming, ...existing.filter((r) => !incomingUrls.has(r.url))].slice(0, 30);
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
  const fallback = await prisma.matterProcedure.findFirst({
    where: { matterId, engagement: "ENGAGED" },
    orderBy: { order: "asc" },
    select: { id: true }
  });
  return fallback?.id ?? null;
}

export async function tryExtractAttachments({
  smsId,
  userId,
  parsed,
  matterId,
  actor
}: {
  smsId: string;
  userId: string;
  parsed: ParsedSms;
  matterId: string | null;
  actor?: { id: string; role: string; managerAuthorized?: boolean };
}) {
  if (parsed.urls.length === 0) return [];
  // B1 先取件后匹配（v3 §4.1）：未匹配案件的文件入分诊人私有来件暂存，
  // 不再要求先关联案件——案号常只在链接内文书中，先取件才能读到案号。
  try {
    const procedureId = matterId ? await findDefaultProcedureId(matterId, parsed.caseNumbers) : null;
    return await downloadSmsAttachments({ smsId, userId, parsed, matterId, procedureId, actor });
  } catch (err) {
    return parsed.urls.map((url) => ({
      url,
      status: "FAILED" as const,
      message: err instanceof Error ? err.message : "附件提取失败",
      checkedAt: new Date().toISOString()
    }));
  }
}

/** 取件核心：读来件 → 逐链接下载 → 合并结果 → 更新 SMS 状态 → 审计。无会话依赖。 */
export async function runSmsAttachmentExtraction({
  smsId,
  actor,
  source
}: {
  smsId: string;
  actor: RoleUser & { id: string };
  source: "manual" | "queue";
}): Promise<{ ok: true; count: number; attachmentResults: ParsedSms["attachmentResults"]; matchedMatterId: string | null }> {
  const sms = await prisma.smsMessage.findUnique({
    where: { id: smsId },
    select: { id: true, rawText: true, parsedJson: true, matchedMatterId: true }
  });
  if (!sms) throw new ActionError("短信不存在");
  const parsed = normalizeStoredParsed(sms.rawText, sms.parsedJson);
  if (parsed.urls.length === 0) throw new ActionError("短信中没有可提取的链接");

  const attachmentResults = await tryExtractAttachments({
    smsId: sms.id,
    userId: actor.id,
    parsed,
    matterId: sms.matchedMatterId,
    // 复查修复 P2-3：cron 队列场景无请求上下文，guard 的案件门禁以显式 actor 运行
    // （此前队列重试死在 assertDocumentWritable → requireSession，还被 catch 吞成 FAILED 假成功）
    actor: source === "queue" ? { id: actor.id, role: actor.role, managerAuthorized: actor.managerAuthorized } : undefined
  });

  const merged = mergeAttachmentResults(parsed.attachmentResults, attachmentResults);
  await roleMutation(actor, "matters.write", async roleDb => roleDb.smsMessage.update({
    where: { id: sms.id },
    data: {
      parsedJson: {
        ...parsed,
        attachmentResults: merged
      } as unknown as Prisma.InputJsonValue,
      needsManualAction: needsManualFromResults(merged),
      processingState: deriveProcessingState(merged, Boolean(sms.matchedMatterId))
    }
  }));

  await audit({
    userId: actor.id,
    action: "SMS_EXTRACT_ATTACHMENTS",
    targetType: "SmsMessage",
    targetId: sms.id,
    detail: { count: attachmentResults.length, via: source }
  });
  return { ok: true, count: attachmentResults.length, attachmentResults, matchedMatterId: sms.matchedMatterId };
}
