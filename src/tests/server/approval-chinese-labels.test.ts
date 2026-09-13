import { beforeEach, describe, expect, it, vi } from "vitest";
const { intake } = vi.hoisted(() => ({ intake: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { intake: { findUniqueOrThrow: intake }, auditLog: { findMany: async () => [] } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: { id: "reviewer" } }) }));
vi.mock("@/lib/approvals/service", () => ({ assertApprovalItem: vi.fn() }));
vi.mock("@/server/approval-permissions/records", () => ({ requireApprovalRecord: async () => ({ row: { history: [], status: "PENDING" }, task: "approve" }) }));
// 本组只验证详情文案；记录访问边界由审批工作台和鉴权服务测试覆盖。
vi.mock("@/server/approval-permissions/records", () => ({ requireApprovalRecord: async () => ({ row: { history: [], status: "PENDING", title: "测试收案", requester: "申请人", submittedAt: new Date("2026-09-06") }, task: "approve" }) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { getApprovalDetail } from "@/server/approval-permissions/inbox";
beforeEach(() => vi.resetAllMocks());
describe("收案审批中文结论", () => {
  it.each([["DIFFERENT", "可承接"], ["SAME_SUBJECT", "有冲突"], ["PENDING", "待结论"], ["NEED_INFO", "信息不足"], [null, "尚未核查"]])("结论 %s 显示为 %s", async (conclusion, label) => {
    intake.mockResolvedValue({ title: "测试收案", category: "LABOR_ARBITRATION", coUserIds: [], parties: [], documents: [], conflictChecks: conclusion ? [{ id: "check", conclusion, note: "测试说明", hits: [], queryPayload: {} }] : [] });
    const detail = await getApprovalDetail({ action: "INTAKE_APPROVE", id: "cintake000000000000000001" });
    expect(detail.fields.find(f => f.label === "冲突审查结论")?.value).toBe(label);
  });
});
