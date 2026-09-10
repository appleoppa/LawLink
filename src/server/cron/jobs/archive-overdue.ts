/**
 * 归档逾期预警：扫描已结案但超过 30 天未提交归档的案件，给主办律师发通知。
 *
 * 业务逻辑：
 * - status = CLOSED 且 closedAt < now - 30 天
 * - 未生成 ArchiveRecord（或都被 REJECTED）
 * - 同一案件 30 天内不重复发预警（refId 唯一性）
 */
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";

const OVERDUE_DAYS = 30;
const REPEAT_SUPPRESS_DAYS = 30;

export type OverdueScanResult = {
  scanned: number;
  notified: number;
  suppressed: number;
};

export async function scanArchiveOverdue(): Promise<OverdueScanResult> {
  const cutoff = new Date(Date.now() - OVERDUE_DAYS * 86400_000);

  const candidates = await prisma.matter.findMany({
    where: {
      status: "CLOSED",
      closedAt: { lt: cutoff },
      deletedAt: null
    },
    select: {
      id: true,
      title: true,
      internalCode: true,
      ownerId: true,
      closedAt: true,
      archiveRecords: {
        where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } },
        select: { id: true },
        take: 1
      }
    }
  });

  // 排除已有进行中或已通过的归档
  const target = candidates.filter((m) => m.archiveRecords.length === 0);

  // 防重：拉最近 30 天已发过的"ARCHIVE_OVERDUE"通知（refId = matterId）
  const repeatCutoff = new Date(Date.now() - REPEAT_SUPPRESS_DAYS * 86400_000);
  const matterIds = target.map((m) => m.id);
  const recentNotified = await prisma.notification.findMany({
    where: {
      refType: "ArchiveOverdue",
      refId: { in: matterIds },
      createdAt: { gte: repeatCutoff }
    },
    select: { refId: true }
  });
  const suppressedIds = new Set(recentNotified.map((n) => n.refId));

  let notified = 0;
  let suppressed = 0;
  for (const m of target) {
    if (!m.id || !m.ownerId || !m.closedAt) continue;
    if (suppressedIds.has(m.id)) {
      suppressed++;
      continue;
    }
    const days = Math.floor((Date.now() - m.closedAt.getTime()) / 86400_000);
    await createNotification({
      userId: m.ownerId,
      type: "SYSTEM",
      priority: "HIGH",
      title: `归档逾期：${m.internalCode}·${m.title}`,
      content: `案件已结 ${days} 天但未提交归档，请尽快补全材料后提交归档申请。`,
      href: matterHref(m),
      refType: "ArchiveOverdue",
      refId: m.id
    });
    notified++;
  }

  await audit({
    userId: null,
    action: "ARCHIVE_OVERDUE_SCAN_CRON",
    targetType: "Report",
    targetId: "archive-overdue",
    detail: {
      scanned: candidates.length,
      target: target.length,
      notified,
      suppressed,
      overdueDays: OVERDUE_DAYS
    }
  });

  return {
    scanned: candidates.length,
    notified,
    suppressed
  };
}
