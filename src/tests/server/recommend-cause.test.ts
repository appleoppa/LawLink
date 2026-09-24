import { describe, it, expect, beforeEach, vi } from "vitest";

const { aiChatMock, searchCausesMock } = vi.hoisted(() => ({
  aiChatMock: vi.fn(),
  searchCausesMock: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "u1" } })
}));

vi.mock("@/lib/ai/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    aiChat: aiChatMock
  };
});

vi.mock("@/server/causes/actions", () => ({
  searchCauses: searchCausesMock
}));

import { recommendCause } from "@/server/ai/recommend-cause";

function fakeCause(over: Partial<{ id: string; name: string; level: number }>) {
  return {
    id: over.id ?? "c1",
    code: null,
    name: over.name ?? "民间借贷纠纷",
    shortName: null,
    level: over.level ?? 4,
    parentId: null,
    l1Name: "合同、准合同纠纷",
    l2Name: "借贷合同"
  };
}

beforeEach(() => {
  aiChatMock.mockReset();
  searchCausesMock.mockReset();
});

describe("recommendCause", () => {
  it("LLM 返回 3 条全部命中 → 返回 3 条", async () => {
    aiChatMock.mockResolvedValue({
      content: JSON.stringify([
        { name: "民间借贷纠纷", reason: "借款关系明确", confidence: "HIGH" },
        { name: "买卖合同纠纷", reason: "可能涉及货款", confidence: "MEDIUM" },
        { name: "保证合同纠纷", reason: "存在担保人", confidence: "LOW" }
      ]),
      raw: {}
    });
    searchCausesMock.mockImplementation(async ({ query }: { query: string }) => [
      fakeCause({ id: query, name: query })
    ]);

    const res = await recommendCause({
      category: "CIVIL_COMMERCIAL",
      situation: "原告借给被告 50 万，到期未还"
    });
    expect(res).toHaveLength(3);
    expect(res[0].cause.name).toBe("民间借贷纠纷");
    expect(res[0].confidence).toBe("HIGH");
    expect(res[1].confidence).toBe("MEDIUM");
  });

  it("反查找不到的候选被丢弃", async () => {
    aiChatMock.mockResolvedValue({
      content: JSON.stringify([
        { name: "民间借贷纠纷", reason: "x", confidence: "HIGH" },
        { name: "不存在的案由", reason: "x", confidence: "LOW" },
        { name: "保证合同纠纷", reason: "x", confidence: "MEDIUM" }
      ]),
      raw: {}
    });
    searchCausesMock.mockImplementation(async ({ query }: { query: string }) =>
      query === "不存在的案由" ? [] : [fakeCause({ id: query, name: query })]
    );

    const res = await recommendCause({
      category: "CIVIL_COMMERCIAL",
      situation: "测试用案情描述"
    });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.cause.name)).toEqual(["民间借贷纠纷", "保证合同纠纷"]);
  });

  it("二级（level<3）的反查结果会被过滤", async () => {
    aiChatMock.mockResolvedValue({
      content: JSON.stringify([
        { name: "合同纠纷", reason: "笼统", confidence: "LOW" },
        { name: "民间借贷纠纷", reason: "x", confidence: "HIGH" }
      ]),
      raw: {}
    });
    searchCausesMock.mockImplementation(async ({ query }: { query: string }) => {
      if (query === "合同纠纷") return [fakeCause({ id: "l2", name: "合同纠纷", level: 2 })];
      return [fakeCause({ id: query, name: query, level: 4 })];
    });

    const res = await recommendCause({
      category: "CIVIL_COMMERCIAL",
      situation: "测试用案情描述"
    });
    expect(res).toHaveLength(1);
    expect(res[0].cause.name).toBe("民间借贷纠纷");
  });

  it("全部反查失败 → 抛错", async () => {
    aiChatMock.mockResolvedValue({
      content: JSON.stringify([
        { name: "案由甲", reason: "x", confidence: "HIGH" },
        { name: "案由乙", reason: "x", confidence: "MEDIUM" }
      ]),
      raw: {}
    });
    searchCausesMock.mockResolvedValue([]);

    await expect(
      recommendCause({ category: "CIVIL_COMMERCIAL", situation: "测试用案情描述" })
    ).rejects.toThrow(/案由库/);
  });

  it("LLM 返回非 JSON → 抛错", async () => {
    aiChatMock.mockResolvedValue({
      content: "抱歉，我无法回答这个问题",
      raw: {}
    });
    await expect(
      recommendCause({ category: "CIVIL_COMMERCIAL", situation: "测试用案情描述" })
    ).rejects.toThrow(/无法解析/);
  });

  it("situation 太短 → 抛错", async () => {
    await expect(
      recommendCause({ category: "CIVIL_COMMERCIAL", situation: "短" })
    ).rejects.toThrow(/太短/);
    expect(aiChatMock).not.toHaveBeenCalled();
  });

  it("置信度大小写不规范也能识别", async () => {
    aiChatMock.mockResolvedValue({
      content: JSON.stringify([
        { name: "民间借贷纠纷", reason: "x", confidence: "high" },
        { name: "买卖合同纠纷", reason: "x", confidence: "中" },
        { name: "保证合同纠纷", reason: "x", confidence: "Low" }
      ]),
      raw: {}
    });
    searchCausesMock.mockImplementation(async ({ query }: { query: string }) => [
      fakeCause({ id: query, name: query })
    ]);

    const res = await recommendCause({
      category: "CIVIL_COMMERCIAL",
      situation: "测试用案情描述"
    });
    expect(res[0].confidence).toBe("HIGH");
    expect(res[1].confidence).toBe("MEDIUM"); // fallback
    expect(res[2].confidence).toBe("LOW");
  });
});
