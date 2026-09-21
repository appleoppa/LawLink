// @vitest-environment node
/**
 * 邮件摘要（email-digest）处理器单测（2026-09-21，第六轮体检 P1-4/P2-3 防线）。
 *
 * 覆盖：
 * - 按人聚合：先取当日有通知的用户集再逐人取通知——不存在全局截断
 *   （P2-3：此前全局 take:500，当天较晚产生的通知不出现在任何人摘要里）；
 * - 单人超 50 条时文末标注截断；
 * - SMTP 未配置：不发送，但「跳过」写台账（P1-4，不再静默 return）；
 * - 发送失败：失败原因写台账并抛错交队列重试（任务失败，不伪装成功）。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db, sendMail, saveEmail, saveWebhook, claimDueJobs, completeJob, failJob } = vi.hoisted(() => {
  return {
    db: { notification: { findMany: vi.fn() }, user: { findMany: vi.fn() }, jobQueue: { updateMany: vi.fn() }, reminderDelivery: { findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }, systemSetting: { upsert: vi.fn() } },
    sendMail: vi.fn(),
    saveEmail: vi.fn(),
    saveWebhook: vi.fn(),
    claimDueJobs: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn()
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/notifications/email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendReminderEmail: sendMail
}));
vi.mock("@/server/settings/email-last-result", () => ({ saveEmailLastResult: saveEmail }));
vi.mock("@/server/settings/webhook-last-result", () => ({ saveWebhookLastResult: saveWebhook }));
vi.mock("@/server/cron/queue", () => ({ claimDueJobs, completeJob, failJob, recoverStaleLeases: vi.fn() }));
vi.mock("@/server/settings/webhook", () => ({ sendWebhookText: vi.fn(async () => ({ ok: true, skipped: true })) }));

import { processDueJobs } from "@/server/cron/worker";
import { isEmailConfigured } from "@/lib/notifications/email";

const USER_A = "cuser00000000000000000001";
const USER_B = "cuser00000000000000000002";

function digestJob() {
  return { id: "job-1", type: "email-digest", maxAttempts: 3, payload: {}, leaseUntil: new Date(Date.now() + 60_000), status: "RUNNING" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isEmailConfigured).mockReturnValue(true);
  claimDueJobs.mockResolvedValue([digestJob()]);
  db.jobQueue.updateMany.mockResolvedValue({ count: 1 });
  sendMail.mockResolvedValue(undefined);
  saveEmail.mockResolvedValue(undefined);
  // F-1 阶段三：台账默认无已发记录（不触发重试跳过）、落账成功
  db.reminderDelivery.findFirst.mockResolvedValue(null);
  db.reminderDelivery.createMany.mockResolvedValue({ count: 1 });
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 0 });
});

it("按人聚合外发：每个当日有通知的用户各收到一封，无全局截断", async () => {
  // distinct 查询返回当日用户集；逐人查询按 where.userId 分流
  db.notification.findMany.mockImplementation(async (args: any) => {
    if (args.distinct) return [{ userId: USER_A }, { userId: USER_B }];
    const notes: Record<string, { title: string; content: string | null }[]> = {
      [USER_A]: [{ title: "期限今天到期", content: "案 M-1 举证期限" }, { title: "开庭提醒", content: null }],
      [USER_B]: [{ title: "保全还有 7 天到期", content: "张三 · 银行账户" }]
    };
    return notes[args.where.userId] ?? [];
  });
  db.user.findMany.mockResolvedValue([
    { id: USER_A, name: "律师甲", email: "a@example.com" },
    { id: USER_B, name: "律师乙", email: "b@example.com" }
  ]);

  const result = await processDueJobs(10);
  expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  expect(sendMail).toHaveBeenCalledTimes(2);
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com", userName: "律师甲", lines: expect.arrayContaining(["期限今天到期：案 M-1 举证期限", "开庭提醒"]) }));
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "b@example.com", lines: expect.arrayContaining(["保全还有 7 天到期：张三 · 银行账户"]) }));
  expect(saveEmail).toHaveBeenCalledWith(expect.objectContaining({ skipped: false, sentCount: 2, userCount: 2 }));
  // F-1 阶段三：每位接收人落一行 SENT 台账（DIGEST/EMAIL/当日键）
  const sentRows = db.reminderDelivery.createMany.mock.calls.map((c: any[]) => c[0].data[0]);
  expect(sentRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ objectType: "DIGEST", channel: "EMAIL", userId: USER_A, status: "SENT" }),
    expect.objectContaining({ objectType: "DIGEST", channel: "EMAIL", userId: USER_B, status: "SENT" })
  ]));
  expect(completeJob).toHaveBeenCalledWith("job-1");
});

it("队列重试整批重跑：当日已 SENT 的接收人跳过不重发（台账防重复投递）", async () => {
  db.notification.findMany.mockImplementation(async (args: any) => {
    if (args.distinct) return [{ userId: USER_A }, { userId: USER_B }];
    return [{ title: "提醒", content: null }];
  });
  db.user.findMany.mockResolvedValue([
    { id: USER_A, name: "律师甲", email: "a@example.com" },
    { id: USER_B, name: "律师乙", email: "b@example.com" }
  ]);
  // 甲当日已 SENT（上次重试前成功），乙尚未
  db.reminderDelivery.findFirst.mockImplementation(async (args: any) =>
    args.where.userId === USER_A ? { id: "sent" } : null
  );

  await processDueJobs(10);
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(sendMail.mock.calls[0][0].to).toBe("b@example.com");
});

it("单人当日通知超过 50 条：摘要文末标注截断，仍完整发送", async () => {
  db.notification.findMany.mockImplementation(async (args: any) => {
    if (args.distinct) return [{ userId: USER_A }];
    return Array.from({ length: args.take }, (_, i) => ({ title: `提醒 ${i + 1}`, content: null }));
  });
  db.user.findMany.mockResolvedValue([{ id: USER_A, name: "律师甲", email: "a@example.com" }]);

  await processDueJobs(10);
  expect(sendMail).toHaveBeenCalledTimes(1);
  const lines = vi.mocked(sendMail).mock.calls[0][0].lines;
  expect(lines).toHaveLength(51); // 50 条 + 1 条截断标注
  expect(lines[lines.length - 1]).toContain("超过 50 条");
});

it("SMTP 未配置：不发送，跳过结果写台账（P1-4 不再静默）", async () => {
  vi.mocked(isEmailConfigured).mockReturnValue(false);

  const result = await processDueJobs(10);
  expect(result).toMatchObject({ succeeded: 1, failed: 0 });
  expect(sendMail).not.toHaveBeenCalled();
  expect(db.notification.findMany).not.toHaveBeenCalled();
  expect(saveEmail).toHaveBeenCalledWith(expect.objectContaining({
    configured: false,
    skipped: true,
    skipReason: expect.stringContaining("SMTP 未配置")
  }));
  // 通道级 SKIPPED 台账行（userId 空串）
  expect(db.reminderDelivery.createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: [expect.objectContaining({ objectType: "DIGEST", channel: "EMAIL", userId: "", status: "SKIPPED" })]
  }));
});

it("发送失败：失败原因写台账并交队列重试，不伪装成功", async () => {
  db.notification.findMany.mockImplementation(async (args: any) => {
    if (args.distinct) return [{ userId: USER_A }];
    return [{ title: "期限今天到期", content: null }];
  });
  db.user.findMany.mockResolvedValue([{ id: USER_A, name: "律师甲", email: "a@example.com" }]);
  sendMail.mockRejectedValue(new Error("SMTP connection refused"));

  const result = await processDueJobs(10);
  expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1 });
  expect(failJob).toHaveBeenCalledWith("job-1", 3, "SMTP connection refused");
  expect(completeJob).not.toHaveBeenCalled();
  expect(saveEmail).toHaveBeenCalledWith(expect.objectContaining({
    skipped: false,
    error: "SMTP connection refused"
  }));
  // 失败接收人落 FAILED 台账行
  expect(db.reminderDelivery.createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: [expect.objectContaining({ objectType: "DIGEST", channel: "EMAIL", userId: USER_A, status: "FAILED" })]
  }));
});
