// @vitest-environment node
/**
 * 提醒台账保留清理单测（F-1 阶段三）。
 * 覆盖：超期 PENDING 置 FAILED、按保留天数删除明细、天数配置解析容错、审计留痕。
 */
import { it, expect, vi, beforeEach, afterEach } from "vitest";

const { db, auditMock } = vi.hoisted(() => ({
  db: { reminderDelivery: { updateMany: vi.fn(), deleteMany: vi.fn() } },
  auditMock: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));

import { runReminderLedgerCleanup } from "@/server/cron/jobs/reminder-ledger-cleanup";

beforeEach(() => {
  vi.clearAllMocks();
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 2 });
  db.reminderDelivery.deleteMany.mockResolvedValue({ count: 41 });
});

afterEach(() => vi.unstubAllEnvs());

it("超期 PENDING 置终态、按默认 180 天删除明细并写审计", async () => {
  const result = await runReminderLedgerCleanup();
  expect(result).toEqual({ retentionDays: 180, stalePending: 2, deleted: 41 });
  const staleWhere = db.reminderDelivery.updateMany.mock.calls[0][0].where;
  expect(staleWhere).toMatchObject({ status: "PENDING" });
  expect(staleWhere.registeredAt.lt).toBeInstanceOf(Date);
  const deleteWhere = db.reminderDelivery.deleteMany.mock.calls[0][0].where;
  expect(deleteWhere.createdAt.lt).toBeInstanceOf(Date);
  // 滞留窗口（7 天）比删除窗口（180 天）更晚：注册线 - 删除线 ≈ 173 天
  expect(staleWhere.registeredAt.lt.getTime() - deleteWhere.createdAt.lt.getTime()).toBeCloseTo(173 * 86_400_000, -5);
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "REMINDER_LEDGER_CLEANUP_CRON",
    detail: { retentionDays: 180, stalePending: 2, deleted: 41 }
  }));
});

it.each([
  ["90", 90],
  ["invalid", 180],
  ["3", 180] // 低于下限回默认
])("保留天数 %s → %s", async (raw, expected) => {
  vi.stubEnv("REMINDER_LEDGER_RETENTION_DAYS", raw);
  const result = await runReminderLedgerCleanup();
  expect(result.retentionDays).toBe(expected);
});
