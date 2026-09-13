import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, access } = vi.hoisted(() => ({ db: {
  intake: { findUniqueOrThrow: vi.fn() }, user: { findMany: vi.fn() }, matter: { findMany: vi.fn() }, auditLog: { findMany: vi.fn() }, document: { findUnique: vi.fn() }
}, access: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: { id: "reviewer", role: "LAWYER" } }) }));
vi.mock("@/server/approval-permissions/records", () => ({ requireApprovalRecord: access }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: async () => false }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { getApprovalDetail } from "@/server/approval-permissions/inbox";
const id = "cintake000000000000000001";
const at = new Date("2026-09-06T00:00:00Z");
const queries = [{ role: "CLIENT_PARTY", name: "测试甲公司", idNumber: "TEST-ID" }, { role: "OPPOSING_PARTY", name: "测试乙", idNumber: "TEST-PARTY" }];
const hit = { id: "hit", targetType: "Matter", targetId: "private-matter-id", matchedName: "测试乙", matchedField: "name", matchedValue: "测试乙", matchedRatio: 1, severity: "BLOCKING", reason: "与历史委托人同名" };
function fixture() { return {
  title: "测试立案", category: "CIVIL_COMMERCIAL", receivedAt: at, cause: { name: "合同纠纷" }, causeFreeText: "补充案由", description: "事实全文", coUserIds: ["co"], ownerUser: { name: "主办甲" },
  firstProcedureType: "FIRST_INSTANCE", firstAgency: "测试法院", jurisdiction: "测试管辖地", ourStanding: "DEFENDANT", claimAmount: 0, claimDescription: "返还物品", barFiling: "MAJOR", counterclaim: false,
  businessType: "合同审查", counselType: "专项法律顾问", serviceScope: "服务范围全文", deliverables: "成果全文", serviceStart: at, serviceEnd: at,
  client: { name: "测试甲公司", type: "COMPANY", idNumber: "TEST-ID", address: "测试地址", legalRep: "代表甲" }, clientType: "COMPANY", contactName: "联系人甲", contactPhone: "TEST-PHONE",
  parties: [{ role: "OPPOSING_PARTY", name: "测试乙", standing: "PLAINTIFF", ordinal: 2, partyType: "NATURAL_PERSON", idNumber: "TEST-PARTY", phone: "PARTY-PHONE", address: "当事人地址", legalRep: "代表乙", contactName: "联系人乙", enterpriseSocialCode: "TEST-CODE", enterpriseName: "绑定企业名称", notes: "当事人备注" }],
  feeType: "CONTINGENCY", feeAmount: 0, contingencyTerms: "按回款收费", feeSchedule: "回款后付款", feeNote: "费用说明",
  documents: [{ id: "attachment", name: "测试合同.pdf" }],
  conflictChecks: [{ id: "new-check", checkedAt: at, conclusion: "DIFFERENT", decidedBy: { name: "人工核查人" }, decidedAt: at, note: "已核实并非同一主体", queryPayload: { queries, sameNameClients: [{ name: "同名档案", clientId: "private-client-id" }] }, hits: [hit] }, { id: "old-check", checkedAt: at, conclusion: "NEED_INFO", note: "旧说明", queryPayload: { queries: [] }, hits: [] }]
}; }
beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ row: { action: "INTAKE_APPROVE", status: "PENDING", title: "测试立案", history: [] }, task: "approve" });
  db.intake.findUniqueOrThrow.mockResolvedValue(fixture()); db.user.findMany.mockResolvedValue([{ id: "co", name: "共同律师乙" }]);
  db.auditLog.findMany.mockResolvedValue([{ targetId: "new-check" }]); db.document.findUnique.mockResolvedValue(null);
  db.matter.findMany.mockResolvedValue([{ id: "private-matter-id", internalCode: "TEST-001", title: "历史案件", owner: { name: "经办丙" }, parties: [{ name: "测试乙", role: "CLIENT_PARTY", standing: "PLAINTIFF" }] }]);
});
describe("立案审批完整查阅", () => {
  it("未授权申请在读取完整字段与冲突明细前被拒绝", async () => {
    access.mockRejectedValue(new Error("不可查看"));
    await expect(getApprovalDetail({ action: "INTAKE_APPROVE", id })).rejects.toThrow("不可查看");
    expect(db.intake.findUniqueOrThrow).not.toHaveBeenCalled(); expect(db.matter.findMany).not.toHaveBeenCalled();
  });
  it("完整显示程序、团队、主体、服务与费用，并保留零金额和否定值及附件权限", async () => {
    const result = await getApprovalDetail({ action: "INTAKE_APPROVE", id });
    const fields = result.intakeDetail!.sections.flatMap(s => s.fields);
    expect(result.intakeDetail!.currentParties).toEqual(queries);
    for (const value of ["一审", "测试法院", "测试管辖地", "返还物品", "事实全文", "共同律师乙", "服务范围全文", "成果全文", "按回款收费", "回款后付款", "联系人乙", "当事人备注", "绑定企业名称", "否", "0"]) expect(fields.some(f => f.value === value)).toBe(true);
    expect(fields.find(f => f.label === "基础办案费（元）")?.value).toBe("0");
    expect(fields.filter(f => ["TEST-ID", "TEST-PHONE", "TEST-PARTY", "TEST-CODE", "当事人地址", "事实全文"].includes(f.value)).every(f => f.sensitive)).toBe(true);
    expect(result.attachments).toEqual([{ id: "attachment", name: "测试合同.pdf", readable: false }]);
  });
  it("保留历史检索、条件、人工结论及关联摘要，但不泄漏关联案件或客户 ID", async () => {
    const result = await getApprovalDetail({ action: "INTAKE_APPROVE", id });
    const checks = result.intakeDetail!.checks;
    expect(checks).toHaveLength(2); expect(checks[0]).toMatchObject({ source: "人工设置结论", decidedBy: "人工核查人", coversCurrentParties: true, queries });
    expect(checks[0].hits[0].matter).toEqual({ code: "TEST-001", title: "历史案件", ownerName: "经办丙", roles: "委托方 · 原告" });
    expect(JSON.stringify(result)).not.toContain("private-matter-id"); expect(JSON.stringify(result)).not.toContain("private-client-id");
    expect(checks[1].coversCurrentParties).toBe(false);
  });
  it("系统无命中不能冒充人工核查人确认可承接", async () => {
    const f = fixture(); f.conflictChecks = [{ ...f.conflictChecks[0], hits: [], note: "系统自动标记：未命中历史案件冲突。" }];
    db.intake.findUniqueOrThrow.mockResolvedValue(f); db.auditLog.findMany.mockResolvedValue([]);
    const c = (await getApprovalDetail({ action: "INTAKE_APPROVE", id })).intakeDetail!.checks[0];
    expect(c.conclusion).toBe("未命中（系统自动提示）"); expect(c.decidedBy).toBeNull(); expect(c.decidedAt).toBeNull();
    expect(c.source).toContain("尚非人工确认");
  });
  it("关联档案缺失、旧条件损坏或主体证件变更时不补造核查结果", async () => {
    const f = fixture(); f.client.idNumber = "CHANGED"; f.conflictChecks[1].queryPayload = { queries: [] };
    db.intake.findUniqueOrThrow.mockResolvedValue(f); db.matter.findMany.mockResolvedValue([]);
    const checks = (await getApprovalDetail({ action: "INTAKE_APPROVE", id })).intakeDetail!.checks;
    expect(checks[0].coversCurrentParties).toBe(false); expect(checks[0].hits[0].matter).toBeNull(); expect(checks[1].queries).toEqual([]);
  });
  it("近似名称按命中名称核实当前角色，不误取查询名称的角色", async () => {
    const f = fixture();
    f.conflictChecks[0].hits = [{ ...hit, matchedValue: "测试", matchedName: "测试乙", matchedRatio: 0.67 }];
    db.intake.findUniqueOrThrow.mockResolvedValue(f);
    const check = (await getApprovalDetail({ action: "INTAKE_APPROVE", id })).intakeDetail!.checks[0];
    expect(check.hits[0].matter?.roles).toBe("委托方 · 原告");
  });

});
