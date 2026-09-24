/**
 * 数据库 + 文件存储备份的 CLI 入口，供 launchd 定时调用。
 *
 * 运行：npx tsx scripts/run-database-backup.ts
 * 退出码：0 = 备份成功；1 = 失败（launchd 日志里可定位）。
 *
 * 为什么走 launchd 而不是长驻进程内的 node-cron：本机是 MacBook，凌晨睡眠时
 * node-cron 会直接跳过槽位（实测日志累计 149 条 missed execution，审计表里
 * 一条备份记录都没有）。launchd 的 StartCalendarInterval 在唤醒后会补跑错过的
 * 时点，备份这类必须可靠的作业应交给它。
 *
 * 这里刻意调用 runDatabaseBackupNow()：BACKUP_CRON_ENABLED=false 只表示
 * 「不要在长驻进程里注册备份定时器」，不表示「不要备份」。
 */
import { runDatabaseBackupNow } from "../src/server/cron/jobs/backup-database";

async function main() {
  const started = Date.now();
  const result = await runDatabaseBackupNow();
  const cost = `${Date.now() - started}ms`;
  if (result.ok) {
    console.log(`[lawlink-backup] 完成 backupDir=${result.backupDir} 清理旧备份=${result.removedOld ?? 0} 耗时=${cost}`);
    return;
  }
  console.error(`[lawlink-backup] 未成功：${result.error ?? "unknown"} 耗时=${cost}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[lawlink-backup] 执行异常：", err);
  process.exitCode = 1;
});
