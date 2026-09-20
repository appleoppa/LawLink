// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notifications } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    deadline: { findUnique: vi.fn(), findMany: vi.fn() },
    hearing: { findUnique: vi.fn(), findMany: vi.fn() },
    notification: { createMany: vi.fn(), updateMany: vi.fn() }
  },
  notifications: new Set<string>()
}));
vi.mock("@/server/reminders/responsibility",()=>({responsibilityReady:async()=>false,readWorkRows:async()=>[]}));
vi.mock("@/server/approval-permissions/termination",()=>({assertExecutionOpen:async()=>{}}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/reminders/escalation", () => ({ escalateOverdueDeadlineToTeamLeaders: vi.fn(async () => []) }));
import { refreshScheduleReminder, reminderOffset, scanScheduleReminders, shDayStart } from "@/server/reminders/schedule";

const now = new Date("2026-09-19T08:00:00Z"); // 上海下午四点，已过每日扫描时间
const owner = { id: "owner", active: true, role: "LAWYER", roleDefinition: null };
const lead = { ...owner, id: "lead" };
const matter = { id: "m1", internalCode: "TEST", title: "测试案件", deletedAt: null, ownerId: "owner", owner };
const deadline = () => ({
  id: "d1", updatedAt: now, title: "举证期限", dueAt: new Date("2026-09-19T00:00:00+08:00"), completed: false,
  confirmStatus: "CONFIRMED", remindDays: 3, procedure: { matter, leadLawyer: { ...lead }, isExternalLead: false }
});

beforeEach(() => {
  vi.clearAllMocks(); notifications.clear();
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.notification.createMany.mockImplementation(async ({ data }) => {
    const id = data[0].id;
    if (notifications.has(id)) return { count: 0 };
    notifications.add(id); return { count: 1 };
  });
  db.deadline.findUnique.mockResolvedValue(deadline());
  db.hearing.findMany.mockResolvedValue([]);
});

describe("统一日程提醒", () => {
  it("上海日历日与主机时区无关，午夜和夏令时不会错档", () => {
    expect(shDayStart(now).toISOString()).toBe("2026-09-18T16:00:00.000Z");
    expect(reminderOffset(new Date("2026-09-18T23:50:00Z"), now)).toBe(0);
    expect(reminderOffset(new Date("2026-03-08T16:00:00Z"), new Date("2026-03-07T16:00:00Z"))).toBe(-1);
  });
  it("扫描后新增的当日期限立即通知程序主办，重复或并发检查只有一次送达", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => refreshScheduleReminder("Deadline", "d1", now)));
    expect(results.filter((r) => r?.sent)).toHaveLength(1);
    expect(db.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({ userId: "lead", title: "今天到期：举证期限", priority: "HIGH" });
  });
  it("程序主办停用回退案件主办；责任人变化不会被原收件人去重挡住", async () => {
    await refreshScheduleReminder("Deadline", "d1", now);
    const row = deadline(); row.procedure.leadLawyer.active = false;
    db.deadline.findUnique.mockResolvedValue(row);
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.sent).toBe(true);
    expect(db.notification.createMany.mock.lastCall?.[0].data[0].userId).toBe("owner");
  });
  it("已办结、已删除或非提醒日期不产生通知", async () => {
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), completed: true });
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    db.deadline.findUnique.mockResolvedValue(null);
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), dueAt: new Date("2026-10-01T00:00:00+08:00") });
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
  it("待确认期限显式提示核对；确认后产生新的确定日期提醒", async () => {
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), confirmStatus: "PENDING" });
    await refreshScheduleReminder("Deadline", "d1", now);
    expect(db.notification.createMany.mock.lastCall?.[0].data[0].title).toContain("待核期限");
    db.deadline.findUnique.mockResolvedValue(deadline());
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.sent).toBe(true);
  });
  it("周期补扫与保存后的即时检查共用去重，重启后不重复发送", async () => {
    db.deadline.findMany.mockImplementation(async (args) => args.distinct ? [{ remindDays: 3 }] : [{ id: "d1" }]);
    await refreshScheduleReminder("Deadline", "d1", now);
    expect(await scanScheduleReminders(now)).toMatchObject({ deadlineNotified: 0, suppressed: 1 });
  });
  it("当天已过时的新增开庭仍提示核对，同一天改期仍可收到新提醒", async () => {
    const row = { id: "h1", updatedAt: now, title: "开庭", startsAt: new Date("2026-09-19T10:00:00+08:00"), procedure: deadline().procedure };
    db.hearing.findUnique.mockResolvedValue(row);
    expect((await refreshScheduleReminder("Hearing", "h1", now))?.title).toContain("时间已过，请核对");
    db.hearing.findUnique.mockResolvedValue({ ...row, startsAt: new Date("2026-09-19T17:00:00+08:00") });
    expect((await refreshScheduleReminder("Hearing", "h1", now))?.sent).toBe(true);
  });
});
