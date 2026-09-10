import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([{ id: "user-1", name: "测试用户" }]),
  findFirst: vi.fn().mockResolvedValue({ id: "existing-notification" }),
  createNotification: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined),
  weekPeriod: vi.fn(() => ({ label: "2026-07-27 ~ 2026-08-02", start: new Date(), end: new Date() })),
  getLawyerWeeklyDigest: vi.fn(),
  formatWeeklyDigestContent: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: mocks.findMany }, notification: { findFirst: mocks.findFirst } }
}));
vi.mock("@/server/notifications/create", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/server/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn() }));
vi.mock("./weekly", () => ({
  weekPeriod: mocks.weekPeriod,
  getLawyerWeeklyDigest: mocks.getLawyerWeeklyDigest,
  formatWeeklyDigestContent: mocks.formatWeeklyDigestContent
}));

import { runWeeklyReportPush } from "./push-weekly";

describe("weekly report push idempotency", () => {
  beforeEach(() => {
    mocks.findMany.mockClear();
    mocks.findFirst.mockReset();
    mocks.createNotification.mockReset();
    mocks.getLawyerWeeklyDigest.mockReset();
    mocks.formatWeeklyDigestContent.mockReset();
    mocks.audit.mockClear();
  });

  it("does not create a second notification for the same user and week", async () => {
    mocks.findFirst.mockResolvedValue({ id: "existing-notification" });
    const result = await runWeeklyReportPush(null);

    expect(result).toMatchObject({ succeeded: 1, failed: [], weekLabel: "2026-07-27 ~ 2026-08-02" });
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.getLawyerWeeklyDigest).not.toHaveBeenCalled();
  });

  it("creates a notification when the weekly marker is absent", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.getLawyerWeeklyDigest.mockResolvedValue({
      userId: "user-1",
      userName: "测试用户",
      period: mocks.weekPeriod(),
      newIntake: 1,
      closed: 2,
      archived: 3,
      receivedAmount: 4
    });
    mocks.formatWeeklyDigestContent.mockReturnValue("摘要");
    mocks.createNotification.mockResolvedValue({ id: "notification-1" });

    const result = await runWeeklyReportPush(null);

    expect(result).toMatchObject({ succeeded: 1, failed: [] });
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        refType: "WeeklyReport",
        refId: "2026-07-27 ~ 2026-08-02"
      })
    );
  });
});
