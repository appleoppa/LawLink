import type { ApprovalAction, ApprovalCaseScope, MatterCategory, SealType } from "@prisma/client";

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  INTAKE_APPROVE: "收案审批", DOCUMENT_APPROVE: "文书审批", ARCHIVE_APPROVE: "归档审批",
  INVOICE_APPROVE: "开票审批", SEAL_APPROVE: "用章审批", SEAL_STAMP: "盖章回填"
};
export type ApprovalContext = {
  action: ApprovalAction;
  category: MatterCategory | null;
  requesterId: string | null;
  sealType?: SealType;
  purposeId?: string | null;
};
export type ApprovalRule = {
  action: ApprovalAction;
  caseScope: ApprovalCaseScope;
  categories: MatterCategory[];
  allSealPurposes: boolean;
  purposeId: string | null;
  sealTypes: SealType[];
};
export function matchesApprovalRule(rule: ApprovalRule, context: ApprovalContext) {
  if (rule.action !== context.action) return false;
  const inScope = rule.caseScope === "NON_CASE" ? context.category === null
    : context.category !== null && (rule.caseScope === "ALL_CASES" || rule.categories.includes(context.category));
  if (!inScope) return false;
  if (context.action === "SEAL_APPROVE" || context.action === "SEAL_STAMP") {
    return !!context.sealType && !!context.purposeId && rule.sealTypes.includes(context.sealType)
      && (rule.allSealPurposes || rule.purposeId === context.purposeId);
  }
  return true;
}
export function mayApproveSelf(userId: string, context: ApprovalContext, allowSelfApproval: boolean) {
  // 回填为执行动作，不是再次审批；不能由此绕过独立的回填授权。
  return context.action === "SEAL_STAMP" || (context.requesterId !== null &&
    (context.requesterId !== userId || allowSelfApproval));
}
