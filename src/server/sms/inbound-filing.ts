/**
 * B1 私有来件暂存文件转正（内部模块，非 "use server"）。
 *
 * 2026-09-20 第五轮审计 P1-1 修复：本函数原从 "use server" 的 actions.ts 导出，
 * 作为可寻址 server action 端点可被直调（无 requireSession、userId 由调用方传入、
 * 不校验来件归属），任何经办用户可把他人私有来件文件转正到自己案件。移入内部
 * 模块后不再是 RPC 端点，并补归属校验（收件人本人，或转正目标即该来件匹配的案件）。
 */
import { Prisma, type SmsType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertMatterWritable } from "@/lib/archive/guard";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { recordTimelineEvent } from "@/server/timeline/record";
import { ActionError } from "@/lib/action-error";

/**
 * B1：把一条来件私有暂存区（PENDING_REVIEW、无 documentId）的文件转正为正式案件材料。
 * 读暂存盘明文 → 按部署加密策略落案件卷宗 → 建 Document（沿用短信附件分类）→ 回填映射。
 * 磁盘暂存文件不删除（历史可溯）；单文件失败不阻断其余文件。
 *
 * 归属校验（P1-1）：转正目标必须是该来件当前匹配的案件（收件人本人或本案经办/
 * 合伙人操作，案件写权由 assertMatterWritable 承担）——防止把他人私有暂存文件
 * 写入无关案件（读取他人私区内容）。
 */
export async function fileSmsInboundFilesToMatter({ smsId, matterId, userId }: { smsId: string; matterId: string; userId: string }): Promise<number> {
  // 会话存在性校验（防直调无会话）；userId 须与会话一致（防归属伪造）
  const session = await requireSession("matters.write");
  if (session.user.id !== userId) throw new ActionError("转正操作人与会话不一致");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { matchedMatterId: true, smsType: true } });
  if (!sms) throw new ActionError("来件不存在");
  if (sms.matchedMatterId !== matterId) throw new ActionError("转正目标须为该来件匹配的案件");
  await assertMatterWritable(matterId, { allowPrincipal: true });
  const pending = await prisma.smsInboundFile.findMany({
    where: { smsId, documentId: null, state: "PENDING_REVIEW" },
    orderBy: { id: "asc" }
  });
  let filed = 0;
  for (const file of pending) {
    try {
      const buffer = await storage.readFile(file.storageKey);
      const stored = await saveSmsInboundDocument({
        matterId,
        userId,
        buffer,
        filename: file.displayName ?? file.originalName,
        mimeType: file.mimeType,
        smsType: sms.smsType ?? "OTHER"
      });
      await prisma.smsInboundFile.update({
        where: { id: file.id },
        data: { matterId, documentId: stored.id, state: "FILED" }
      });
      filed++;
    } catch {
      // 单文件失败保留 PENDING_REVIEW 可重试；不阻断其余文件与匹配流程
    }
  }
  if (pending.length) {
    const remaining = pending.length - filed;
    await prisma.smsMessage.update({
      where: { id: smsId },
      data: { processingState: remaining > 0 ? "PARTIAL" : "READY_FOR_REVIEW", processingNote: remaining > 0 ? `私有来件文件转正 ${filed}/${pending.length}，其余可重试` : null }
    });
  }
  return filed;
}

/** B1：暂存文件转正时按部署加密策略落案件卷宗并建正式材料（分类沿用短信附件规则） */
async function saveSmsInboundDocument(input: {
  matterId: string;
  userId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  smsType: SmsType;
}): Promise<{ id: string; path: string }> {

  const category = input.smsType === "JUDGMENT_NOTICE" || /判决|裁定|裁判|调解书/.test(input.filename) ? "JUDGMENT"
    : input.smsType === "EVIDENCE_SUBMIT" || /证据|材料|举证/.test(input.filename) ? "EVIDENCE"
    : /起诉|答辩|上诉|申请书|反诉|代理词|意见/.test(input.filename) ? "PLEADING"
    : ["SERVICE_NOTICE", "FILING_NOTICE", "FEE_NOTICE"].includes(input.smsType) ? "PROCEDURE"
    : "OTHER";
  const encrypted = Boolean(process.env.STORAGE_ENCRYPTION_KEY);
  let stored = input.buffer, iv: string | null = null, authTag: string | null = null, algorithm: string | null = null;
  if (encrypted) {
    const enc = encryptBuffer(input.buffer);
    stored = enc.ciphertext; iv = enc.iv.toString("base64"); authTag = enc.authTag.toString("base64"); algorithm = enc.algorithm;
  }
  const path = await storage.writeFile(`m_${input.matterId}`, stored);
  const doc = await prisma.document.create({
    data: {
      matterId: input.matterId,
      name: input.filename,
      category: category as Prisma.DocumentCreateInput["category"],
      path,
      mimeType: input.mimeType,
      size: input.buffer.length,
      sha256: sha256(input.buffer),
      encrypted, algorithm, iv, authTag,
      tags: ["法院短信", "电子送达", "来件转正"],
      uploadedById: input.userId
    },
    select: { id: true, path: true }
  });
  await recordTimelineEvent(prisma, {
    matterId: input.matterId,
    eventType: "DOCUMENT_UPLOADED",
    title: `来件文件转正：${input.filename}`,
    occurredAt: new Date(),
    refType: "Document",
    refId: doc.id
  });
  return doc;
}
