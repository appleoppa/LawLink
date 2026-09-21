// @vitest-environment node
/**
 * 台账登记原语（第七轮体检 P2-2 回归）。
 *
 * registerReminderDelivery 的返回值是调用方的统计依据
 * （schedule.ts 的 registered / escalationSent 都按 === "REGISTERED" 计数）。
 * 失败行重武装同样产生了「本次应发项」，必须返回 REGISTERED，
 * 否则重试会真的投递却不计入统计，台账数字与实际送达分叉。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    reminderDelivery: { createMany: vi.fn(), updateMany: vi.fn() }
  } as Record<string, any>
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { registerReminderDelivery, MAX_ATTEMPTS } from "@/server/reminders/ledger";

const KEY = {
  objectType: "DEADLINE" as const,
  objectId: "cdl00000000000000000000001",
  kind: "OFFSET" as const,
  offset: -3,
  channel: "IN_APP" as const,
  dayKey: "2026-09-21",
  userId: "cusr0000000000000000000001"
};

beforeEach(() => {
  db.reminderDelivery.createMany.mockReset();
  db.reminderDelivery.updateMany.mockReset();
});

it("新键插入成功 → REGISTERED", async () => {
  db.reminderDelivery.createMany.mockResolvedValue({ count: 1 });
  expect(await registerReminderDelivery(KEY)).toBe("REGISTERED");
  expect(db.reminderDelivery.updateMany).not.toHaveBeenCalled();
});

it("作废行复活 → REGISTERED", async () => {
  db.reminderDelivery.createMany.mockResolvedValue({ count: 0 });
  db.reminderDelivery.updateMany.mockResolvedValueOnce({ count: 1 }); // revive 分支命中
  expect(await registerReminderDelivery(KEY)).toBe("REGISTERED");
});

it("P2-2：失败行重武装 → REGISTERED（此前错误返回 ALREADY，重试不计入统计）", async () => {
  db.reminderDelivery.createMany.mockResolvedValue({ count: 0 });
  db.reminderDelivery.updateMany
    .mockResolvedValueOnce({ count: 0 })  // 无作废行可复活
    .mockResolvedValueOnce({ count: 1 }); // FAILED 且未超限 → 重武装
  expect(await registerReminderDelivery(KEY)).toBe("REGISTERED");
  const rearmWhere = db.reminderDelivery.updateMany.mock.calls[1][0].where;
  expect(rearmWhere.status).toBe("FAILED");
  expect(rearmWhere.attempts).toEqual({ lt: MAX_ATTEMPTS });
});

it("同键已是 PENDING/SENT → ALREADY（当日去重本身）", async () => {
  db.reminderDelivery.createMany.mockResolvedValue({ count: 0 });
  db.reminderDelivery.updateMany
    .mockResolvedValueOnce({ count: 0 })  // 无作废行
    .mockResolvedValueOnce({ count: 0 }); // 无可重武装的失败行
  expect(await registerReminderDelivery(KEY)).toBe("ALREADY");
});
