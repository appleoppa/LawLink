import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { party: { findMany: vi.fn() }, client: { findMany: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { runConflictCheck, conflictHitKey } from "@/server/conflicts/algorithm";

const matter = { id: "test-matter", internalCode: "TEST-001", title: "测试案件", category: "CIVIL_COMMERCIAL", status: "ACTIVE", intakeDate: null, cause: null, causeFreeText: null, owner: null };
beforeEach(() => { vi.resetAllMocks(); db.client.findMany.mockResolvedValue([]); });
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
});
