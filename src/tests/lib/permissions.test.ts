import { describe, it, expect } from "vitest";
import { isManager, matterVisibilityFilter, intakeVisibilityFilter } from "@/lib/permissions";

describe("isManager", () => {
  it("PRINCIPAL_LAWYER 是 manager", () => expect(isManager("PRINCIPAL_LAWYER")).toBe(true));
  it("LAWYER 不是 manager", () => expect(isManager("LAWYER")).toBe(false));
  it("ASSISTANT 不是 manager", () => expect(isManager("ASSISTANT")).toBe(false));
  it("FINANCE 不是 manager", () => expect(isManager("FINANCE")).toBe(false));
});

describe("matterVisibilityFilter", () => {
  const userId = "user-1";

  it("PRINCIPAL_LAWYER 看全部（返回空 where）", () => {
    expect(matterVisibilityFilter(userId, "PRINCIPAL_LAWYER")).toEqual({});
  });

  it("FINANCE 看全部", () => {
    expect(matterVisibilityFilter(userId, "FINANCE")).toEqual({});
  });

  it("LAWYER 看自己拥有或参与的案件", () => {
    const filter = matterVisibilityFilter(userId, "LAWYER");
    expect(filter).toHaveProperty("OR");
    const or = (filter as { OR: unknown[] }).OR;
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({ ownerId: userId });
    expect(or[1]).toEqual({ members: { some: { userId } } });
  });

  it("ASSISTANT 只看自己参与的案件", () => {
    const filter = matterVisibilityFilter(userId, "ASSISTANT");
    expect(filter).toEqual({ members: { some: { userId } } });
  });
});

describe("intakeVisibilityFilter", () => {
  const userId = "user-1";

  it("PRINCIPAL_LAWYER 看全部", () => {
    expect(intakeVisibilityFilter(userId, "PRINCIPAL_LAWYER")).toEqual({});
  });

  it("LAWYER 看自己创建或参与的", () => {
    const filter = intakeVisibilityFilter(userId, "LAWYER");
    expect(filter).toHaveProperty("OR");
    const or = (filter as { OR: unknown[] }).OR;
    expect(or).toHaveLength(3);
  });
});

describe("财务与案件正文分离", () => {
  it("财务角色的案件正文查询只允许个人或团队授权", async () => {
    const { matterReadVisibilityFilter } = await import("@/lib/permissions");
    const filter = matterReadVisibilityFilter("finance-1", "FINANCE");
    expect(filter).not.toEqual({});
    expect(JSON.stringify(filter)).toContain("finance-1");
    // 财务列表仍可使用原有财务范围，正文必须使用独立读权限。
    expect(matterVisibilityFilter("finance-1", "FINANCE")).toEqual({});
  });
});
