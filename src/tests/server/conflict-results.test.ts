import { beforeEach, describe, expect, it, vi } from "vitest";
process.env.STORAGE_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const { db } = vi.hoisted(() => ({ db: { party: { findMany: vi.fn() }, client: { findMany: vi.fn() }, intake: { findMany: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { runConflictCheck, conflictHitKey } from "@/server/conflicts/algorithm";

const matter = { id: "test-matter", internalCode: "TEST-001", title: "测试案件", category: "CIVIL_COMMERCIAL", status: "ACTIVE", intakeDate: null, cause: null, causeFreeText: null, owner: null };
beforeEach(() => { vi.resetAllMocks(); db.client.findMany.mockResolvedValue([]); db.intake.findMany.mockResolvedValue([]); db.party.findMany.mockResolvedValue([]); });
describe("具体冲突检索结果保留", () => {
  it("同一案件同时保留同名及多个相似名称，重复匹配仍只留最高提示", async () => {
    db.party.findMany.mockResolvedValueOnce([
      { name: "测试公司", role: "OPPOSING_PARTY", standing: null, matter },
      { name: "测试公司", role: "CLIENT_PARTY", standing: null, matter }
    ]).mockResolvedValueOnce([
      { name: "测试公司甲分公司", role: "CLIENT_PARTY", standing: null, matter },
      { name: "测试公司乙分公司", role: "OPPOSING_PARTY", standing: null, matter }
    ]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "测试公司" }]);
    expect(result.hits.map(hit => hit.matchedName)).toEqual(["测试公司", "测试公司甲分公司", "测试公司乙分公司"]);
    expect(result.hits[0].severity).toBe("BLOCKING");
    expect(new Set(result.hits.map(conflictHitKey)).size).toBe(3);
  });
  it("在办收案的当事人也会命中，只携带收案最小信息并可排除收案自身", async () => {
    const intake = { id: "test-intake", title: "测试收案", status: "PENDING_CONFIRMATION", receivedAt: new Date("2026-09-01T02:00:00Z"), ownerUser: { name: "测试律师" }, createdBy: { name: "登记人" } };
    db.party.findMany
      .mockResolvedValueOnce([]) // 历史案件精确
      .mockResolvedValueOnce([]) // 历史案件相似
      .mockResolvedValueOnce([{ name: "测试公司", idNumber: null, enterpriseSocialCode: "TESTCODE", role: "CLIENT_PARTY", standing: null, intake }]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "测试公司", idNumber: "TESTCODE" }], { excludeIntakeId: "self-intake" });
    expect(result.hits.map(h => [h.targetType, h.matchedField, h.severity])).toEqual([["Intake", "idNumber", "BLOCKING"], ["Intake", "name", "BLOCKING"]]);
    expect(result.hits[0].intakeInfo).toMatchObject({ title: "测试收案", registrantName: "测试律师", partyRole: "CLIENT_PARTY" });
    expect(db.party.findMany.mock.calls[2][0].where.intake).toMatchObject({ id: { not: "self-intake" } });
  });
});
