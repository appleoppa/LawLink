import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalAction, Prisma } from "@prisma/client";
const { db } = vi.hoisted(() => ({ db: {
  user: { findUnique: vi.fn(), findMany: vi.fn() }, systemSetting: { findUnique: vi.fn() },
  sealTypeConfig: { findUnique: vi.fn() }, sealPurposeConfig: { findUnique: vi.fn() },
  approvalPermissionRule: { findMany: vi.fn() }, intake: { findUniqueOrThrow: vi.fn() },
  $queryRaw: vi.fn(), $transaction: vi.fn(), auditLog: { create: vi.fn() }
} }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { approvalSettings, canApproveContext, canApproveItem, requireApprovalRoute, approvalTransaction, approvalAudit } from "@/lib/approvals/service";
import type { ApprovalContext } from "@/lib/approvals/rules";
const context: ApprovalContext = { action: "INTAKE_APPROVE", category: "CIVIL_COMMERCIAL", requesterId: "applicant" };
const rule = { action: "INTAKE_APPROVE", caseScope: "CATEGORIES", categories: ["CIVIL_COMMERCIAL"], allSealPurposes: false, purposeId: null, sealTypes: [] };
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  db.user.findMany.mockResolvedValue([{ id: "reviewer" }]);
  db.systemSetting.findUnique.mockImplementation(({ where }) => Promise.resolve(where.key === "approvalAuthorization" ? { value: { enabled: true, allowSelfApproval: false } } : { value: { value: "legal-rep" } }));
  db.approvalPermissionRule.findMany.mockResolvedValue([rule]);
  db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: true, approverRoles: ["LAWYER"] });
  db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["LEGAL_REP_SEAL"] });
  db.intake.findUniqueOrThrow.mockResolvedValue({ category: "CRIMINAL", createdById: "applicant" });
  db.$transaction.mockImplementation(fn => fn(db));
});
describe("审批鉴权服务", () => {
  it.each([null, { value: { enabled: false } }, { value: { enabled: true } }])("历史开关配置 %j 不影响事项授权始终生效", async setting => {
    db.systemSetting.findUnique.mockResolvedValue(setting);
    expect(await approvalSettings()).toEqual({ enabled: true, allowSelfApproval: false });
    expect(await canApproveContext("reviewer", context)).toBe(true);
    db.approvalPermissionRule.findMany.mockResolvedValue([]);
    await expect(requireApprovalRoute(context)).rejects.toThrow("尚无可审批人员");
  });
  it.each(Object.values(ApprovalAction))("历史未启用配置下，%s 不回退到主任或财务角色", async action => {
    db.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false, allowSelfApproval: true } });
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false, approverRoles: ["PRINCIPAL_LAWYER", "FINANCE"] });
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["OFFICIAL_SEAL"] });
    db.approvalPermissionRule.findMany.mockResolvedValue([]);
    const item: ApprovalContext = { ...context, action, ...(action.startsWith("SEAL_") ? { sealType: "OFFICIAL_SEAL" as const, purposeId: "purpose" } : {}) };
    for (const role of ["PRINCIPAL_LAWYER", "FINANCE"]) {
      db.user.findUnique.mockResolvedValue({ active: true, role });
      expect(await canApproveContext("reviewer", item)).toBe(false);
    }
    await expect(requireApprovalRoute(item)).rejects.toThrow("尚无可审批人员");
  });
  it("本人审批例外仍须匹配事项授权", async () => {
    db.systemSetting.findUnique.mockResolvedValue({ value: { enabled: false, allowSelfApproval: true } });
    expect(await canApproveContext("applicant", context)).toBe(true);
    db.approvalPermissionRule.findMany.mockResolvedValue([]);
    expect(await canApproveContext("applicant", context)).toBe(false);
  });
  it("授权按实时关系查询，包含组、成员、规则三层启用条件", async () => {
    expect(await canApproveContext("reviewer", context)).toBe(true);
    expect(db.approvalPermissionRule.findMany).toHaveBeenCalledWith({ where: { active: true, action: "INTAKE_APPROVE", group: { active: true, members: { some: { userId: "reviewer", active: true } } } } });
    db.approvalPermissionRule.findMany.mockResolvedValue([]);
    expect(await canApproveContext("reviewer", context)).toBe(false);
  });
  it("系统超级管理员没有审批捷径；禁用账号立即拒绝", async () => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "SUPER_ADMIN" }); db.approvalPermissionRule.findMany.mockResolvedValue([]);
    expect(await canApproveContext("reviewer", context)).toBe(false);
    db.approvalPermissionRule.findMany.mockResolvedValue([rule]); db.user.findUnique.mockResolvedValue({ active: false, role: "LAWYER", systemRole: "SUPER_ADMIN" });
    expect(await canApproveContext("reviewer", context)).toBe(false);
  });
  it.each(Object.values(ApprovalAction))("系统超级管理员未获事项授权时不能处理 %s，也不成为送审接收人", async action => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "SUPER_ADMIN" });
    db.approvalPermissionRule.findMany.mockResolvedValue([]);
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false });
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["OFFICIAL_SEAL"] });
    const item: ApprovalContext = { ...context, action, ...(action.startsWith("SEAL_") ? { sealType: "OFFICIAL_SEAL" as const, purposeId: "purpose" } : {}) };
    expect(await canApproveContext("reviewer", item)).toBe(false);
    await expect(requireApprovalRoute(item)).rejects.toThrow("尚无可审批人员");
  });
  it("系统管理身份不改变本人审批规则或事项授权", async () => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "SUPER_ADMIN" });
    db.approvalPermissionRule.findMany.mockResolvedValue([rule]);
    expect(await canApproveContext("applicant", context)).toBe(false);
    db.systemSetting.findUnique.mockResolvedValue({ value: { allowSelfApproval: true } });
    expect(await canApproveContext("applicant", context)).toBe(true);
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "NONE" });
    expect(await canApproveContext("reviewer", context)).toBe(true);
  });
  it("系统超级管理员也不能处理未分类、停用或印章不匹配的事项", async () => {
    db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "SUPER_ADMIN" });
    db.approvalPermissionRule.findMany.mockResolvedValue([{ ...rule, action: "SEAL_APPROVE", allSealPurposes: true, sealTypes: ["LEGAL_REP_SEAL"] }]);
    const seal: ApprovalContext = { ...context, action: "SEAL_APPROVE", sealType: "LEGAL_REP_SEAL", purposeId: "p" };
    expect(await canApproveContext("reviewer", { ...seal, purposeId: null })).toBe(false);
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: false, allowedSealTypes: ["LEGAL_REP_SEAL"] });
    expect(await canApproveContext("reviewer", seal)).toBe(false);
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["CONTRACT_SEAL"] });
    expect(await canApproveContext("reviewer", seal)).toBe(false);
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: true, allowedSealTypes: ["LEGAL_REP_SEAL"] });
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: false });
    expect(await canApproveContext("reviewer", seal)).toBe(false);
  });
  it("多个权限组取并集，匹配其他组并不扩大未命中的类别", async () => {
    db.approvalPermissionRule.findMany.mockResolvedValue([{ ...rule, categories: ["CRIMINAL"] }, rule]);
    expect(await canApproveContext("reviewer", context)).toBe(true);
    expect(await canApproveContext("reviewer", { ...context, category: "ADMINISTRATIVE" })).toBe(false);
  });
  it("从数据库读取案件类别，不接受客户端伪造范围", async () => {
    expect(await canApproveItem("reviewer", "INTAKE_APPROVE", "intake-id")).toBe(false);
  });
  it.each(["LAWYER", "PRINCIPAL_LAWYER"])("%s 不能越过法定代表人章限制", async role => {
    db.user.findUnique.mockResolvedValue({ active: true, role });
    const seal: ApprovalContext = { ...context, action: "SEAL_APPROVE", sealType: "LEGAL_REP_SEAL", purposeId: "p" };
    db.approvalPermissionRule.findMany.mockResolvedValue([{ ...rule, action: "SEAL_APPROVE", allSealPurposes: true, sealTypes: ["LEGAL_REP_SEAL"] }]);
    expect(await canApproveContext("reviewer", seal)).toBe(false);
    expect(await canApproveContext("legal-rep", seal)).toBe(true);
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: false });
    expect(await canApproveContext("legal-rep", seal)).toBe(false);
  });
  it("未分类或事项停用的用章申请拒绝授权", async () => {
    const seal: ApprovalContext = { ...context, action: "SEAL_APPROVE", sealType: "LEGAL_REP_SEAL", purposeId: "p" };
    db.sealPurposeConfig.findUnique.mockResolvedValue({ active: false, allowedSealTypes: ["LEGAL_REP_SEAL"] });
    expect(await canApproveContext("legal-rep", seal)).toBe(false);
    expect(await canApproveContext("legal-rep", { ...seal, purposeId: null })).toBe(false);
  });
  it("没有合格审批人时阻止提交，包括仅申请人有权限的情形", async () => {
    db.user.findMany.mockResolvedValue([{ id: "applicant" }]);
    await expect(requireApprovalRoute(context)).rejects.toThrow("尚无可审批人员");
  });
  it("权限事务使用串行隔离、共享锁，审计失败向事务传播", async () => {
    db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(approvalTransaction(tx => approvalAudit(tx, "reviewer", "APPROVE", "id"))).rejects.toThrow("audit unavailable");
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    expect(db.$queryRaw.mock.calls[0][0].join("")).toBe("SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 20000 });
  });
  it("数据库内部错误不直接显示给用户，回调不会在加锁失败后执行", async () => {
    db.$queryRaw.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Failed to deserialize column of type void", { code: "P2010", clientVersion: "5.22.0" }));
    const save = vi.fn();
    await expect(approvalTransaction(save)).rejects.toThrow("审批权限或处理结果未能保存");
    expect(save).not.toHaveBeenCalled();
  });
});
