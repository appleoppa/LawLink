// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, session, canApprove } = vi.hoisted(() => {
  const tables = ["intake", "document", "archiveRecord", "invoiceRequest", "sealRequest", "auditLog"] as const;
  const models = Object.fromEntries(tables.map(t => [t, { findMany: vi.fn(), findFirst: vi.fn() }])) as Record<typeof tables[number], { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> }>;
  return { db: models, session: { user: { id: "reviewer", role: "LAWYER", systemRole: "NONE" } }, canApprove: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => session }));
vi.mock("@/lib/approvals/service", () => ({ canApproveItem: canApprove, canExecuteInvoice: (userId: string, id: string) => canApprove(userId, "INVOICE_APPROVE", id) }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: vi.fn() }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { listApprovalWorkspace } from "@/server/approval-permissions/inbox";
import { requireApprovalRecord } from "@/server/approval-permissions/records";
import { hasHandledApproval } from "@/lib/approvals/history-access";

const at = new Date("2026-09-01T02:00:00Z");
const later = new Date("2026-09-02T02:00:00Z");
const invoice = { id: "invoice", buyerName: "测试开票", title: null, status: "ISSUED", requestedAt: at, requestedById: "applicant", requestedBy: { name: "申请人" }, processedById: "issuer", processedBy: { name: "开票人" }, processedAt: later, processNote: "开票说明", matter: { title: "测试案件" } };
function event(action: string, userId = "reviewer", time = at, detail = {}) { return { id: action + time.toISOString(), action, targetId: "invoice", targetType: "InvoiceRequest", userId, user: { name: userId }, createdAt: time, detail }; }
beforeEach(() => {
  vi.resetAllMocks(); session.user.id = "reviewer"; session.user.role = "LAWYER"; session.user.systemRole = "NONE";
  for (const model of Object.values(db)) { model.findMany.mockResolvedValue([]); model.findFirst.mockResolvedValue(null); }
  canApprove.mockResolvedValue(false);
});
describe("统一审批工作台的历史与权限", () => {
  it("曾审批人撤权后仍能查到自己的批准记录，不因随后由其他人开票而消失", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([invoice]);
    db.auditLog.findMany.mockResolvedValue([event("INVOICE_APPROVED", "reviewer", at, { note: "原审批意见" }), event("INVOICE_ISSUED", "issuer", later, { note: "后续开票" })]);
    const result = await listApprovalWorkspace({ tab: "processed" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull();
    const detail = await requireApprovalRecord(session.user, { id: "invoice", action: "INVOICE_APPROVE" });
    expect(detail.row.history.map(h => h.note)).toEqual(["原审批意见", "后续开票"]);
    expect(canApprove).not.toHaveBeenCalled();
  });
  it("已处理申请不会因当前拥有同类审批权限而对未参与人开放", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([invoice]); canApprove.mockResolvedValue(true);
    expect((await listApprovalWorkspace({ tab: "processed" })).rows).toEqual([]);
    await expect(requireApprovalRecord(session.user, { id: "invoice", action: "INVOICE_APPROVE" })).rejects.toThrow("不可查看");
  });
  it("申请人可以跟进结果，但不会自动获得处理按钮", async () => {
    session.user.id = "applicant"; db.invoiceRequest.findMany.mockResolvedValue([invoice]);
    const result = await listApprovalWorkspace({ tab: "mine" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull(); expect(result.counts.processed).toBe(0);
  });
  it("非管理员伪造全部记录参数时拒绝读取", async () => {
    await expect(listApprovalWorkspace({ tab: "all" })).rejects.toThrow("仅管理员");
    expect(db.invoiceRequest.findMany).not.toHaveBeenCalled();
  });
  it("系统管理员可审计全部，但无事项授权时不可处理", async () => {
    session.user.systemRole = "SUPER_ADMIN"; db.invoiceRequest.findMany.mockResolvedValue([{ ...invoice, status: "PENDING", processedAt: null, processedById: null }]);
    const result = await listApprovalWorkspace({ tab: "all" });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].task).toBeNull(); expect(result.counts.pending).toBe(0);
  });
  it("已批准开票与用章以执行环节进入待办，用章回填验证单独授权", async () => {
    db.invoiceRequest.findMany.mockResolvedValue([{ ...invoice, status: "APPROVED" }]);
    db.sealRequest.findMany.mockResolvedValue([{ id: "seal", documentTitle: "测试用章", status: "APPROVED", requestedAt: at, requestedById: "applicant", requestedBy: { name: "申请人" }, matter: null }]);
    canApprove.mockResolvedValue(true);
    const result = await listApprovalWorkspace();
    expect(result.rows.map(r => r.task)).toEqual(["issue", "stamp"]);
    expect(canApprove).toHaveBeenCalledWith("reviewer", "SEAL_STAMP", "seal");
  });
  it("重新提交的文书保留前次驳回意见；普通草稿材料不混入审批", async () => {
    db.document.findMany.mockResolvedValue([{ id: "doc", name: "测试文书", status: "PENDING_REVIEW", createdAt: at, updatedAt: later, uploadedById: "applicant", uploadedBy: { name: "申请人" }, matter: null }, { id: "plain", name: "普通附件", status: "DRAFT", createdAt: at, uploadedById: "applicant", uploadedBy: { name: "申请人" }, matter: null }]);
    db.auditLog.findMany.mockResolvedValue([{ ...event("DOCUMENT_REJECT", "reviewer", at, { reason: "补充签名" }), targetId: "doc", targetType: "Document" }, { ...event("DOCUMENT_SUBMIT_REVIEW", "applicant", later), targetId: "doc", targetType: "Document" }]);
    const result = await listApprovalWorkspace({ tab: "processed" });
    expect(result.rows.map(r => r.id)).toEqual(["doc"]);
    const detail = await requireApprovalRecord(session.user, { id: "doc", action: "DOCUMENT_APPROVE" });
    expect(detail.row.history[0].note).toBe("补充签名"); expect(detail.row.history).toHaveLength(2);
  });
  it("搜索、事项、日期和分页在授权过滤后执行，不提前截断自己的记录", async () => {
    session.user.id = "applicant";
    db.invoiceRequest.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...invoice, id: "invoice-" + i })));
    const result = await listApprovalWorkspace({ tab: "mine", type: "INVOICE_APPROVE", q: "测试案件", start: "2026-09-01", end: "2026-09-01", page: 2 });
    expect(result.total).toBe(25); expect(result.rows).toHaveLength(5); expect(result.page).toBe(2);
    expect((await listApprovalWorkspace({ tab: "mine", start: "2026-09-03" })).rows).toEqual([]);
  });
  it("历史附件以当次快照明确关联，不能用文件创建时间推测", async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: "event" });
    expect(await hasHandledApproval("reviewer", "INTAKE_APPROVE", "intake", "original-doc")).toBe(true);
    expect(db.auditLog.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "reviewer", targetId: "intake", targetType: "Intake", detail: { path: ["attachmentIds"], array_contains: ["original-doc"] } });
    db.auditLog.findFirst.mockResolvedValue(null);
    expect(await hasHandledApproval("reviewer", "INTAKE_APPROVE", "intake", "new-doc")).toBe(false);
  });
});
