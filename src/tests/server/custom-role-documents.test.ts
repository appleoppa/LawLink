// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, approve } = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, sealRequest: { findFirst: vi.fn() }, matter: { count: vi.fn() }, intake: { findUnique: vi.fn() }, document: { findUnique: vi.fn() }, invoiceRequest: { findMany: vi.fn() }, archiveRecord: { findMany: vi.fn() }, auditLog: { findFirst: vi.fn() } }, approve: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: approve, canExecuteInvoice: vi.fn(async () => false) }));
vi.mock("@/lib/approvals/history-access", () => ({ hasHandledApproval: vi.fn(async () => false) }));
import { canReadDocument } from "@/lib/approvals/documents";
const user = { active: true, role: "CUSTOM", roleDefinition: { active: true, name: "行政", permissions: [] } };
const doc = { id: "doc", matterId: "matter", intakeId: null, uploadedById: "u" };
beforeEach(() => { vi.resetAllMocks(); db.user.findUnique.mockResolvedValue(user); db.sealRequest.findFirst.mockResolvedValue(null); db.document.findUnique.mockResolvedValue({ status: "DRAFT" }); db.invoiceRequest.findMany.mockResolvedValue([]); db.archiveRecord.findMany.mockResolvedValue([]); db.auditLog.findFirst.mockResolvedValue(null); approve.mockResolvedValue(false); });
describe("自定义角色附件与申请级访问", () => {
  it("过去上传过案件草稿不等于撤权后仍可下载", async () => expect(await canReadDocument("u", doc)).toBe(false));
  it("申请人可查看已提交的文书，不要求整个案件下载权", async () => { db.document.findUnique.mockResolvedValue({ status: "PENDING_REVIEW" }); expect(await canReadDocument("u", doc)).toBe(true); });
  it("岗位无案件权但已获当前文书审批授权时可查看该附件", async () => { db.document.findUnique.mockResolvedValue({ status: "PENDING_REVIEW" }); approve.mockResolvedValue(true); expect(await canReadDocument("reviewer", doc)).toBe(true); });
  it("角色停用后申请人也不能继续下载", async () => { db.user.findUnique.mockResolvedValue({ ...user, roleDefinition: { ...user.roleDefinition, active: false } }); db.document.findUnique.mockResolvedValue({ status: "APPROVED" }); expect(await canReadDocument("u", doc)).toBe(false); });
  it("收案申请人可查看本次申请关联附件", async () => { db.intake.findUnique.mockResolvedValue({ createdById: "u", ownerUserId: "other", coUserIds: [], status: "PENDING_CONFIRMATION" }); expect(await canReadDocument("u", { ...doc, matterId: null, intakeId: "intake" })).toBe(true); });
});
