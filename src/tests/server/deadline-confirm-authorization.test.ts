// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const { db, canModify, writable, refresh, retire, auditTx } = vi.hoisted(() => ({
  db: { deadline: { findUnique: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn() },
  canModify: vi.fn(), writable: vi.fn(), refresh: vi.fn(), retire: vi.fn(), auditTx: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "user", role: "LAWYER" } })) }));
vi.mock("@/lib/permissions", () => ({ assertCanModifyMatter: canModify }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: writable }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: vi.fn() }));
vi.mock("@/server/audit", () => ({ auditTx }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/reminders/schedule", () => ({ refreshScheduleReminderAfterSave: refresh, retireScheduleReminders: retire }));
import { adjustDeadline, confirmDeadline } from "@/server/deadlines/confirm";
const id = "cidl000000000000000000001";
const updatedAt = new Date("2026-09-19T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.deadline.findUnique.mockResolvedValue({ id, procedure: { matterId: "m1" }, confirmStatus: "PENDING", dueAt: updatedAt, updatedAt });
  db.deadline.updateMany.mockResolvedValue({ count: 1 });
});
it.each(["confirm", "adjust"])("%s 拒绝非案件可修改人员，不改变期限也不发送提醒", async (kind) => {
  canModify.mockRejectedValue(new Error("案件不存在"));
  const call = kind === "confirm" ? confirmDeadline({ id }) : adjustDeadline({ id, dueAt: updatedAt, reason: "送达日期核实" });
  await expect(call).rejects.toThrow("案件不存在");
  expect(db.deadline.updateMany).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("归档案件不能通过期限确认旁路写入", async () => {
  writable.mockRejectedValue(new Error("案件已归档"));
  await expect(confirmDeadline({ id })).rejects.toThrow("已归档");
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("确认竞争失败时不产生审计结果或新提醒", async () => {
  db.deadline.updateMany.mockResolvedValue({ count: 0 });
  await expect(confirmDeadline({ id })).rejects.toThrow("其他人处理");
  expect(auditTx).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("改期受版本保护，旧提醒失效与变更同事务，提交后才刷新提醒", async () => {
  const dueAt = new Date("2026-09-20T00:00:00+08:00");
  await adjustDeadline({ id, dueAt, reason: "送达日期核实" });
  expect(db.deadline.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id, updatedAt }, data: expect.objectContaining({ dueAt, confirmStatus: "ADJUSTED" }) }));
  expect(retire).toHaveBeenCalledWith(db, "Deadline", id);
  expect(auditTx).toHaveBeenCalledWith(db, expect.objectContaining({ action: "DEADLINE_ADJUST" }));
  expect(refresh).toHaveBeenCalledWith("Deadline", id);
});
