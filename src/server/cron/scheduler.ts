/**
 * v0.22: 进程内 cron 调度（node-cron）
 *
 * 在 next start 进程启动时通过 instrumentation.ts → register() 调用。
 *
 * 限制：
 * - **仅在 next start（生产）下生效**。dev 模式不跑（避免开发时误推通知）。
 * - 不支持 serverless（Vercel Edge / Lambda）。LawLink 自部署场景默认是
 *   长驻 Node 进程，OK。
 * - 进程重启会重新注册定时作业；如果在触发时间点重启，可能错过本次。
 *
 * 当前定时作业：
 * - 每周一 09:00 推送本周报告
 * - 每天 09:00 扫描归档逾期 30 天的案件
 * - 每天 03:00 清理超过 N 天的 AuditLog
 *
 * 时区：所有 cron 用 Asia/Shanghai（避免容器 UTC 跑出来 8 小时偏差）。
 *
 * v0.26 cron 可观测性：
 * - 成功路径由各 job 内部自己写 *_CRON audit（已有）
 * - 失败路径在此处统一捕获 + 写 *_FAILED_CRON audit，避免 cron 静默失败
 */
import cron from "node-cron";
import { runWeeklyReportPush } from "@/server/reports/push-weekly";
import { weekPeriod } from "@/server/reports/weekly";
import { prisma } from "@/lib/prisma";
import { scanArchiveOverdue } from "./jobs/archive-overdue";
import { runAuditCleanup } from "./jobs/audit-cleanup";
import { scanDueReminders } from "./jobs/scan-due-reminders";
import { scanSealBackfillReminders } from "./jobs/scan-seal-backfill-reminders";
import { runDatabaseBackup, backupCronEnabled } from "./jobs/backup-database";
import { audit } from "@/server/audit";

const TIMEZONE = "Asia/Shanghai";
const STARTUP_RECOVERY_WINDOW_MS = 15 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
let started = false;
const runningJobs = new Set<string>();

const SHANGHAI_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  calendar: "iso8601",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function shanghaiDateParts(now: Date) {
  const parts = Object.fromEntries(
    SHANGHAI_PARTS_FORMATTER.formatToParts(now).map(({ type, value }) => [type, value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: new Date(now.getTime() + SHANGHAI_OFFSET_MS).getUTCDay()
  };
}

/** Calculate the UTC instant for a wall-clock slot in Asia/Shanghai. */
export function scheduledAtForShanghai(
  now: Date,
  hour: number,
  minute: number,
  weekday?: number
) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("hour must be an integer between 0 and 23");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError("minute must be an integer between 0 and 59");
  }

  const { year, month, day, weekday: shanghaiWeekday } = shanghaiDateParts(now);
  if (weekday !== undefined && shanghaiWeekday !== weekday) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS);
}

export function isWithinStartupRecoveryWindow(now: Date, scheduledAt: Date | null) {
  if (!scheduledAt) return false;
  const elapsed = now.getTime() - scheduledAt.getTime();
  return elapsed >= 0 && elapsed < STARTUP_RECOVERY_WINDOW_MS;
}

async function runWithFailureAudit(
  jobName: string,
  failureAction: string,
  fn: () => Promise<unknown>
): Promise<boolean> {
  if (runningJobs.has(jobName)) {
    console.warn(`[cron] ${jobName} 已在运行，跳过重入`);
    return false;
  }
  runningJobs.add(jobName);
  const startedAt = Date.now();
  const triggeredAt = new Date().toISOString();
  console.log(`[cron] ${triggeredAt} 触发：${jobName}`);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    void result;
    console.log(`[cron] ${jobName} 完成（${durationMs}ms）`);
    return true;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    const stack =
      err instanceof Error
        ? err.stack?.split("\n").slice(0, 5).join("\n")
        : undefined;
    console.error(`[cron] ${jobName} 异常（${durationMs}ms）：`, err);
    await audit({
      userId: null,
      action: failureAction,
      targetType: "Cron",
      targetId: jobName,
      detail: { error: message, stack, durationMs, triggeredAt }
    });
    return false;
  } finally {
    runningJobs.delete(jobName);
  }
}

export async function recoverMissedCronJobs(now = new Date()) {
  const weeklyTargetId = weekPeriod(now).label;
  const candidates = [
    {
      name: "周报推送",
      action: "WEEKLY_REPORT_PUSH_CRON",
      targetType: "Report",
      targetId: weeklyTargetId,
      failureAction: "WEEKLY_REPORT_PUSH_FAILED_CRON",
      scheduledAt: scheduledAtForShanghai(now, 9, 0, 1),
      run: () => runWeeklyReportPush(null)
    },
    {
      name: "归档逾期扫描",
      action: "ARCHIVE_OVERDUE_SCAN_CRON",
      targetType: "Report",
      targetId: "archive-overdue",
      failureAction: "ARCHIVE_OVERDUE_SCAN_FAILED_CRON",
      scheduledAt: scheduledAtForShanghai(now, 9, 0),
      run: () => scanArchiveOverdue()
    },
    {
      name: "AuditLog 清理",
      action: "AUDIT_CLEANUP_CRON",
      targetType: "AuditLog",
      targetId: "retention",
      failureAction: "AUDIT_CLEANUP_FAILED_CRON",
      scheduledAt: scheduledAtForShanghai(now, 3, 0),
      run: () => runAuditCleanup()
    },
    {
      name: "到期提醒扫描",
      action: "DUE_REMINDER_SCAN_CRON",
      targetType: "Report",
      targetId: "due-reminder",
      failureAction: "DUE_REMINDER_SCAN_FAILED_CRON",
      scheduledAt: scheduledAtForShanghai(now, 9, 0),
      run: () => scanDueReminders()
    },
    {
      name: "用章盖章件回填提醒扫描",
      action: "SEAL_BACKFILL_REMINDER_SCAN_CRON",
      targetType: "Report",
      targetId: "seal-backfill-reminder",
      failureAction: "SEAL_BACKFILL_REMINDER_SCAN_FAILED_CRON",
      scheduledAt: scheduledAtForShanghai(now, 9, 10),
      run: () => scanSealBackfillReminders()
    }
  ];

  const recovered: string[] = [];
  for (const job of candidates) {
    if (!isWithinStartupRecoveryWindow(now, job.scheduledAt) || !job.scheduledAt) {
      continue;
    }

    // A successful audit for this exact slot is the durable idempotency marker.
    const alreadyRan = await prisma.auditLog.findFirst({
      where: {
        action: job.action,
        targetType: job.targetType,
        targetId: job.targetId,
        createdAt: { gte: job.scheduledAt, lte: now }
      },
      select: { id: true }
    });
    if (alreadyRan) continue;

    if (await runWithFailureAudit(job.name, job.failureAction, job.run)) {
      recovered.push(job.name);
    }
  }

  await audit({
    userId: null,
    action: "CRON_SCHEDULER_STARTED",
    targetType: "Cron",
    targetId: "scheduler",
    detail: {
      recoveryWindowMinutes: STARTUP_RECOVERY_WINDOW_MS / 60_000,
      recoveredJobs: recovered
    }
  });
}

export function registerCronJobs() {
  if (started) {
    console.warn("[cron] registerCronJobs 重复调用，跳过");
    return;
  }
  started = true;

  // 每周一 09:00 推周报
  cron.schedule(
    "0 9 * * 1",
    () =>
      runWithFailureAudit(
        "周报推送",
        "WEEKLY_REPORT_PUSH_FAILED_CRON",
        () => runWeeklyReportPush(null)
      ),
    { timezone: TIMEZONE }
  );

  // 每天 09:00 扫归档逾期
  cron.schedule(
    "0 9 * * *",
    () =>
      runWithFailureAudit(
        "归档逾期扫描",
        "ARCHIVE_OVERDUE_SCAN_FAILED_CRON",
        () => scanArchiveOverdue()
      ),
    { timezone: TIMEZONE }
  );

  // 每天 03:00 清理超过 N 天的 AuditLog（默认 365 天，AUDIT_RETENTION_DAYS 可覆盖）
  cron.schedule(
    "0 3 * * *",
    () =>
      runWithFailureAudit(
        "AuditLog 清理",
        "AUDIT_CLEANUP_FAILED_CRON",
        () => runAuditCleanup()
      ),
    { timezone: TIMEZONE }
  );

  // v0.27: 每天 09:00 扫到期期限（T-3/T-1/T/T+1 四档），发 DEADLINE_REMINDER
  cron.schedule(
    "0 9 * * *",
    () =>
      runWithFailureAudit(
        "到期提醒扫描",
        "DUE_REMINDER_SCAN_FAILED_CRON",
        () => scanDueReminders()
      ),
    { timezone: TIMEZONE }
  );

  // 每天 09:10 扫描已审批但未回填盖章件的用章申请；同一申请 3 天内不重复提醒
  cron.schedule(
    "10 9 * * *",
    () =>
      runWithFailureAudit(
        "用章盖章件回填提醒扫描",
        "SEAL_BACKFILL_REMINDER_SCAN_FAILED_CRON",
        () => scanSealBackfillReminders()
      ),
    { timezone: TIMEZONE }
  );

  // v0.50: 每天 02:30 数据库+文件存储备份（BACKUP_CRON_ENABLED=false 可关）
  if (backupCronEnabled()) {
    cron.schedule(
      "30 2 * * *",
      () =>
        runWithFailureAudit(
          "数据库备份",
          "DATABASE_BACKUP_FAILED_CRON",
          () => runDatabaseBackup()
        ),
      { timezone: TIMEZONE }
    );
  }

  console.log(
    "[cron] 已注册 5 个定时作业（周报推送 / 归档逾期扫描 / AuditLog 清理 / 到期提醒扫描 / 用章回填提醒扫描），时区 Asia/Shanghai"
  );

  // Recovery is deliberately bounded and audit-gated; registration itself never runs jobs unconditionally.
  void recoverMissedCronJobs().catch((err) => {
    console.error("[cron] 启动恢复检查失败：", err instanceof Error ? err.message : String(err));
  });
}
