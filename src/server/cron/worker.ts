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
  // 2026-09-20 第五轮审计 P2-4 修复：cron 无请求上下文，不能调用 requireSession 的
  // server action 壳——改以入队粘贴人身份复跑核心（校验 userId 必须是来件收件人）。
  const smsId = String(payload.smsId ?? "");
  const userId = String(payload.userId ?? "");
  if (!smsId) throw new Error("sms.attachment_fetch 缺少 smsId");
  if (!userId) throw new Error("sms.attachment_fetch 缺少 userId（旧任务 payload 无操作人，请手动重试取件）");
  const { prisma } = await import("@/lib/prisma");
  const { resolveRoleUser } = await import("@/lib/roles/service");
  const { runSmsAttachmentExtraction } = await import("@/server/sms/extract-core");
  const sms = await prisma.smsMessage.findUnique({ where: { id: smsId }, select: { receivedById: true } });
  if (!sms) return; // 来件已删除：任务作废，不算失败
  if (sms.receivedById !== userId) throw new Error("sms.attachment_fetch 操作人须为来件收件人");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user || !user.active) throw new Error("sms.attachment_fetch 操作人账号已不存在或停用");
  const actor = await resolveRoleUser(userId, user.role);
  if (!actor.enabled) throw new Error("sms.attachment_fetch 操作人角色已停用");
  await runSmsAttachmentExtraction({ smsId, actor: { id: userId, role: actor.role, roleName: actor.roleName, managerAuthorized: actor.managerAuthorized, rolePermissions: actor.rolePermissions }, source: "queue" });
};

/** B2：来件阅读分析（取件成功后入队；AI/OCR 未配置时文件降级 NEEDS_OCR 可见，不报错重试浪费） */
const smsFileAnalysisHandler: JobHandler = async (payload) => {
  const smsId = String(payload.smsId ?? "");
  if (!smsId) throw new Error("sms.file_analysis 缺少 smsId");
  const { prisma } = await import("@/lib/prisma");
  const { analyzeInboundFile } = await import("@/server/sms/analysis");
  // 2026-09-20 P2-3：排除已入卷文件（documentId 非空）——其 storageKey 指向卷宗存储，
  // 密文部署下读出密文；建议在转正前的暂存文件上产生。
  const files = await prisma.smsInboundFile.findMany({
    where: { smsId, state: { in: ["PENDING_REVIEW", "FILED"] }, analysisState: "PENDING", documentId: null, storageKey: { not: "" } },
    select: { id: true }
  });
  for (const f of files) await analyzeInboundFile(f.id);
};

const handlers: Record<string, JobHandler> = {
  "webhook-digest": webhookDigestHandler,
  "email-digest": emailDigestHandler,
  "sms.attachment_fetch": smsAttachmentFetchHandler,
  "sms.file_analysis": smsFileAnalysisHandler
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
