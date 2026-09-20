import type { ApprovalAction } from "@prisma/client";

export const WORKSPACE_TABS = { pending: "待我审批", processed: "我已处理", mine: "我的申请", all: "全部记录" } as const;
export type WorkspaceTab = keyof typeof WORKSPACE_TABS;
export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  EXECUTION_TERMINATED: "已终止执行", TERMINATION_PENDING: "终止待核实",
  PENDING: "待审批", APPROVED: "已通过", CONVERTED: "已通过 · 已立案", NEEDS_REVISION: "退回补正",
  DECLINED: "不接案", REJECTED: "已驳回", DRAFT: "待重新送审", FILED: "已归档",
  WAITING_INVOICE: "已通过 · 待开票", ISSUED: "已开票", WAITING_STAMP: "已通过 · 待盖章", STAMPED: "已盖章", CANCELLED: "已撤回"
};
export const APPROVAL_EVENTS: Record<string, { action: ApprovalAction; label: string; decision: boolean }> = {
  INVOICE_TERMINATION_REQUEST: { action: "INVOICE_APPROVE", label: "申请终止执行", decision: false },
  INVOICE_TERMINATION_CONFIRMED: { action: "INVOICE_APPROVE", label: "确认终止执行", decision: true },
  INVOICE_TERMINATION_REJECTED: { action: "INVOICE_APPROVE", label: "不予终止执行", decision: true },
  INVOICE_TERMINATION_CANCELLED: { action: "INVOICE_APPROVE", label: "撤回终止申请", decision: true },
  SEAL_TERMINATION_REQUEST: { action: "SEAL_APPROVE", label: "申请终止执行", decision: false },
  SEAL_TERMINATION_CONFIRMED: { action: "SEAL_APPROVE", label: "确认终止执行", decision: true },
  SEAL_TERMINATION_REJECTED: { action: "SEAL_APPROVE", label: "不予终止执行", decision: true },
  SEAL_TERMINATION_CANCELLED: { action: "SEAL_APPROVE", label: "撤回终止申请", decision: true },

  INTAKE_APPROVE: { action: "INTAKE_APPROVE", label: "审批通过", decision: true },
  INTAKE_CONVERT: { action: "INTAKE_APPROVE", label: "转为正式案件", decision: true },
  INTAKE_DECLINE: { action: "INTAKE_APPROVE", label: "不接案", decision: true },
  INTAKE_NEEDS_REVISION: { action: "INTAKE_APPROVE", label: "退回补正", decision: true },
  INTAKE_RESUBMIT: { action: "INTAKE_APPROVE", label: "重新提交", decision: false },
  DOCUMENT_SUBMIT_REVIEW: { action: "DOCUMENT_APPROVE", label: "提交审核", decision: false },
  DOCUMENT_APPROVE: { action: "DOCUMENT_APPROVE", label: "审批通过", decision: true },
  DOCUMENT_REJECT: { action: "DOCUMENT_APPROVE", label: "驳回修改", decision: true },
  ARCHIVE_APPROVE: { action: "ARCHIVE_APPROVE", label: "审批通过并归档", decision: true },
  ARCHIVE_REJECT: { action: "ARCHIVE_APPROVE", label: "驳回归档", decision: true },
  INVOICE_APPROVED: { action: "INVOICE_APPROVE", label: "审批通过", decision: true },
  INVOICE_ISSUED: { action: "INVOICE_APPROVE", label: "完成开票", decision: true },
  INVOICE_REJECTED: { action: "INVOICE_APPROVE", label: "驳回开票", decision: true },
  SEAL_APPROVED: { action: "SEAL_APPROVE", label: "审批通过", decision: true },
  SEAL_REJECTED: { action: "SEAL_APPROVE", label: "驳回用章", decision: true },
  SEAL_STAMPED: { action: "SEAL_APPROVE", label: "完成盖章回填", decision: true },
  SEAL_CANCELLED: { action: "SEAL_APPROVE", label: "撤回申请", decision: false },
  SEAL_LEGACY_CLASSIFY: { action: "SEAL_APPROVE", label: "补充事项并重新送审", decision: false }
};
export type ApprovalHistoryEntry = { id: string; label: string; userId: string | null; userName: string; at: Date; note: string | null; decision: boolean; legacy?: boolean };
export type ApprovalWorkspaceRow = {
  id: string; action: ApprovalAction; title: string; requester: string; matter: string;
  status: string; submittedAt: Date; processedAt: Date | null; processor: string | null;
  task: "approve" | "issue" | "stamp" | "terminate" | null;
};
export function canonicalApprovalAction(action: ApprovalAction): ApprovalAction { return action === "SEAL_STAMP" ? "SEAL_APPROVE" : action; }
export function approvalTargetType(action: ApprovalAction) {
  return ({ INTAKE_APPROVE: "Intake", DOCUMENT_APPROVE: "Document", ARCHIVE_APPROVE: "ArchiveRecord", INVOICE_APPROVE: "InvoiceRequest", SEAL_APPROVE: "SealRequest", SEAL_STAMP: "SealRequest" })[action];
}
export function approvalHref(action: ApprovalAction, id: string) {
  return `/approvals?type=${canonicalApprovalAction(action)}&id=${encodeURIComponent(id)}`;
}
