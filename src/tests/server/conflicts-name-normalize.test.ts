// @vitest-environment node
/**
 * 冲突检索名称归一化与双向匹配（第六轮体检 P2-2）。
 *
 * 纯函数：归一化变换（全半角/括号/组织后缀）、双向匹配分级、探针生成。
 * 集成：runConflictCheck 反向命中（查询全称 vs 历史简称此前整条漏检）、
 * 归一命中降一级并标注人工核对、原文相似维持 LOW 不降级语义不变。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
process.env.STORAGE_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
import { normalizeOrgName, nameMatchLevel, buildNameProbes } from "@/lib/conflicts/name-normalize";

const { db } = vi.hoisted(() => ({ db: { party: { findMany: vi.fn() }, client: { findMany: vi.fn() }, intake: { findMany: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { runConflictCheck } from "@/server/conflicts/algorithm";

const matter = { id: "test-matter", internalCode: "TEST-001", title: "测试案件", category: "CIVIL_COMMERCIAL", status: "ACTIVE", intakeDate: null, cause: null, causeFreeText: null, owner: null };

describe("名称归一化纯函数", () => {
  it("组织后缀与括号地域剥离、全角归半角、大小写归一", () => {
    expect(normalizeOrgName("嘉吉贸易有限责任公司")).toBe("嘉吉贸易");
    expect(normalizeOrgName("嘉吉（广州）有限公司")).toBe("嘉吉");
    expect(normalizeOrgName("ＡＢＣ（上海）股份有限公司")).toBe("abc");
    expect(normalizeOrgName("广东嘉吉贸易有限公司")).toBe("广东嘉吉贸易");
  });
  it("自然人姓名与不含后缀的名称恒等（不误伤）", () => {
    expect(normalizeOrgName("张三")).toBe("张三");
    expect(normalizeOrgName("广州酒家")).toBe("广州酒家");
  });
  it("匹配分级：EXACT / NORMALIZED_EQUAL / 双向 CONTAINS / NORMALIZED_CONTAINS / null", () => {
    expect(nameMatchLevel("嘉吉贸易有限公司", "嘉吉贸易有限公司")?.level).toBe("EXACT");
    expect(nameMatchLevel("嘉吉贸易有限责任公司", "嘉吉贸易有限公司")?.level).toBe("NORMALIZED_EQUAL");
    // 原文双向包含（查询是存储的前缀，存储是查询的子串）
    expect(nameMatchLevel("嘉吉贸易有限公司", "嘉吉贸易有限")?.level).toBe("CONTAINS");
    // 归一后双向包含：地域前缀差异
    expect(nameMatchLevel("广东嘉吉贸易有限公司", "嘉吉贸易公司")?.level).toBe("NORMALIZED_CONTAINS");
    expect(nameMatchLevel("完全不同的两个名字", "毫无关系")).toBeNull();
  });
  it("探针生成：原名 + 归一核 + 去地域核，≥3 字门槛", () => {
    expect(buildNameProbes("广东嘉吉贸易有限公司")).toEqual(
      expect.arrayContaining(["广东嘉吉贸易有限公司", "广东嘉吉贸易", "嘉吉贸易"])
    );
    expect(buildNameProbes("张三")).toEqual([]);
  });
});

describe("runConflictCheck 归一化双向匹配", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.client.findMany.mockResolvedValue([]);
    db.intake.findMany.mockResolvedValue([]);
    db.party.findMany.mockResolvedValue([]);
  });

  it("反向子串命中：查询全称、历史录简称（此前整条漏检）——LOW 名称相似，与旧正向口径对称", async () => {
    db.party.findMany
      .mockResolvedValueOnce([]) // 精确
      .mockResolvedValueOnce([{ name: "嘉吉贸易", role: "CLIENT_PARTY", standing: null, matter }]); // 模糊（探针「嘉吉贸易」命中）
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "广东嘉吉贸易有限公司" }]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ matchedName: "嘉吉贸易", matchedField: "name" });
    // 存储简称是查询全称的原文子串：与旧「存储⊇查询」的 LOW 口径对称
    expect(result.hits[0].severity).toBe("LOW");
    expect(result.hits[0].reason).toContain("名称相似");
    // SQL 侧确认探针已用于扩候选
    const fuzzyWhere = db.party.findMany.mock.calls[1][0].where;
    expect(JSON.stringify(fuzzyWhere.OR)).toContain("嘉吉贸易");
  });

  it("反向需归一命中：原文互不包含（查询全称 vs 存储「嘉吉贸易公司」），降一级并标注人工核对", async () => {
    db.party.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "嘉吉贸易公司", role: "CLIENT_PARTY", standing: null, matter }]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "广东嘉吉贸易有限公司" }]);
    expect(result.hits).toHaveLength(1);
    // 候选对方 × 历史委托方 = BLOCKING → 归一命中降一级 HIGH
    expect(result.hits[0].severity).toBe("HIGH");
    expect(result.hits[0].reason).toContain("名称归一化匹配");
  });

  it("组织后缀差异（有限公司 vs 有限责任公司）归一相同命中", async () => {
    db.party.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "嘉吉贸易有限公司", role: "CLIENT_PARTY", standing: null, matter }]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "嘉吉贸易有限责任公司" }]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].severity).toBe("HIGH"); // BLOCKING 降一级
    expect(result.hits[0].reason).toContain("名称归一化匹配");
  });

  it("原文包含（非归一）仍为 LOW，语义与此前一致", async () => {
    db.party.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "嘉吉贸易有限公司甲分公司", role: "CLIENT_PARTY", standing: null, matter }]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "嘉吉贸易有限公司" }]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].severity).toBe("LOW");
    expect(result.hits[0].reason).toContain("名称相似");
  });

  it("客户档案分支同样支持归一命中（NORMALIZED_EQUAL 降级标注）", async () => {
    db.party.findMany.mockResolvedValue([]); // 历史当事人无命中
    db.client.findMany.mockResolvedValue([{
      name: "嘉吉贸易有限公司",
      idNumberBlind: null,
      matters: [matter],
      matterLinks: []
    }]);
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "嘉吉贸易有限责任公司" }]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].severity).toBe("HIGH");
    expect(result.hits[0].reason).toContain("归一化匹配");
  });

  it("在办收案当事人分支：归一命中降级并披露收案最小信息", async () => {
    const intake = { id: "test-intake", title: "测试收案", status: "INTAKE", receivedAt: new Date("2026-09-01T02:00:00Z"), ownerUser: { name: "测试律师" }, createdBy: { name: "登记人" } };
    db.party.findMany
      .mockResolvedValueOnce([]) // 历史精确
      .mockResolvedValueOnce([]) // 历史模糊
      .mockResolvedValueOnce([]) // 收案精确
      .mockResolvedValueOnce([{ name: "嘉吉贸易公司", idNumber: null, enterpriseSocialCode: null, role: "CLIENT_PARTY", standing: null, intake }]); // 收案模糊（探针，原文互不包含须归一命中）
    const result = await runConflictCheck([{ role: "OPPOSING_PARTY", name: "广东嘉吉贸易有限公司" }]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ targetType: "Intake", severity: "HIGH" });
    expect(result.hits[0].reason).toContain("归一化匹配");
    expect(result.hits[0].intakeInfo).toMatchObject({ title: "测试收案", partyRole: "CLIENT_PARTY" });
  });
});
