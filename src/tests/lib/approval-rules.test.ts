import { describe, expect, it } from "vitest";
import { matchesApprovalRule, mayApproveSelf, type ApprovalContext, type ApprovalRule } from "@/lib/approvals/rules";
const rule: ApprovalRule = { action: "SEAL_APPROVE", caseScope: "CATEGORIES", categories: ["CIVIL_COMMERCIAL"], allSealPurposes: false, purposeId: "contract", sealTypes: ["OFFICIAL_SEAL"] };
const context: ApprovalContext = { action: "SEAL_APPROVE", category: "CIVIL_COMMERCIAL", requesterId: "applicant", purposeId: "contract", sealType: "OFFICIAL_SEAL" };
describe("按事项授权范围", () => {
  it("只有操作、案件类别、事项、章种同时命中才授权", () => {
    expect(matchesApprovalRule(rule, context)).toBe(true);
    for (const patch of [{ category: "CRIMINAL" as const }, { action: "SEAL_STAMP" as const }, { purposeId: "administrative" }, { sealType: "LEGAL_REP_SEAL" as const }, { purposeId: null }, { category: null }]) expect(matchesApprovalRule(rule, { ...context, ...patch })).toBe(false);
  });
  it("空类别或空章种不表示全部", () => {
    expect(matchesApprovalRule({ ...rule, categories: [] }, context)).toBe(false);
    expect(matchesApprovalRule({ ...rule, sealTypes: [] }, context)).toBe(false);
  });
  it("全部案件仍不包含非案件申请，全部事项仍要求已分类", () => {
    const all = { ...rule, caseScope: "ALL_CASES" as const, allSealPurposes: true };
    expect(matchesApprovalRule(all, { ...context, category: "CRIMINAL", purposeId: "administrative" })).toBe(true);
    expect(matchesApprovalRule(all, { ...context, category: null })).toBe(false);
    expect(matchesApprovalRule(all, { ...context, purposeId: null })).toBe(false);
  });
  it("非案件授权不能用来审批案件申请", () => {
    expect(matchesApprovalRule({ ...rule, caseScope: "NON_CASE" }, { ...context, category: null })).toBe(true);
    expect(matchesApprovalRule({ ...rule, caseScope: "NON_CASE" }, context)).toBe(false);
  });
  it("收案审批不会获得文书审批或盖章权限", () => {
    const intake = { ...rule, action: "INTAKE_APPROVE" as const };
    expect(matchesApprovalRule(intake, { ...context, action: "INTAKE_APPROVE" })).toBe(true);
    expect(matchesApprovalRule(intake, { ...context, action: "DOCUMENT_APPROVE" })).toBe(false);
  });
  it("默认禁止本人或不明申请人审批，单人例外显式开启", () => {
    expect(mayApproveSelf("applicant", context, false)).toBe(false);
    expect(mayApproveSelf("applicant", context, true)).toBe(true);
    expect(mayApproveSelf("reviewer", { ...context, requesterId: null }, true)).toBe(false);
    expect(mayApproveSelf("applicant", { ...context, action: "SEAL_STAMP" }, false)).toBe(true);
  });
});
