/** 周报推送核心逻辑。故意不标 "use server"：本模块函数会被 cron 复用，
 * 若放进 action 模块会变成无鉴权的可寻址 RPC 端点（见 allocation-internals 同款约定）。 */
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { weekPeriod, getLawyerWeeklyDigest, formatWeeklyDigestContent } from "./weekly";

export type WeeklyPushResult = {
  succeeded: number;
  failed: { userId: string; error: string }[];
  weekLabel: string;
};

/**
 * triggerUserId: server action 传当前用户 id；cron 传 null。
 */
export async function runWeeklyReportPush(
  triggerUserId: string | null
): Promise<WeeklyPushResult> {
  const period = weekPeriod();
  const recipients = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["PRINCIPAL_LAWYER", "INDEPENDENT_LAWYER", "LAWYER"] }
    },
    select: { id: true, name: true }
  });

  const failed: { userId: string; error: string }[] = [];
  let succeeded = 0;
  for (const u of recipients) {
    try {
      // 本地二开：同一人同一周只推一次。上游核心只有 createNotification 没有前置去重，
      // 手动触发与 cron 启动补偿会在同一周重复投递（用户收到两份周报）。
      const existing = await prisma.notification.findFirst({
        where: { userId: u.id, refType: "WeeklyReport", refId: period.label },
        select: { id: true }
      });
      if (existing) {
        succeeded++;
        continue;
      }

      const digest = await getLawyerWeeklyDigest({
        userId: u.id,
        userName: u.name,
        period
      });
      await createNotification({
        userId: u.id,
        type: "SYSTEM",
        priority: "NORMAL",
        title: `本周报告（${period.label}）`,
        content: formatWeeklyDigestContent(digest),
        href: "/reports?period=month",
        refType: "WeeklyReport",
        refId: period.label
      });
      succeeded++;
    } catch (err) {
      failed.push({
        userId: u.id,
        error: err instanceof Error ? err.message : "未知错误"
      });
    }
  }

  await audit({
    userId: triggerUserId,
    action: triggerUserId ? "WEEKLY_REPORT_PUSH" : "WEEKLY_REPORT_PUSH_CRON",
    targetType: "Report",
    targetId: period.label,
    detail: {
      weekLabel: period.label,
      total: recipients.length,
      succeeded,
      failed: failed.length,
      trigger: triggerUserId ? "manual" : "cron"
    }
  });

  return { succeeded, failed, weekLabel: period.label };
}
