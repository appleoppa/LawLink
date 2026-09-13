"use server";

/**
 * 存量文档文本层回填（报告 P0-2 补充）。
 *
 * 逐批扫描无文本层的文档，读取（含解密）后抽取并落库；已有文本层
 * （READY）的不重复处理。返回处理摘要供界面展示；单条失败不断整批，
 * 计入 failed 数并保留 FAILED 状态（失败页不可隐去）。
 */
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { extractDocumentTextLayer, ocrStatusFor } from "@/lib/documents/text-extraction";

const BATCH_SIZE = 50;

export interface TextBackfillResult {
  scanned: number;
  ready: number;
  skipped: number;
  failed: number;
  remaining: number;
}

export async function backfillDocumentTextLayers(): Promise<TextBackfillResult> {
  const session = await requireSystemAdmin();

  const docs = await prisma.document.findMany({
    where: {
      deletedAt: null,
      ocrStatus: "PENDING",
      // 只处理可能有文本的类型：PDF / Word / 纯文本（其余留给 SKIP）
      OR: [
        { mimeType: { contains: "pdf" } },
        { mimeType: { contains: "wordprocessingml" } },
        { mimeType: { startsWith: "text/" } }
      ]
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
    select: { id: true, path: true, mimeType: true, encrypted: true, iv: true, authTag: true }
  });

  let ready = 0, skipped = 0, failed = 0;
  for (const doc of docs) {
    try {
      const stored = await storage.readFile(doc.path);
      const buf = doc.encrypted
        ? decryptBuffer(stored, doc.iv!, doc.authTag!)
        : stored;
      try {
        const layer = await extractDocumentTextLayer(buf, doc.mimeType);
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            textContent: layer.text.slice(0, 500_000),
            pageCount: layer.pageCount,
            textSource: layer.source,
            ocrStatus: "READY"
          }
        });
        ready++;
      } catch (err) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { ocrStatus: ocrStatusFor(err) }
        });
        skipped++;
      }
    } catch {
      // 存储/解密层失败：标 FAILED（与抽取失败区分，便于排查）
      await prisma.document.update({
        where: { id: doc.id },
        data: { ocrStatus: "FAILED" }
      }).catch(() => undefined);
      failed++;
    }
  }

  const remaining = await prisma.document.count({
    where: {
      deletedAt: null,
      ocrStatus: "PENDING",
      OR: [
        { mimeType: { contains: "pdf" } },
        { mimeType: { contains: "wordprocessingml" } },
        { mimeType: { startsWith: "text/" } }
      ]
    }
  });

  await audit({
    userId: session.user.id,
    action: "DOCUMENT_TEXT_BACKFILL",
    targetType: "Report",
    targetId: "document-text-backfill",
    detail: { scanned: docs.length, ready, skipped, failed, remaining }
  });

  return { scanned: docs.length, ready, skipped, failed, remaining };
}

/** 文本层状态概览（供维护卡片展示） */
export async function getTextLayerStats() {
  await requireSystemAdmin();
  const [pending, ready, failed, skip, total] = await Promise.all([
    prisma.document.count({ where: { deletedAt: null, ocrStatus: "PENDING" } }),
    prisma.document.count({ where: { deletedAt: null, ocrStatus: "READY" } }),
    prisma.document.count({ where: { deletedAt: null, ocrStatus: "FAILED" } }),
    prisma.document.count({ where: { deletedAt: null, ocrStatus: "SKIP" } }),
    prisma.document.count({ where: { deletedAt: null } })
  ]);
  return { pending, ready, failed, skip, total };
}
