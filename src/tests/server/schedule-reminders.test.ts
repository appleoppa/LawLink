// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, ledgerKeys } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    deadline: { findUnique: vi.fn(), findMany: vi.fn() },
    hearing: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), count: vi.fn() },
    notification: { createMany: vi.fn(), updateMany: vi.fn() },
    reminderDelivery: { createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() }
  },
  ledgerKeys: new Set<string>()
}));
vi.mock("@/server/reminders/responsibility",()=>({responsibilityReady:async()=>false,readWorkRows:async()=>[]}));
vi.mock("@/server/approval-permissions/termination",()=>({assertExecutionOpen:async()=>{}}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/reminders/escalation", () => ({ escalateOverdueDeadlineToTeamLeaders: vi.fn(async () => []) }));
import { refreshScheduleReminder, reminderOffset, scanScheduleReminders, shDayStart, retireScheduleReminders } from "@/server/reminders/schedule";

const now = new Date("2026-09-19T08:00:00Z"); // 上海下午四点，已过每日扫描时间
const owner = { id: "owner", active: true, role: "LAWYER", roleDefinition: null };
const lead = { ...owner, id: "lead" };
const matter = { id: "m1", internalCode: "TEST", title: "测试案件", deletedAt: null, ownerId: "owner", owner };
const deadline = () => ({
  id: "d1", updatedAt: now, title: "举证期限", dueAt: new Date("2026-09-19T00:00:00+08:00"), completed: false,
  confirmStatus: "CONFIRMED", remindDays: 3, procedure: { matter, leadLawyer: { ...lead }, isExternalLead: false }
});

beforeEach(() => {
  vi.clearAllMocks(); ledgerKeys.clear();
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.user.count.mockResolvedValue(1);
  db.notification.createMany.mockResolvedValue({ count: 1 });
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 0 });
  // 登记幂等模拟：当日同键 createMany 计数 0（ON CONFLICT DO NOTHING 语义）
  db.reminderDelivery.createMany.mockImplementation(async (args: any) => {
    const d = args.data[0];
    const k = [d.objectType, d.objectId, d.kind, d.offset, d.dayKey, d.userId].join("|");
    if (ledgerKeys.has(k)) return { count: 0 };
    ledgerKeys.add(k);
    return { count: 1 };
  });
  db.deadline.findUnique.mockResolvedValue(deadline());
  db.hearing.findMany.mockResolvedValue([]);
});

describe("统一日程提醒登记（F-1 阶段二）", () => {
  it("上海日历日与主机时区无关，午夜和夏令时不会错档", () => {
    expect(shDayStart(now).toISOString()).toBe("2026-09-18T16:00:00.000Z");
    expect(reminderOffset(new Date("2026-09-18T23:50:00Z"), now)).toBe(0);
    expect(reminderOffset(new Date("2026-03-08T16:00:00Z"), new Date("2026-03-07T16:00:00Z"))).toBe(-1);
  });
  it("扫描后新增的当日期限立即登记给程序主办，重复或并发登记只有一次 REGISTERED（不直接建通知）", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => refreshScheduleReminder("Deadline", "d1", now)));
    expect(results.filter((r) => r?.registered)).toHaveLength(1);
    expect(db.reminderDelivery.createMany.mock.calls[0][0].data[0]).toMatchObject({
      objectType: "DEADLINE", objectId: "d1", kind: "OFFSET", offset: 0, channel: "IN_APP", userId: "lead", status: "PENDING"
    });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
  it("程序主办停用回退案件主办；责任人变化产生新键的登记", async () => {
    await refreshScheduleReminder("Deadline", "d1", now);
    const row = deadline(); row.procedure.leadLawyer.active = false;
    db.deadline.findUnique.mockResolvedValue(row);
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.registered).toBe(true);
    expect(db.reminderDelivery.createMany.mock.lastCall?.[0].data[0].userId).toBe("owner");
  });
  it("已办结、已删除或非提醒日期不登记", async () => {
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), completed: true });
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    db.deadline.findUnique.mockResolvedValue(null);
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), dueAt: new Date("2026-10-01T00:00:00+08:00") });
    expect(await refreshScheduleReminder("Deadline", "d1", now)).toBeNull();
    expect(db.reminderDelivery.createMany).not.toHaveBeenCalled();
  });
  it("待核期限在评估标题中显式提示；确认路径先作废再重登记（复活）", async () => {
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), confirmStatus: "PENDING" });
    const pendingOutcome = await refreshScheduleReminder("Deadline", "d1", now);
    expect(pendingOutcome?.title).toContain("待核期限");
    // 真实流程：确认时 retire 作废旧行（含通知），随后 AfterSave 重登记
    await retireScheduleReminders(db as any, "Deadline", "d1", now);
    db.deadline.findUnique.mockResolvedValue(deadline());
    db.reminderDelivery.updateMany.mockResolvedValueOnce({ count: 1 }); // 复活 updateMany 命中
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.registered).toBe(true);
  });
  it("retire 作废 PENDING 登记后同日重开：作废行被重新武装为 PENDING（复活）", async () => {
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.registered).toBe(true);
    await retireScheduleReminders(db as any, "Deadline", "d1", now, "CANCELLED");
    expect(db.reminderDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ objectType: "DEADLINE", objectId: "d1", status: "PENDING" }),
      data: expect.objectContaining({ status: "CANCELLED" })
    }));
    // 同日重开：同键 create 撞 P2002 → 复活作废行 → REGISTERED
    db.reminderDelivery.updateMany.mockResolvedValueOnce({ count: 1 }); // 复活 updateMany 命中
    expect((await refreshScheduleReminder("Deadline", "d1", now))?.registered).toBe(true);
    expect(db.reminderDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ objectType: "DEADLINE", status: { in: ["SUPERSEDED", "CANCELLED"] } }),
      data: expect.objectContaining({ status: "PENDING" })
    }));
  });
  it("周期补扫与保存后的即时登记共用去重，重启后不重复登记", async () => {
    db.deadline.findMany.mockImplementation(async (args) => args.distinct ? [{ remindDays: 3 }] : [{ id: "d1" }]);
    await refreshScheduleReminder("Deadline", "d1", now);
    expect(await scanScheduleReminders(now)).toMatchObject({ deadlineNotified: 0, suppressed: 1 });
  });
  it("逾期期限在扫描中登记 ESCALATION 行（受众投递时解析）", async () => {
    db.deadline.findMany.mockImplementation(async (args) => args.distinct ? [{ remindDays: 3 }] : [{ id: "d1" }]);
    db.deadline.findUnique.mockResolvedValue({ ...deadline(), dueAt: new Date("2026-09-18T00:00:00+08:00") }); // 逾期 1 天
    const result = await scanScheduleReminders(now);
    expect(result.escalationSent).toBe(1);
    expect(db.reminderDelivery.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ objectType: "DEADLINE", kind: "ESCALATION", offset: 1, userId: "" })],
      skipDuplicates: true
    }));
  });
});
