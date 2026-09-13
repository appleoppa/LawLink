/**
 * v0.9.4 归档编号生成
 *
 * 格式：YYYY-类别-NNNN
 *   - YYYY = 归档年份（archivedAt 当年）
 *   - 类别简称 = 1 个汉字
 *   - NNNN = 年内同类别归档序号（零填 4 位，从 0001 起）
 *
 * 示例：2026-民-0017
 *
 * 并发：依赖 @@unique(archiveNo)。重复时回到查 max 再 +1（最多重试 3 次）。
 */
import type { MatterCategory } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

const CATEGORY_SHORT: Record<MatterCategory, string> = {
  CIVIL_COMMERCIAL: "民",
  LABOR_ARBITRATION: "劳",
  COMMERCIAL_ARBITRATION: "商",
  CRIMINAL: "刑",
  ADMINISTRATIVE: "行",
  NON_LITIGATION: "非",
  LEGAL_COUNSEL: "顾",
  SPECIAL_PROJECT: "专"
};

export function categoryShort(category: MatterCategory): string {
  return CATEGORY_SHORT[category] ?? "案";
}

export async function nextArchiveNo(
  tx: Pick<PrismaClient, "archiveRecord">,
  category: MatterCategory,
  archivedAt: Date = new Date()
): Promise<string> {
  const year = archivedAt.getFullYear();
  const short = categoryShort(category);
  const prefix = `${year}-${short}-`;

  // 取年内同前缀的最大 archiveNo
  const existing = await tx.archiveRecord.findMany({
    where: { archiveNo: { startsWith: prefix } },
    select: { archiveNo: true },
    orderBy: { archiveNo: "desc" },
    take: 1
  });

  let next = 1;
  if (existing.length > 0) {
    const m = existing[0].archiveNo.match(/-(\d{4})$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}
