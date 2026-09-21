// @vitest-environment node
/**
 * 归档案卷借阅（F-6）：申请校验（可见性/在途去重）、审批资格复用 ARCHIVE_APPROVE
 * 规则（含自审批排除）、批准登记到期提醒台账（未来 registeredAt）、归还作废提醒、
 * 到期提醒投递复核（已归还 → CANCELLED 零发送）、读取资格实时校验。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, notify, auditMock, approveCtx, scheduleRegister } = vi.hoisted(() => ({
  db: {
    archiveBorrowRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    archiveRecord: { findUnique: vi.fn(), findMany: vi.fn() },
    matter: { findFirst: vi.fn() },
    notification: { findFirst: vi.fn() },
    reminderDelivery: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() }
  },
  notify: vi.fn(),
  auditMock: vi.fn(),
  approveCtx: vi.fn(),
  scheduleRegister: { registerReminderDelivery: vi.fn(), voidPendingDeliveries: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/lib/approvals/service", () => ({ canApproveContext: approveCtx }));
vi.mock("@/server/reminders/ledger", () => scheduleRegister);
vi.mock("@/lib/permissions", () => ({
  matterReadVisibilityFilter: (uid: string) => ({ ownerId: uid })
}));

import { createArchiveBorrow, decideArchiveBorrow, returnArchiveBorrow, hasActiveBorrowGrant } from "@/server/archive/borrow";
import { deliverPendingReminders } from "@/server/reminders/delivery";

const session = vi.hoisted(() => ({ user: { id: "clawyer0000000000000000001", role: "LAWYER", rolePermissions: undefined } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));

const RECORD = "crec000000000000000000001";
const APPLICANT = session.user.id;
const record = () => ({
  id: RECORD, status: "APPROVED",
  matter: { id: "cmatter00000000000000000001", deletedAt: null, internalCode: "M-1", title: "旧案", category: "CIVIL_COMMERCIAL" }
});

beforeEach(() => {
  vi.clearAllMocks();
  db.archiveRecord.findUnique.mockResolvedValue(record());
  db.matter.findFirst.mockResolvedValue({ id: record().matter.id }); // 可见性通过
  db.archiveBorrowRequest.findFirst.mockResolvedValue(null); // 无在途
  db.archiveBorrowRequest.create.mockResolvedValue({ id: "cborrow000000000000000001" });
  scheduleRegister.registerReminderDelivery.mockResolvedValue("REGISTERED");
  scheduleRegister.voidPendingDeliveries.mockResolvedValue(0);
  db.archiveBorrowRequest.updateMany.mockResolvedValue({ count: 1 });
  db.archiveBorrowRequest.update.mockResolvedValue({});
  notify.mockResolvedValue({});
  approveCtx.mockResolvedValue(true);
});

describe("申请", () => {
  it("可见性不通过 → 拒绝", async () => {
    db.matter.findFirst.mockResolvedValue(null);
    await expect(createArchiveBorrow({ archiveRecordId: RECORD, reason: "客户回头咨询，准备再审" })).rejects.toThrow("可见性");
  });
  it("在途借阅去重", async () => {
    db.archiveBorrowRequest.findFirst.mockResolvedValue({ id: "existing" });
    await expect(createArchiveBorrow({ archiveRecordId: RECORD, reason: "客户回头咨询，准备再审" })).rejects.toThrow("在途");
  });
  it("事由过短拒绝；合法申请建单并审计", async () => {
    await expect(createArchiveBorrow({ archiveRecordId: RECORD, reason: "短" })).rejects.toThrow("借阅事由");
    await expect(createArchiveBorrow({ archiveRecordId: RECORD, reason: "客户回头咨询，准备再审" })).resolves.toMatchObject({ ok: true });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "ARCHIVE_BORROW_REQUEST" }));
  });
});

describe("审批", () => {
  const pendingRow = () => ({
    id: "cborrow000000000000000001", status: "PENDING", revision: 0, applicantId: APPLICANT,
    archiveRecord: { id: RECORD, archiveNo: "AR-1", matter: record().matter }
  });
  it("无审批资格拒绝；自审批由 canApproveContext 排除（复用归档审批规则）", async () => {
    db.archiveBorrowRequest.findUnique.mockResolvedValue(pendingRow());
    approveCtx.mockResolvedValue(false);
    await expect(decideArchiveBorrow({ id: "cborrow000000000000000001", revision: 0, decision: "APPROVED" })).rejects.toThrow("审批权限");
    expect(approveCtx).toHaveBeenCalledWith(APPLICANT, expect.objectContaining({ action: "ARCHIVE_APPROVE", requesterId: APPLICANT }));
  });
  it("批准：accessUntil 默认 30 天，登记 T-3/T-0 到期提醒（未来 registeredAt），通知申请人", async () => {
    db.archiveBorrowRequest.findUnique.mockResolvedValue(pendingRow());
    await decideArchiveBorrow({ id: "cborrow000000000000000001", revision: 0, decision: "APPROVED" });
    const update = db.archiveBorrowRequest.updateMany.mock.calls[0][0].data;
    expect(update.status).toBe("APPROVED");
    expect(update.accessUntil.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(scheduleRegister.registerReminderDelivery).toHaveBeenCalledTimes(2); // T-3 与 T-0
    const thirdCall = scheduleRegister.registerReminderDelivery.mock.calls[1];
    expect(thirdCall[0]).toMatchObject({ objectType: "ARCHIVE_BORROW", objectId: "cborrow000000000000000001", kind: "OFFSET" });
    expect(thirdCall[2]).toBeInstanceOf(Date); // 未来应发时刻
    expect(thirdCall[2].getTime()).toBeGreaterThan(Date.now());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: APPLICANT, title: expect.stringContaining("已批准") }));
  });
  it("驳回须理由；并发被他人先处理时报刷新重试", async () => {
    db.archiveBorrowRequest.findUnique.mockResolvedValue(pendingRow());
    await expect(decideArchiveBorrow({ id: "cborrow000000000000000001", revision: 0, decision: "REJECTED" })).rejects.toThrow("驳回请填写理由");
    db.archiveBorrowRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(decideArchiveBorrow({ id: "cborrow000000000000000001", revision: 0, decision: "REJECTED", rejectReason: "材料涉密不宜外借" })).rejects.toThrow("刷新后重试");
  });
});

describe("归还与读取资格", () => {
  it("归还作废未投递提醒并审计", async () => {
    db.archiveBorrowRequest.findUnique.mockResolvedValue({ id: "cborrow000000000000000001", status: "APPROVED", applicantId: APPLICANT, approverId: "other", archiveRecord: { archiveNo: "AR-1" } });
    await returnArchiveBorrow("cborrow000000000000000001");
    expect(scheduleRegister.voidPendingDeliveries).toHaveBeenCalledWith("ARCHIVE_BORROW", ["cborrow000000000000000001"], "CANCELLED", "BORROW_RETURNED");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "ARCHIVE_BORROW_RETURN" }));
  });
  it("读取资格实时校验：有效 APPROVED 单通过，过期不通过", async () => {
    db.archiveBorrowRequest.findFirst.mockResolvedValueOnce({ id: "cborrow000000000000000001" });
    await expect(hasActiveBorrowGrant(APPLICANT, RECORD)).resolves.toBe(true);
    db.archiveBorrowRequest.findFirst.mockResolvedValueOnce(null);
    await expect(hasActiveBorrowGrant(APPLICANT, RECORD)).resolves.toBe(false);
  });
});

describe("到期提醒投递（复核）", () => {
  const row = (offset: number) => ({
    id: "row-b1", objectType: "ARCHIVE_BORROW", objectId: "cborrow000000000000000001", kind: "OFFSET",
    offset, channel: "IN_APP", dayKey: "", userId: APPLICANT, attempts: 0
  });
  it("借阅单有效 → 送达到期提醒", async () => {
    db.reminderDelivery.findMany.mockResolvedValue([row(0)]);
    db.archiveBorrowRequest.findUnique.mockResolvedValue({
      id: "cborrow000000000000000001", status: "APPROVED", accessUntil: new Date(Date.now() + 3_600_000), applicantId: APPLICANT,
      archiveRecord: { archiveNo: "AR-1", matter: { id: "m1", title: "旧案", internalCode: "M-1" } }
    });
    db.notification.findFirst.mockResolvedValue(null);
    const result = await deliverPendingReminders();
    expect(result).toMatchObject({ sent: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: APPLICANT, title: expect.stringContaining("今日到期") }));
  });
  it("已归还 → CANCELLED 零发送（提醒随对象消亡）", async () => {
    db.reminderDelivery.findMany.mockResolvedValue([row(0)]);
    db.archiveBorrowRequest.findUnique.mockResolvedValue({
      id: "cborrow000000000000000001", status: "RETURNED", accessUntil: new Date(Date.now() + 3_600_000), applicantId: APPLICANT,
      archiveRecord: { archiveNo: "AR-1", matter: { id: "m1", title: "旧案", internalCode: "M-1" } }
    });
    const result = await deliverPendingReminders();
    expect(result).toMatchObject({ voided: 1, sent: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});
