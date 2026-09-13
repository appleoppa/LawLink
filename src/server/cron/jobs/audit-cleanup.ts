/**
 * AuditLog 保留检查：每天 03:00 统计超过 N 天、可考虑归档的记录。
 *
 * 默认 365 天；环境变量 AUDIT_RETENTION_DAYS 可覆盖（如设 90 = 3 个月）。
 * 全部记录继续留在原表供查询；本任务不删除或转存记录。
 */
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";

const DEFAULT_RETENTION_DAYS = 365;

export type AuditCleanupResult = {
  retentionDays: number;
  deleted: 0;
  eligibleForArchive: number;
  cutoffDate: string;
};

export async function runAuditCleanup(): Promise<AuditCleanupResult> {
  const envDays = Number(process.env.AUDIT_RETENTION_DAYS);
  const retentionDays =
    Number.isFinite(envDays) && envDays > 0 ? envDays : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);

  const eligibleForArchive = await prisma.auditLog.count({
    where: { createdAt: { lt: cutoff } }
  });

  // 保留检查本身也留痕，后续归档须另行实现及验收。
  await audit({
    userId: null,
    action: "AUDIT_RETENTION_CHECK_CRON",
    targetType: "AuditLog",
    targetId: "retention",
    detail: {
      retentionDays,
      cutoffDate: cutoff.toISOString().slice(0, 10),
      deleted: 0,
      eligibleForArchive
    }
  });

  return {
    retentionDays,
    deleted: 0,
    eligibleForArchive,
    cutoffDate: cutoff.toISOString().slice(0, 10)
  };
}
