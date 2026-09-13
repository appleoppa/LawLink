/**
 * 队列 worker（P1-1）：领取到期任务并按类型执行。
 *
 * 处理器注册表集中在此；调度器每 2 分钟 tick 一次（生产），手动「立即
 * 扫描」也会在扫描后顺带处理一批（开发环境可验证全链路）。
 * 任务失败走队列自身的退避/死信，不在此处吞错。
 */
import { sendWebhookText } from "@/server/settings/webhook";
import { saveWebhookLastResult, type ReminderWebhookLastResult } from "@/server/settings/webhook-last-result";
import { claimDueJobs, completeJob, failJob } from "./queue";

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

const handlers: Record<string, JobHandler> = {
  "webhook-digest": webhookDigestHandler
};

export async function processDueJobs(limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
  const jobs = await claimDueJobs(limit);
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    const handler = handlers[job.type];
    if (!handler) {
      await failJob(job.id, job.attempts, job.maxAttempts, `未知任务类型：${job.type}`);
      failed++;
      continue;
    }
    try {
      await handler((job.payload ?? {}) as Record<string, unknown>);
      await completeJob(job.id);
      succeeded++;
    } catch (err) {
      await failJob(job.id, job.attempts, job.maxAttempts, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  return { processed: jobs.length, succeeded, failed };
}
