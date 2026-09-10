import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
  findFirst: vi.fn().mockResolvedValue(null),
  audit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { findFirst: mocks.findFirst } } }));
vi.mock("@/server/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/reports/push-weekly", () => ({ runWeeklyReportPush: vi.fn() }));
vi.mock("@/server/reports/weekly", () => ({ weekPeriod: vi.fn(() => ({ label: "2026-07-27 ~ 2026-08-02" })) }));
vi.mock("./jobs/archive-overdue", () => ({ scanArchiveOverdue: vi.fn() }));
vi.mock("./jobs/audit-cleanup", () => ({ runAuditCleanup: vi.fn() }));
vi.mock("./jobs/scan-due-reminders", () => ({ scanDueReminders: vi.fn() }));
vi.mock("./jobs/scan-seal-backfill-reminders", () => ({ scanSealBackfillReminders: vi.fn() }));
vi.mock("./jobs/backup-database", () => ({ runDatabaseBackup: vi.fn(), backupCronEnabled: () => true }));

import {
  isWithinStartupRecoveryWindow,
  recoverMissedCronJobs,
  registerCronJobs,
  scheduledAtForShanghai
} from "./scheduler";

describe("cron startup recovery", () => {
  beforeEach(() => {
    mocks.schedule.mockClear();
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue(null);
    mocks.audit.mockClear();
  });

  it("calculates the Shanghai slot and accepts only the bounded 15-minute window", () => {
    const now = new Date("2026-07-27T01:14:59.000Z"); // 09:14:59 Asia/Shanghai
    const scheduledAt = scheduledAtForShanghai(now, 9, 0, 1);

    expect(scheduledAt?.toISOString()).toBe("2026-07-27T01:00:00.000Z");
    expect(isWithinStartupRecoveryWindow(now, scheduledAt)).toBe(true);
    expect(
      isWithinStartupRecoveryWindow(new Date("2026-07-27T01:15:00.000Z"), scheduledAt)
    ).toBe(false);
    expect(scheduledAtForShanghai(now, 9, 0, 2)).toBeNull();

    const beforeMidnightUtc = new Date("2026-07-26T16:14:59.000Z"); // 00:14:59 Monday Shanghai
    expect(scheduledAtForShanghai(beforeMidnightUtc, 0, 0, 1)?.toISOString()).toBe(
      "2026-07-26T16:00:00.000Z"
    );
  });

  it("registers all jobs without unconditional initialization execution", () => {
    registerCronJobs();

    expect(mocks.schedule).toHaveBeenCalledTimes(6);
    for (const call of mocks.schedule.mock.calls as unknown[][]) {
      expect(call[2]).toMatchObject({ timezone: "Asia/Shanghai" });
    }
  });

  it("checks the exact successful audit target for missed jobs", async () => {
    await recoverMissedCronJobs(new Date("2026-07-27T01:14:59.000Z"));

    expect(mocks.findFirst).toHaveBeenCalledTimes(4);
    expect(mocks.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        action: "WEEKLY_REPORT_PUSH_CRON",
        targetType: "Report",
        targetId: "2026-07-27 ~ 2026-08-02"
      }
    });
  });
});
