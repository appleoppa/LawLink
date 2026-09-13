"use server";

/**
 * 客户证件号加密存量回填（P1 §三）。
 * 分批处理 idNumberBlind 为空但 idNumber 非空的行：加密 + 盲索引；
 * 重复（盲索引撞唯一索引）的行跳过并计数——留待人工合并（P0-1 流程）。
 */
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { sealIdNumber, isEncryptedIdNumber } from "@/lib/clients/id-number-crypto";
import { normalizeIdNumber } from "@/lib/clients/identity";

const BATCH = 50;

export async function backfillClientIdEncryption(): Promise<{
  scanned: number; sealed: number; skippedDuplicate: number; remaining: number;
}> {
  const session = await requireSystemAdmin();

  const rows = await prisma.client.findMany({
    where: { idNumberBlind: null, idNumber: { not: null } },
    take: BATCH,
    orderBy: { createdAt: "asc" },
    select: { id: true, idNumber: true, idType: true }
  });

  let sealed = 0;
  let skippedDuplicate = 0;
  for (const row of rows) {
    // 密文形态但缺盲索引（理论上仅手工改库出现）：只补盲索引
    const plain = isEncryptedIdNumber(row.idNumber)
      ? null
      : normalizeIdNumber(row.idNumber);
    if (plain) {
      try {
        const sealedFields = sealIdNumber(plain);
        await prisma.client.update({
          where: { id: row.id },
          data: { idNumber: sealedFields.idNumber, idNumberBlind: sealedFields.idNumberBlind }
        });
        sealed++;
      } catch {
        skippedDuplicate++; // 唯一索引冲突 = 存量重复主体，走合并流程
      }
    } else {
      // 已加密但盲索引缺失：以密文无法恢复明文计算盲索引，标记跳过待人工
      skippedDuplicate++;
    }
  }

  const remaining = await prisma.client.count({
    where: { idNumberBlind: null, idNumber: { not: null } }
  });

  await audit({
    userId: session.user.id,
    action: "CLIENT_ID_ENCRYPT_BACKFILL",
    targetType: "Report",
    targetId: "client-id-encrypt-backfill",
    detail: { scanned: rows.length, sealed, skippedDuplicate, remaining }
  });

  return { scanned: rows.length, sealed, skippedDuplicate, remaining };
}

export async function getClientIdCryptoStats() {
  await requireSystemAdmin();
  const [pending, sealed, total] = await Promise.all([
    prisma.client.count({ where: { idNumberBlind: null, idNumber: { not: null } } }),
    prisma.client.count({ where: { idNumberBlind: { not: null } } }),
    prisma.client.count()
  ]);
  return { pending, sealed, total };
}
