import { beforeEach, describe, expect, it, vi } from "vitest";
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { matter: { findFirst } } }));
import { assertCanReadMatter, assertCanAccessMatter, assertCanModifyMatter, assertCanLeadMatter } from "@/lib/permissions";
import { groupColleagues } from "@/lib/teams/colleagues";
import { teamInputSchema } from "@/server/teams/schemas";

beforeEach(() => vi.clearAllMocks());
describe("团队查看不授予经办或敏感数据权限", () => {
  it("仅团队可读的案件不会通过财务/材料访问或写入断言", async () => {
    findFirst.mockImplementation(({ where }) => Promise.resolve(where.AND ? { id: "matter" } : null));
    await expect(assertCanReadMatter("leader", "LAWYER", "matter")).resolves.toBeUndefined();
    await expect(assertCanAccessMatter("leader", "LAWYER", "matter")).rejects.toThrow("案件不存在");
    await expect(assertCanModifyMatter("leader", "LAWYER", "matter")).rejects.toThrow("案件不存在");
    await expect(assertCanLeadMatter("leader", "matter")).rejects.toThrow();
  });
  it("下一次读取重新判定，撤权后拒绝旧页面访问", async () => {
    findFirst.mockResolvedValueOnce({ id: "matter" }).mockResolvedValueOnce(null);
    await assertCanReadMatter("leader", "LAWYER", "matter");
    await expect(assertCanReadMatter("leader", "LAWYER", "matter")).rejects.toThrow("案件不存在");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
describe("律师选择", () => {
  it("团队优先、跨团队可选，搜索保留已选人员并去重", () => {
    const people = [{ id: "outside", name: "王律师" }, { id: "team", name: "李律师", isTeammate: true }, { id: "outside", name: "王律师" }];
    expect(groupColleagues(people, "李", ["outside"]).map((g) => g.people.map((u) => u.id))).toEqual([["team"], ["outside"]]);
  });
  it("无团队仍可搜索全所人员", () => {
    expect(groupColleagues([{ id: "1", name: "张律师" }], "张")[0].people[0].id).toBe("1");
    expect(groupColleagues([{ id: "1", name: "张律师" }], "李")).toEqual([]);
  });
  it("拒绝重复成员，防止授权被后续重复项覆盖", () => {
    expect(teamInputSchema.safeParse({ name: "团队", leaderId: "c111111111111111111111111", members: [{ userId: "c222222222222222222222222", canViewAllMatters: true }, { userId: "c222222222222222222222222", canViewAllMatters: false }] }).success).toBe(false);
  });
});
