/**
 * v0.50: 数据库 + 文件存储自动备份（PRD §六承诺的"内置备份"最后一公里）。
 *
 * 每天 02:30 调 scripts/backup.sh（pg_dump + storage 打包），备份到
 * BACKUP_DIR（默认 ./backups），并做保留数清理（BACKUP_KEEP，默认 14 份）。
 * 失败时给所有 ADMIN 发站内通知——备份静默失败等于没有备份。
 *
 * 关闭方式：环境变量 BACKUP_CRON_ENABLED=false（部署环境没有 pg_dump 时）。
 */
import { spawn } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { audit } from "@/server/audit";

const BACKUP_SCRIPT = path.join(process.cwd(), "scripts", "backup.sh");
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

export type BackupResult = {
  ok: boolean;
  skipped?: boolean;
  backupDir?: string;
  removedOld?: number;
  error?: string;
};

export function backupCronEnabled(): boolean {
  return process.env.BACKUP_CRON_ENABLED !== "false";
}

function backupBaseDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
}

function keepCount(): number {
  const n = parseInt(process.env.BACKUP_KEEP ?? "14", 10);
  return Number.isInteger(n) && n > 0 ? n : 14;
}

function runScript(baseDir: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [BACKUP_SCRIPT, baseDir], {
      cwd: process.cwd(),
      env: process.env
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("备份超时（10 分钟）"));
    }, BACKUP_TIMEOUT_MS);
    child.stdout.on("data", (d) => (output += String(d)));
    child.stderr.on("data", (d) => (output += String(d)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

/** 只保留最近 N 份备份目录（目录名以时间戳开头，字典序即时间序） */
async function pruneOldBackups(baseDir: string, keep: number): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return 0;
  }
  const backupDirs: string[] = [];
  for (const name of entries) {
    if (!/^\d{8}_\d{6}$/.test(name)) continue; // 只清理本脚本产生的目录
    const full = path.join(baseDir, name);
    try {
      if ((await stat(full)).isDirectory()) backupDirs.push(name);
    } catch {
      // 忽略读取失败的条目
    }
  }
  backupDirs.sort();
  const toRemove = backupDirs.slice(0, Math.max(0, backupDirs.length - keep));
  for (const name of toRemove) {
    await rm(path.join(baseDir, name), { recursive: true, force: true });
  }
  return toRemove.length;
}

async function notifyAdmins(title: string, content: string) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", active: true },
    select: { id: true }
  });
  for (const admin of admins) {
    await createNotification({
      userId: admin.id,
      type: "SYSTEM",
      priority: "HIGH",
      title,
      content,
      href: "/settings"
    });
  }
}

export async function runDatabaseBackup(): Promise<BackupResult> {
  if (!backupCronEnabled()) {
    return { ok: false, skipped: true };
  }

  const baseDir = backupBaseDir();
  try {
    const { code, output } = await runScript(baseDir);
    if (code !== 0) {
      throw new Error(`backup.sh 退出码 ${code}：${output.slice(-500)}`);
    }
    const removedOld = await pruneOldBackups(baseDir, keepCount());

    await audit({
      userId: null,
      action: "DATABASE_BACKUP_CRON",
      targetType: "Backup",
      targetId: baseDir,
      detail: { removedOld, keep: keepCount() }
    });
    return { ok: true, backupDir: baseDir, removedOld };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notifyAdmins(
      "数据库自动备份失败",
      `${message.slice(0, 300)}｜请检查 pg_dump 是否可用、BACKUP_DIR 是否可写；修复前系统没有新备份。`
    );
    // 抛出让 scheduler 统一写 *_FAILED_CRON audit
    throw err;
  }
}
