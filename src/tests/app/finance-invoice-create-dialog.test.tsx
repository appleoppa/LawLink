import { describe, expect, it } from "vitest";
import {
  invoiceMatterSearchLimit,
  invoiceMatterSearchWhere
} from "@/server/finance/invoice-matter-search";
import type { PermissionKey, RoleGrant, RoleScope } from "@/lib/roles/catalog";

describe("invoice matter search", () => {
  it("空关键词返回本人可关联案件条件", () => {
    expect(invoiceMatterSearchWhere("u1", "")).toEqual({
      deletedAt: null,
      OR: [
        { ownerId: "u1" },
        { members: { some: { userId: "u1" } } }
      ]
    });
    expect(invoiceMatterSearchLimit("")).toBe(12);
  });

  it("输入关键词后按案名、系统编号和所内案号筛选", () => {
    expect(invoiceMatterSearchWhere("u1", " 二审 ")).toEqual({
      deletedAt: null,
      AND: [
        {
          OR: [
            { ownerId: "u1" },
            { members: { some: { userId: "u1" } } }
          ]
        },
        {
          OR: [
            { title: { contains: "二审", mode: "insensitive" } },
            { internalCode: { contains: "二审", mode: "insensitive" } },
            { firmCaseNo: { contains: "二审", mode: "insensitive" } }
          ]
        }
      ]
    });
    expect(invoiceMatterSearchLimit(" 二审 ")).toBe(10);
  });

  it("财务岗放开为全所可见：不叠经办过滤，关键词独立生效", () => {
    expect(invoiceMatterSearchWhere("u1", "", { role: "FINANCE" })).toEqual({ deletedAt: null });
    expect(invoiceMatterSearchWhere("u1", "二审", { role: "FINANCE" })).toEqual({
      deletedAt: null,
      OR: [
        { title: { contains: "二审", mode: "insensitive" } },
        { internalCode: { contains: "二审", mode: "insensitive" } },
        { firmCaseNo: { contains: "二审", mode: "insensitive" } }
      ]
    });
  });

  it("自定义角色具全所范围收付权限时同样放开；仅本人范围或无权限时保持经办过滤", () => {
    const grants = (key: PermissionKey, scope: RoleScope): RoleGrant[] => [{ permissionKey: key, scope }];
    expect(invoiceMatterSearchWhere("u1", "", { role: "CUSTOM", rolePermissions: grants("finance.write", "ALL") })).toEqual({ deletedAt: null });
    expect(invoiceMatterSearchWhere("u1", "", { role: "CUSTOM", rolePermissions: grants("finance.confirm", "ALL") })).toEqual({ deletedAt: null });
    expect(invoiceMatterSearchWhere("u1", "", { role: "CUSTOM", rolePermissions: grants("finance.write", "OWN") })).toEqual({
      deletedAt: null,
      OR: [
        { ownerId: "u1" },
        { members: { some: { userId: "u1" } } }
      ]
    });
    expect(invoiceMatterSearchWhere("u1", "", { role: "CUSTOM", rolePermissions: [] })).toEqual({
      deletedAt: null,
      OR: [
        { ownerId: "u1" },
        { members: { some: { userId: "u1" } } }
      ]
    });
  });

  it("其他内置角色不因岗位放开，仍按本人经办过滤", () => {
    for (const role of ["LAWYER", "ASSISTANT", "PRINCIPAL_LAWYER"]) {
      expect(invoiceMatterSearchWhere("u1", "", { role })).toEqual({
        deletedAt: null,
        OR: [
          { ownerId: "u1" },
          { members: { some: { userId: "u1" } } }
        ]
      });
    }
  });
});
