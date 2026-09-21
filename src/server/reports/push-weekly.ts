"use server";

/**
 * v0.21: 推送本周报告给全员
 *
 * 两个入口：
 * - admin 手动：pushWeeklyReportToAll（require session）
 * - cron 自动（v0.22）：runWeeklyReportPush（weekly-push-core，无 "use server"，不进 RPC 面）
 *
 * 收件人：所有 active 的 PRINCIPAL_LAWYER / LAWYER。
 * 每人收到自己的 LawyerWeeklyDigest 摘要，作为 Notification（type=SYSTEM）。
 */
import { isManager } from "@/lib/permissions";
import { requireSession } from "@/lib/auth/session";
import { runWeeklyReportPush, type WeeklyPushResult } from "./weekly-push-core";
import { ActionError } from "@/lib/action-error";

export type { WeeklyPushResult };

export async function pushWeeklyReportToAll(): Promise<WeeklyPushResult> {
  const session = await requireSession();
  if (!isManager(session.user)) {
    throw new ActionError("仅主任律师可推送周报");
  }
  return runWeeklyReportPush(session.user.id);
}
