import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
  findFirst: vi.fn().mockResolvedValue(null),
  audit: vi.fn().mockResolvedValue(undefined),
  runWeeklyReportPush: vi.fn().mockResolvedValue({ succeeded: 0, failed: [], weekLabel: "2026-07-27 ~ 2026-08-02" }),
  recoverStaleLeases: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { findFirst: mocks.findFirst } } }));
vi.mock("@/server/audit", () => ({ audit: mocks.audit }));
// v2.0.1 起周报核心迁到 weekly-push-core；scheduler 从这里取 runWeeklyReportPush。
vi.mock("@/server/reports/weekly-push-core", () => ({ runWeeklyReportPush: mocks.runWeeklyReportPush }));
vi.mock("@/server/reports/weekly", () => ({ weekPeriod: vi.fn(() => ({ label: "2026-07-27 ~ 2026-08-02" })) }));
vi.mock("./jobs/archive-overdue", () => ({ scanArchiveOverdue: vi.fn() }));
vi.mock("./jobs/audit-cleanup", () => ({ runAuditCleanup: vi.fn() }));
vi.mock("./jobs/reminder-ledger-cleanup", () => ({ runReminderLedgerCleanup: vi.fn() }));
vi.mock("./jobs/scan-due-reminders", () => ({ scanDueReminders: vi.fn(), scanPreservationReminders: vi.fn() }));
vi.mock("./jobs/scan-seal-backfill-reminders", () => ({ scanSealBackfillReminders: vi.fn() }));
vi.mock("./jobs/backup-database", () => ({ runDatabaseBackup: vi.fn(), backupCronEnabled: () => true }));
vi.mock("./queue", () => ({ recoverStaleLeases: mocks.recoverStaleLeases }));
vi.mock("./worker", () => ({ processDueJobs: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ scanScheduleReminders: vi.fn() }));
vi.mock("@/server/reminders/delivery", () => ({ deliverPendingReminders: vi.fn() }));

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
    mocks.runWeeklyReportPush.mockClear();
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

  it("registers every job with the Shanghai timezone and runs nothing unconditionally", () => {
    registerCronJobs();

    // v2.0.1 job 集：周报推送 / 归档逾期扫描 / AuditLog 清理 / 台账保留清理 /
    // 到期提醒扫描 / 用章回填提醒扫描 / 数据库备份（backupCronEnabled=true）/ 队列 worker。
    expect(mocks.schedule).toHaveBeenCalledTimes(8);
    for (const call of mocks.schedule.mock.calls as unknown[][]) {
      expect(call[2]).toMatchObject({ timezone: "Asia/Shanghai" });
    }
    // 启动时只做租约恢复，不得无条件立刻执行 job。
    expect(mocks.recoverStaleLeases).toHaveBeenCalledTimes(1);
    expect(mocks.runWeeklyReportPush).not.toHaveBeenCalled();
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
