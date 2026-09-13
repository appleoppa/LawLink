"use server";

/**
 * v0.38: 提醒扫描的可调用 Server Action 入口。
 *
 * 单独成文件（顶层 "use server"）是因为 scan-due-reminders.ts 同时导出普通函数，
 * 内联 "use server" 无法被客户端组件 import（Next 14 限制）。
 */
import { scanDueReminders, type DueReminderScanResult } from "@/server/cron/jobs/scan-due-reminders";
import { requireSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";

/** admin / 主任律师可立即扫一遍（灰度验证 + 紧急补推 + 本地 dev 验证） */
export async function triggerDueReminderScan(): Promise<DueReminderScanResult> {
  const session = await requireSession();
  if (!isSystemAdmin(session.user) && session.user.role !== "PRINCIPAL_LAWYER") {
    throw new Error("仅系统超级管理员 / 主任律师可手动触发到期提醒扫描");
  }
  return scanDueReminders();
}
