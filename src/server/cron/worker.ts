/**
 * 队列 worker（P1-1）：领取到期任务并按类型执行。
 *
 * 处理器注册表集中在此；调度器每 2 分钟 tick 一次（生产），手动「立即
 * 扫描」也会在扫描后顺带处理一批（开发环境可验证全链路）。
 * 任务失败走队列自身的退避/死信，不在此处吞错。
 */
import { sendWebhookText } from "@/server/settings/webhook";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendReminderEmail } from "@/lib/notifications/email";
import { saveWebhookLastResult, type ReminderWebhookLastResult } from "@/server/settings/webhook-last-result";
import { claimDueJobs, completeJob, failJob } from "./queue";
import { shDayKey } from "@/lib/ui/sh-time";

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/** webhook 摘要投递：扫描侧只入队，实际外发与结果落库都在这里 */
const webhookDigestHandler: JobHandler = async (payload) => {
  const text = String(payload.text ?? "");
  const stats = (payload.stats ?? {}) as Partial<ReminderWebhookLastResult>;
  const result = await sendWebhookText(text);
  await saveWebhookLastResult({
    at: new Date().toISOString(),
    ok: result.ok,
    skipped: result.skipped ?? false,
    skipReason: result.skipped ? "推送未启用或未配置机器人地址" : undefined,
    error: result.error,
    reminderCount: stats.reminderCount ?? 0,
    deadlineScanned: stats.deadlineScanned ?? 0,
    deadlineNotified: stats.deadlineNotified ?? 0,
    hearingScanned: stats.hearingScanned ?? 0,
    hearingNotified: stats.hearingNotified ?? 0,
    preservationScanned: stats.preservationScanned ?? 0,
    preservationNotified: stats.preservationNotified ?? 0,
    preservationExpired: stats.preservationExpired ?? 0,
    suppressed: stats.suppressed ?? 0,
    deadlineOffsets: stats.deadlineOffsets ?? []
  });
  if (!result.ok && !result.skipped) {
    throw new Error(result.error ?? "webhook 投递失败");
  }
};

const emailDigestHandler: JobHandler = async () => {
  // 个人邮件摘要：按当日站内通知按人聚合外发；未配置 SMTP 时以跳过完结
  // （幂等键当日一次；重试退避与死信由队列兜底——提醒失败不可静默）。
  if (!isEmailConfigured()) return;
  // 按上海日界切「今日」——此前用服务器本地时区 new Date(y,m,d)，UTC 容器 0-8 点归错日
  const startOfToday = new Date(`${shDayKey(new Date())}T00:00:00+08:00`);
  const notes = await prisma.notification.findMany({
    where: { createdAt: { gte: startOfToday } },
    select: { userId: true, title: true, content: true },
    orderBy: { createdAt: "asc" },
    take: 500
  });
  if (notes.length === 0) return;
  const byUser = new Map<string, string[]>();
  for (const n of notes) {
    const arr = byUser.get(n.userId) ?? [];
    arr.push(n.content ? `${n.title}：${n.content.slice(0, 80)}` : n.title);
    byUser.set(n.userId, arr);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] }, active: true },
    select: { id: true, name: true, email: true }
  });
  for (const u of users) {
    const lines = byUser.get(u.id) ?? [];
    if (!lines.length || !u.email) continue;
    await sendReminderEmail({ to: u.email, userName: u.name, lines });
  }
};

const smsAttachmentFetchHandler: JobHandler = async (payload) => {
  // B1：来件附件取件重试（粘贴同步取件失败后的队列补漏）。幂等由
  // SmsInboundFile (smsId, sha256) 唯一约束 + attachmentResults 按 url 合并承担。
  const smsId = String(payload.smsId ?? "");
  if (!smsId) throw new Error("sms.attachment_fetch 缺少 smsId");
  const { extractSmsAttachments } = await import("@/server/sms/actions");
  await extractSmsAttachments({ id: smsId });
};

const handlers: Record<string, JobHandler> = {
  "webhook-digest": webhookDigestHandler,
  "email-digest": emailDigestHandler,
  "sms.attachment_fetch": smsAttachmentFetchHandler
};

export async function processDueJobs(limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
  const jobs = await claimDueJobs(limit);
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    const handler = handlers[job.type];
    if (!handler) {
      await failJob(job.id, job.maxAttempts, `未知任务类型：${job.type}`);
      failed++;
      continue;
    }
    // 逐人同步发邮件可能超过默认 5 分钟租约：给摘要类任务单独延长租约，
    // 避免执行中被第二 worker 重领造成重复投递。
    if (job.type === "email-digest" || job.type === "webhook-digest") {
      await prisma.jobQueue.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { leaseUntil: new Date(Date.now() + 20 * 60_000) }
      });
    }
    try {
      await handler((job.payload ?? {}) as Record<string, unknown>);
      await completeJob(job.id);
      succeeded++;
    } catch (err) {
      await failJob(job.id, job.maxAttempts, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  return { processed: jobs.length, succeeded, failed };
}
