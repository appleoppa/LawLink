import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { approve, detail, error, success, refresh } = vi.hoisted(() => ({
  approve: vi.fn(), detail: vi.fn(), error: vi.fn(), success: vi.fn(), refresh: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { error, success } }));
vi.mock("@/server/approval-permissions/inbox", () => ({ getApprovalDetail: detail }));
vi.mock("@/app/(app)/approvals/approval-create-menu", () => ({ ApprovalCreateMenu: () => null }));
vi.mock("@/app/(app)/approvals/legacy-seal-classification", () => ({ LegacySealClassification: () => null }));
vi.mock("@/app/(app)/approvals/invoice-recognition", () => ({ InvoiceRecognition: () => null }));
vi.mock("@/server/invoices/actions", () => ({ approveInvoiceRequest: approve, rejectInvoiceRequest: vi.fn() }));
vi.mock("@/server/intakes/actions", () => ({ convertIntakeToMatter: vi.fn(), declineIntake: vi.fn(), markIntakeNeedsRevision: vi.fn() }));
vi.mock("@/server/documents/actions", () => ({ approveDocument: vi.fn(), rejectDocument: vi.fn() }));
vi.mock("@/server/archive/actions", () => ({ approveArchiveRecord: vi.fn(), rejectArchiveRecord: vi.fn() }));
vi.mock("@/server/seals/actions", () => ({ approveSealRequest: vi.fn(), rejectSealRequest: vi.fn(), stampSealRequest: vi.fn() }));
import { approveArchiveRecord } from "@/server/archive/actions";
import { stampSealRequest } from "@/server/seals/actions";
import { ApprovalInbox } from "@/app/(app)/approvals/approval-inbox";
import { AuditView } from "@/app/(admin)/admin/audit/_components/audit-view";
import type { listApprovalWorkspace } from "@/server/approval-permissions/inbox";
function workspace(task: "approve" | "issue" | null = null): Awaited<ReturnType<typeof listApprovalWorkspace>> {
  return { rows: [{ id: "invoice-test", action: "INVOICE_APPROVE", title: "测试申请", submittedAt: new Date(), requester: "申请人", matter: "案件", status: task === "issue" ? "WAITING_INVOICE" : task ? "PENDING" : "ISSUED", task, processedAt: null, processor: null }], counts: { pending: task ? 1 : 0, processed: task ? 0 : 1, mine: 0, all: 1 }, canViewAll: false, total: 1, page: 1, pageSize: 20, query: { tab: task ? "pending" : "processed", page: 1 } };
}
beforeEach(() => {
  vi.resetAllMocks();
  detail.mockResolvedValue({ fields: [{ label: "开票抬头", value: "测试申请" }], attachments: [], history: [], task: "approve", status: "PENDING", title: "测试申请", requester: "申请人", submittedAt: new Date() });
  approve.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("缺陷修复界面流程", () => {
  it("已处理详情展示历史意见且不出现处理表单或审批按钮", async () => {
    detail.mockResolvedValue({ fields: [], attachments: [], task: null, status: "ISSUED", title: "测试申请", history: [{ id: "history", label: "审批通过", userName: "审批人", at: new Date(), note: "已核对合同" }] });
    render(<ApprovalInbox data={workspace()} />);
    expect(screen.queryByRole("tab", { name: /全部记录/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^处理记录/ }), { button: 0, ctrlKey: false });
    expect(screen.getByText("已核对合同")).toBeVisible();
    expect(screen.queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("审批意见或驳回原因")).not.toBeInTheDocument();
  });
  it("待开票详情显示完成开票，不能再驳回，且必须上传发票", async () => {
    detail.mockResolvedValue({ fields: [], attachments: [], history: [], task: "issue", status: "WAITING_INVOICE", title: "测试申请" });
    render(<ApprovalInbox data={workspace("issue")} />);
    fireEvent.click(screen.getByRole("button", { name: "查看并开票" }));
    const issue = await screen.findByRole("button", { name: "完成开票" });
    await waitFor(() => expect(issue).toBeEnabled());
    fireEvent.click(issue);
    expect(error).toHaveBeenCalledWith("请上传电子发票");
    expect(approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
  });
  it("通知深链接可以打开不在当前待办页的已处理申请", async () => {
    detail.mockResolvedValue({ fields: [], attachments: [], history: [], task: null, status: "ISSUED", title: "历史申请" });
    render(<ApprovalInbox data={{ ...workspace(), rows: [], total: 0 }} initialSelection={{ id: "invoice-history", action: "INVOICE_APPROVE" }} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(detail).toHaveBeenCalledWith({ id: "invoice-history", action: "INVOICE_APPROVE" });
    expect(screen.queryByRole("button", { name: "审批通过" })).not.toBeInTheDocument();
  });
  it("上传发票后无号码会提示；补上号码后可提交", async () => {
    render(<ApprovalInbox data={{ rows: [{ id: "invoice-test", action: "INVOICE_APPROVE", title: "测试申请", submittedAt: new Date(), requester: "申请人", matter: "案件", status: "PENDING", task: "approve", processedAt: null, processor: null }], counts: { pending: 1, processed: 0, mine: 0, all: 1 }, canViewAll: true, total: 1, page: 1, pageSize: 20, query: { tab: "pending", page: 1 } }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看并处理" }));
    const upload = await screen.findByLabelText("电子发票（上传后记为已开具）");
    fireEvent.change(upload, { target: { files: [new File(["pdf"], "invoice.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "审批通过" }));
    expect(error).toHaveBeenCalledWith("上传电子发票时必须填写发票号码");
    expect(approve).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("发票号码"), { target: { value: "INV-001" } });
    fireEvent.click(screen.getByRole("button", { name: "审批通过" }));
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    expect(approve.mock.calls[0][0].get("invoiceNo")).toBe("INV-001");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("归档核验与意见跨页签保留，全部核验和例外理由齐备后才可提交", async () => {
    detail.mockResolvedValue({ fields: [], attachments: [{ id: "doc", name: "送审材料.pdf", readable: true }], history: [], task: "approve", status: "PENDING", title: "归档测试", archiveReview: {
      legacy: false, policy: null, items: [{ id: "one", label: "委托手续", required: true, status: "ATTACHED", note: "", documentIds: ["doc"] }],
      documents: [], excludedDocuments: [], manualChecks: [{ id: "review", label: "核对原件", note: "" }], verificationIds: ["item:one", "document:doc", "manual:review"], hasExceptions: true,
    } });
    const data = workspace("approve");
    render(<ApprovalInbox data={{ ...data, rows: [{ ...data.rows[0], action: "ARCHIVE_APPROVE" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看并处理" }));
    const submit = await screen.findByRole("button", { name: "逐项核验并通过" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "核验清单项：委托手续" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "核验文件：送审材料.pdf" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "复核：核对原件" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "核准归档缺项或不适用例外" }));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "已核对例外理由" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^附件/ }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^处理记录/ }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "资料与核验" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("checkbox", { name: "核验清单项：委托手续" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "核准归档缺项或不适用例外" })).toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("已核对例外理由");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(approveArchiveRecord).toHaveBeenCalledWith({ archiveId: "invoice-test", note: "已核对例外理由", verificationIds: ["item:one", "document:doc", "manual:review"], exceptionApproved: true }));
  });
  it("盖章执行仍要求上传扫描件，且不提供再次驳回入口", async () => {
    detail.mockResolvedValue({ fields: [], attachments: [], history: [], task: "stamp", status: "WAITING_STAMP", title: "盖章测试" });
    const data = workspace("approve");
    render(<ApprovalInbox data={{ ...data, rows: [{ ...data.rows[0], action: "SEAL_APPROVE", task: "stamp", status: "WAITING_STAMP" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看并回填" }));
    const submit = await screen.findByRole("button", { name: "完成盖章回填" });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(error).toHaveBeenCalledWith("请上传盖章后的 PDF 扫描件");
    expect(stampSealRequest).not.toHaveBeenCalled();
  });
  it("审计界面只保留管理后台版本", () => {
    render(<AuditView items={[]} distinctActions={[]} userOptions={[]} initialFilters={{ action: "ALL", userId: "ALL", days: "30" }} />);
    expect(screen.getByRole("heading", { name: /审计日志/ })).toBeVisible();
    expect(screen.getByText("没有匹配的审计记录")).toBeVisible();
    expect(screen.queryByRole("button", { name: "检查归档候选" })).not.toBeInTheDocument();
  });
});
