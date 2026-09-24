/**
 * 提醒送达台账保留清理（F-1 阶段三，docs/REMINDER-DELIVERY-LEDGER-PLAN-20260921.md §六）。
 *
 * 每天 03:10 跑一次（Asia/Shanghai）：
 * 1. PENDING 超过 7 天仍未投递的行置 FAILED（防滞留——正常应在分钟级被投递器收敛）；
 * 2. 删除超过 REMINDER_LEDGER_RETENTION_DAYS（默认 180 天）的明细行（含全部状态，
 *    投递器会先把 PENDING 收敛为终态）；删除计数写审计，不做归档聚合（台账卡只查近 7 天）。
 */
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";

const STALE_PENDING_DAYS = 7;

function retentionDays(): number {
  const n = parseInt(process.env.REMINDER_LEDGER_RETENTION_DAYS ?? "180", 10);
  return Number.isInteger(n) && n >= 7 ? n : 180;
}

export async function runReminderLedgerCleanup(): Promise<{ retentionDays: number; stalePending: number; deleted: number }> {
  const days = retentionDays();
  const stalePending = await prisma.reminderDelivery.updateMany({
    where: {
      status: "PENDING",
      registeredAt: { lt: new Date(Date.now() - STALE_PENDING_DAYS * 86_400_000) }
    },
    data: { status: "FAILED", lastError: `长期未投递（超过 ${STALE_PENDING_DAYS} 天），由保留清理置终态` }
  });
  const removed = await prisma.reminderDelivery.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } }
  });
  await audit({
    userId: null,
    action: "REMINDER_LEDGER_CLEANUP_CRON",
    targetType: "ReminderDelivery",
    targetId: "reminder-ledger",
    detail: { retentionDays: days, stalePending: stalePending.count, deleted: removed.count }
  });
  return { retentionDays: days, stalePending: stalePending.count, deleted: removed.count };
}
