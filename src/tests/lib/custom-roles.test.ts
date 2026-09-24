import { describe, expect, it } from "vitest";
import { ADMINISTRATIVE_GRANTS, BUILTIN_ROLES, copyBuiltinGrants, hasCustomPermission, roleDisplayName, scopeFor, validGrants } from "@/lib/roles/catalog";
import { clientVisibilityFilter, customMatterFilter, intakeReadVisibilityFilter, matterFinanceVisibilityFilter, matterReadVisibilityFilter, matterVisibilityFilter } from "@/lib/permissions";
import { roleDefinitionSchema, normalizeRoleName } from "@/server/roles/schema";
import { reportAccess } from "@/lib/roles/report-scope";
const admin = { role: "CUSTOM", roleName: "行政", rolePermissions: ADMINISTRATIVE_GRANTS };
const input = { name: "档案专员", description: "", active: true, permissions: ADMINISTRATIVE_GRANTS };
describe("自定义角色的默认拒绝与权限范围", () => {
  it("行政不能读取案件、客户或财务，即使已加入案件也不落入助理分支", () => {
    expect(matterReadVisibilityFilter("u", "CUSTOM", ADMINISTRATIVE_GRANTS)).toEqual({ id: { in: [] } });
    expect(matterVisibilityFilter("u", "CUSTOM")).toEqual({ id: { in: [] } });
    expect(clientVisibilityFilter("u", "CUSTOM", ADMINISTRATIVE_GRANTS)).toEqual({ id: { in: [] } });
    expect(matterFinanceVisibilityFilter("u", "CUSTOM", ADMINISTRATIVE_GRANTS)).toEqual({ id: { in: [] } });
  });
  it("行政开放日常事务，不隐式开放财务、下载、审批或系统权限", () => {
    expect(hasCustomPermission(admin, "announcements.manage")).toBe(true);
    expect(hasCustomPermission(admin, "firm-files.manage")).toBe(true);
    expect(hasCustomPermission(admin, "finance.write")).toBe(false);
    expect(hasCustomPermission(admin, "documents.download")).toBe(false);
    expect(hasCustomPermission(admin, "invoices.process")).toBe(false);
  });
  it("自定义角色没有有效权限快照时拒绝功能访问", () => expect(hasCustomPermission({ role: "CUSTOM" }, "matters.read")).toBe(false));
  it("全所财务授权不会变为全所案件正文授权", () => {
    const grants = [{ permissionKey: "finance.read" as const, scope: "ALL" as const }];
    expect(matterFinanceVisibilityFilter("u", "CUSTOM", grants)).toEqual({});
    expect(matterReadVisibilityFilter("u", "CUSTOM", grants)).toEqual({ id: { in: [] } });
  });
  it("全所案件查看不会变为下载或写入权限", () => {
    const user = { role: "CUSTOM", rolePermissions: [{ permissionKey: "matters.read" as const, scope: "ALL" as const }] };
    expect(matterReadVisibilityFilter("u", user.role, user.rolePermissions)).toEqual({});
    expect(hasCustomPermission(user, "matters.write")).toBe(false);
    expect(hasCustomPermission(user, "documents.download")).toBe(false);
  });
  it("团队只读与个人业务范围分开", () => {
    const grants = [{ permissionKey: "matters.read" as const, scope: "TEAM" as const }];
    expect(JSON.stringify(matterReadVisibilityFilter("u", "CUSTOM", grants))).toContain("teamMemberships");
    expect(JSON.stringify(customMatterFilter("u", grants, "matters.read", false))).not.toContain("teamMemberships");
  });
  it("搜索附加 OR 不会覆盖自定义角色的本人范围", () => {
    const grants = [{ permissionKey: "matters.read" as const, scope: "OWN" as const }];
    for (const scope of [matterReadVisibilityFilter("u", "CUSTOM", grants), intakeReadVisibilityFilter("u", "CUSTOM", grants)]) {
      const where = { ...scope, OR: [{ title: { contains: "任何" } }] };
      expect(where).toHaveProperty("AND");
      expect(JSON.stringify(where.AND)).toContain("u");
    }
  });
  it("报表独立授权不越过案件和财务范围", () => {
    const filter = reportAccess({ id: "u", role: "CUSTOM", rolePermissions: [{ permissionKey: "reports.read", scope: "ALL" }] });
    expect(JSON.stringify(filter.matters)).toContain('"in":[]');
    expect(JSON.stringify(filter.finance)).toContain('"in":[]');
  });
  it("报表查看不能代替报表导出", () => {
    const filter = reportAccess({ id: "u", role: "CUSTOM", rolePermissions: [{ permissionKey: "reports.read", scope: "ALL" }, { permissionKey: "matters.read", scope: "ALL" }] }, true);
    expect(JSON.stringify(filter.matters)).toContain('"in":[]');
  });
});
describe("角色配置输入与显示", () => {
  it("行政保留为内置角色名，其他岗位可自定义", () => { expect(roleDefinitionSchema.safeParse({ ...input, name: "行政" }).success).toBe(false); expect(roleDefinitionSchema.safeParse(input).success).toBe(true); });
  it.each(BUILTIN_ROLES.map(r => r.name))("拒绝冒用内置角色 %s", name => expect(roleDefinitionSchema.safeParse({ ...input, name }).success).toBe(false));
  it("统一全角及首尾空白，供名称唯一性校验", () => expect(normalizeRoleName("  ＡＢＣ  ")).toBe("abc"));
  it("拒绝空名称和超长说明", () => {
    expect(roleDefinitionSchema.safeParse({ ...input, name: "  " }).success).toBe(false);
    expect(roleDefinitionSchema.safeParse({ ...input, description: "长".repeat(301) }).success).toBe(false);
  });
  it("拒绝手工注入管理员权限键", () => expect(roleDefinitionSchema.safeParse({ ...input, permissions: [{ permissionKey: "users.manage", scope: "ALL" }] }).success).toBe(false));
  it("拒绝以全所范围扩大仅限本人办理的权限", () => expect(roleDefinitionSchema.safeParse({ ...input, permissions: [{ permissionKey: "matters.write", scope: "ALL" }] }).success).toBe(false));
  it("拒绝重复权限条目", () => expect(roleDefinitionSchema.safeParse({ ...input, permissions: [ADMINISTRATIVE_GRANTS[0], ADMINISTRATIVE_GRANTS[0]] }).success).toBe(false));
  it("已有角色修改必须携带版本", () => expect(roleDefinitionSchema.safeParse({ ...input, id: "cmrolesadministrative00001" }).success).toBe(false));
  it("未知或不适用的存储值不形成有效授权", () => {
    expect(validGrants([{ permissionKey: "users.manage", scope: "ALL" }, { permissionKey: "matters.write", scope: "ALL" }])).toEqual([]);
    expect(scopeFor({ role: "CUSTOM", rolePermissions: [{ permissionKey: "matters.write", scope: "ALL" }] }, "matters.write")).toBeUndefined();
  });
  it("内置业务角色副本只含白名单权限", () => {
    for (const builtin of BUILTIN_ROLES) expect(roleDefinitionSchema.safeParse({ ...input, permissions: copyBuiltinGrants(builtin.id) }).success).toBe(true);
  });
  it("显示真实自定义名称", () => expect(roleDisplayName(admin)).toBe("行政"));
});

it("内置角色使用当前显示名称，但不改变内部角色", () => { const user = { role: "LAWYER", roleName: "执业律师" }; expect(roleDisplayName(user)).toBe("执业律师"); expect(user.role).toBe("LAWYER"); });
