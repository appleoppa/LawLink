import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, canApprove } = vi.hoisted(() => ({ db: {
  systemSetting: { findUnique: vi.fn() }, user: { findUnique: vi.fn() }, matter: { count: vi.fn() }, intake: { findUnique: vi.fn() },
  document: { findUnique: vi.fn() }, sealRequest: { findFirst: vi.fn() }, invoiceRequest: { findMany: vi.fn() }, archiveRecord: { findMany: vi.fn() }
}, canApprove: vi.fn() }));
vi.mock("@/lib/approvals/history-access", () => ({ hasHandledApproval: vi.fn(async () => false) }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: canApprove }));
import { canReadDocument } from "@/lib/approvals/documents";
const doc = { id: "doc-id", uploadedById: "uploader", matterId: null, intakeId: null };
beforeEach(() => {
  vi.resetAllMocks(); db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  db.matter.count.mockResolvedValue(0); db.document.findUnique.mockResolvedValue({ status: "DRAFT" });
  db.sealRequest.findFirst.mockResolvedValue(null); db.invoiceRequest.findMany.mockResolvedValue([]); db.archiveRecord.findMany.mockResolvedValue([]); canApprove.mockResolvedValue(false);
});
describe("审批附件对象级访问", () => {
  it("没有案件和收案关联的文件仍需授权，猜中文件 ID 不可下载", async () => { expect(await canReadDocument("outsider", doc)).toBe(false); expect(await canReadDocument("uploader", doc)).toBe(true); });
  it("用章审批仅开放该申请的稿件，不能传播到同案其他文件", async () => {
    db.sealRequest.findFirst.mockResolvedValue({ id: "seal-id", requestedById: "applicant", status: "PENDING" }); canApprove.mockResolvedValue(true);
    expect(await canReadDocument("reviewer", { ...doc, matterId: "matter-id" })).toBe(true);
    expect(canApprove).toHaveBeenCalledWith("reviewer", "SEAL_APPROVE", "seal-id");
    db.sealRequest.findFirst.mockResolvedValue(null); expect(await canReadDocument("reviewer", { ...doc, id: "another-doc", matterId: "matter-id" })).toBe(false);
  });
  it("只有团队查看权并不获得附件；财务角色也不获得全所材料", async () => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "FINANCE" }); expect(await canReadDocument("finance", { ...doc, matterId: "matter-id" })).toBe(false);
  });
  it("待审批文书获准后会撤回基于待审状态的临时读取", async () => {
    db.document.findUnique.mockResolvedValue({ status: "PENDING_REVIEW" }); canApprove.mockResolvedValue(true);
    expect(await canReadDocument("reviewer", doc)).toBe(true);
    db.document.findUnique.mockResolvedValue({ status: "APPROVED" }); expect(await canReadDocument("reviewer", doc)).toBe(false);
  });
  it("实际文书审批人可回看原文书，但不会获得其他材料", async () => {
    db.document.findUnique.mockResolvedValue({ status: "APPROVED", approvedById: "reviewer" });
    expect(await canReadDocument("reviewer", doc)).toBe(true);
    db.document.findUnique.mockResolvedValue({ status: "APPROVED", approvedById: "someone-else" });
    expect(await canReadDocument("reviewer", { ...doc, id: "other-file" })).toBe(false);
  });
  it("归档审批只开放材料快照中列明的文件", async () => {
    db.archiveRecord.findMany.mockResolvedValue([{ id: "archive-id", archivedById: "applicant", reviewedById: null, status: "PENDING_REVIEW" }]);
    canApprove.mockResolvedValue(true);
    expect(await canReadDocument("reviewer", { ...doc, id: "snapshot-doc", matterId: "matter-id" })).toBe(true);
    expect(db.archiveRecord.findMany.mock.calls[0][0].where.OR).toContainEqual({ checklistJson: { path: ["documentIds"], array_contains: ["snapshot-doc"] } });
    expect(canApprove).toHaveBeenCalledWith("reviewer", "ARCHIVE_APPROVE", "archive-id");
  });
  it("停用账号、软删除文件都不能读取", async () => {
    db.user.findUnique.mockResolvedValue({ active: false, role: "LAWYER" }); expect(await canReadDocument("user", doc)).toBe(false);
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" }); expect(await canReadDocument("user", { ...doc, deletedAt: new Date() })).toBe(false);
  });
});
