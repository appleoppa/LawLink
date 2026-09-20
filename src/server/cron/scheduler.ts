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
import { runWeeklyReportPush } from "@/server/reports/weekly-push-core";
import { scanArchiveOverdue } from "./jobs/archive-overdue";
import { runAuditCleanup } from "./jobs/audit-cleanup";
import { scanDueReminders } from "./jobs/scan-due-reminders";
import { scanSealBackfillReminders } from "./jobs/scan-seal-backfill-reminders";
import { runDatabaseBackup, backupCronEnabled } from "./jobs/backup-database";
import { audit } from "@/server/audit";
import { processDueJobs } from "./worker";
import { scanScheduleReminders } from "@/server/reminders/schedule";
import { shParts } from "@/lib/ui/sh-time";
import { recoverStaleLeases } from "./queue";

const TIMEZONE = "Asia/Shanghai";
let started = false;

async function runWithFailureAudit(
  jobName: string,
  failureAction: string,
  fn: () => Promise<unknown>
) {
  const startedAt = Date.now();
  const triggeredAt = new Date().toISOString();
  console.log(`[cron] ${triggeredAt} 触发：${jobName}`);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    console.log(`[cron] ${jobName} 完成（${durationMs}ms）`, result);
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
  }
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

  // 每天 03:00 统计可考虑归档的 AuditLog，全部记录仍保留
  cron.schedule(
    "0 3 * * *",
    () =>
      runWithFailureAudit(
        "AuditLog 保留检查",
        "AUDIT_RETENTION_CHECK_FAILED_CRON",
        () => runAuditCleanup()
      ),
    { timezone: TIMEZONE }
  );

  // v0.27: 每天 09:00 扫到期期限与开庭，发 DEADLINE_REMINDER /
  // HEARING_REMINDER（期限档位 = 固定档 ∪ 各期限 remindDays，开庭固定 T-3/T-1/T）
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

  // v1.x P1-1: 持久队列 worker——每 2 分钟处理到期任务（含失败退避重试）；
  // 启动时先恢复宕机遗留的租约过期任务
  void recoverStaleLeases().catch((err) => {
    console.error("[queue] 启动恢复租约失败：", err);
  });
  cron.schedule(
    "*/2 * * * *",
    () =>
      runWithFailureAudit("队列 worker", "QUEUE_WORKER_FAILED_CRON", () =>
        (async () => {
          await recoverStaleLeases();
          const now = new Date();
          // 09:00 前补当日紧急项，之后补所有应提醒档；保存后进程中断也不会等到次日。
          await runWithFailureAudit("日程提醒补扫", "SCHEDULE_REMINDER_CATCHUP_FAILED_CRON", () => scanScheduleReminders(now, shParts(now).hh < 9));
          return processDueJobs(10);
        })()
      ),
    { timezone: TIMEZONE }
  );

  console.log(
    `[cron] 已注册 ${backupCronEnabled() ? 7 : 6} 个定时作业（周报推送 / 归档逾期扫描 / AuditLog 清理 / 到期提醒扫描 / 用章回填提醒扫描${backupCronEnabled() ? " / 数据库备份" : ""} / 队列 worker），时区 Asia/Shanghai`
  );
}
