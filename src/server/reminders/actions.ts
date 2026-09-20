"use server";

/**
 * v0.38: 提醒扫描的可调用 Server Action 入口。
 *
 * 单独成文件（顶层 "use server"）是因为 scan-due-reminders.ts 同时导出普通函数，
 * 内联 "use server" 无法被客户端组件 import（Next 14 限制）。
 */
import { scanDueReminders, type DueReminderScanResult } from "@/server/cron/jobs/scan-due-reminders";
import { isManager } from "@/lib/permissions";
import { processDueJobs } from "@/server/cron/worker";
import { requireSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { revalidatePath } from "next/cache";

/** admin / 主任律师可立即扫一遍（灰度验证 + 紧急补推 + 本地 dev 验证） */
export async function triggerDueReminderScan(): Promise<DueReminderScanResult> {
  const session = await requireSession();
  if (!isSystemAdmin(session.user) && !isManager(session.user)) {
    throw new Error("仅系统超级管理员 / 主任律师可手动触发到期提醒扫描");
  }
  const result = await scanDueReminders();
  // 手动触发时顺带处理队列（dev 无定时 worker，生产也便于立即投递）
  await processDueJobs(10);
  // 扫描结果（含最近投递状态卡片）随本次触发刷新
  revalidatePath("/admin/reminders");
  return result;
}
