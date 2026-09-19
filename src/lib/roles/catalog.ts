/** 固定功能目录；普通角色不能获得账号、角色、授权和系统密钥管理权。 */
export const PERMISSIONS = [
  { key: "matters.read", label: "查看案件与收案", group: "案件", scopes: ["OWN", "TEAM", "ALL"] },
  { key: "intakes.create", label: "收案登记", group: "案件", scopes: ["OWN"] },
  { key: "matters.write", label: "办理案件与收案", group: "案件", scopes: ["OWN"] },
  { key: "clients.read", label: "查看客户", group: "客户", scopes: ["OWN", "ALL"] },
  { key: "clients.write", label: "维护客户", group: "客户", scopes: ["OWN", "ALL"] },
  { key: "documents.read", label: "查看材料目录", group: "材料", scopes: ["OWN"] },
  { key: "documents.write", label: "上传及维护材料", group: "材料", scopes: ["OWN"] },
  { key: "documents.download", label: "下载及预览材料", group: "材料", scopes: ["OWN"] },
  { key: "schedule.read", label: "查看案件日程", group: "日程", scopes: ["OWN", "TEAM"] },
  { key: "schedule.write", label: "维护案件日程与记录", group: "日程", scopes: ["OWN"] },
  { key: "finance.read", label: "查看财务", group: "财务", scopes: ["OWN", "ALL"] },
  { key: "finance.write", label: "维护收付款", group: "财务", scopes: ["OWN", "ALL"] },
  { key: "finance.confirm", label: "确认实收到账", group: "财务", scopes: ["ALL"] },
  { key: "invoices.process", label: "执行开票", group: "财务", scopes: ["OWN", "ALL"] },
  { key: "archive.read", label: "查看归档", group: "归档与导出", scopes: ["OWN", "TEAM", "ALL"] },
  { key: "archive.submit", label: "提交归档", group: "归档与导出", scopes: ["OWN"] },
  { key: "matters.export", label: "导出案件及归档材料", group: "归档与导出", scopes: ["OWN"] },
  { key: "reports.read", label: "查看报表", group: "归档与导出", scopes: ["OWN", "ALL"] },
  { key: "reports.export", label: "导出报表", group: "归档与导出", scopes: ["OWN", "ALL"] },
  { key: "announcements.manage", label: "管理公告", group: "行政事务", scopes: ["ALL"] },
  { key: "firm-files.manage", label: "管理律所公共资料", group: "行政事务", scopes: ["ALL"] },
  { key: "express.manage", label: "登记及维护快递", group: "行政事务", scopes: ["OWN", "ALL"] },
  { key: "contacts.manage", label: "录入及维护外部联系人", group: "行政事务", scopes: ["OWN", "ALL"] },
  { key: "contacts.review", label: "审核外部联系人", group: "行政事务", scopes: ["ALL"] },
  { key: "seals.request", label: "发起用章申请", group: "行政事务", scopes: ["OWN"] },
] as const;
export type PermissionKey = typeof PERMISSIONS[number]["key"];
export type RoleScope = "OWN" | "TEAM" | "ALL";
export type RoleGrant = { permissionKey: PermissionKey; scope: RoleScope };
export type RoleUser = { role: string; rolePermissions?: RoleGrant[]; roleName?: string };
export const SCOPE_LABELS: Record<RoleScope, string> = { OWN: "本人经办 / 本人记录", TEAM: "本人及已有团队查看授权", ALL: "全所" };
export const ADMINISTRATIVE_ROLE_ID = "cmrolesadministrative00001";
export const BUILTIN_ROLES = [
  { id: "PRINCIPAL_LAWYER", name: "主办律师", description: "沿用现有全所查看与管理权限；审批另按事项授权。" },
  { id: "LAWYER", name: "经办律师", description: "本人经办案件及已有团队查看授权；审批另按事项授权。" },
  { id: "ASSISTANT", name: "助理", description: "参与案件及已有团队查看授权；审批另按事项授权。" },
  { id: "FINANCE", name: "财务", description: "全所财务，含实收到账确认；案件正文及材料仍按个人经办关系授权。" },
  { id: ADMINISTRATIVE_ROLE_ID, name: "行政", description: "公告、律所公共资料、快递及外部联系人维护；审批另按事项授权。" },
] as const;
export type BuiltinRolePresentation = { id: string; name: string; description: string; version: number };
export const isBuiltinRole = (id: string) => BUILTIN_ROLES.some(role => role.id === id);
export const ADMINISTRATIVE_GRANTS: RoleGrant[] = [
  { permissionKey: "announcements.manage", scope: "ALL" }, { permissionKey: "firm-files.manage", scope: "ALL" },
  { permissionKey: "express.manage", scope: "OWN" }, { permissionKey: "contacts.manage", scope: "OWN" },
  { permissionKey: "seals.request", scope: "OWN" },
];
export function validGrants(rows: { permissionKey: string; scope: string }[]): RoleGrant[] {
  return rows.filter(row => PERMISSIONS.some(p => p.key === row.permissionKey && (p.scopes as readonly string[]).includes(row.scope))) as RoleGrant[];
}
export function scopeFor(user: RoleUser, key: PermissionKey): RoleScope | undefined {
  return user.rolePermissions?.find(p => p.permissionKey === key && PERMISSIONS.some(def => def.key === key && (def.scopes as readonly string[]).includes(p.scope)))?.scope;
}
/** 内置角色仍由既有业务规则进一步限制；此函数的放行不能替代旧业务断言。 */
export function hasCustomPermission(user: RoleUser, key: PermissionKey): boolean {
  return user.role !== "CUSTOM" || Boolean(scopeFor(user, key));
}
export function customOrLegacy(user: RoleUser, key: PermissionKey, legacy: boolean): boolean {
  return user.role === "CUSTOM" ? Boolean(scopeFor(user, key)) : legacy;
}
export function roleDisplayName(user: RoleUser): string {
  return user.roleName || (user.role === "CUSTOM" ? "自定义角色" : BUILTIN_ROLES.find(r => r.id === user.role)?.name || "未知角色");
}
/** 复制提供明确列出的普通业务权限，不复制任何隐式系统管理权。 */
export function copyBuiltinGrants(role: string): RoleGrant[] {
  if (role === ADMINISTRATIVE_ROLE_ID) return ADMINISTRATIVE_GRANTS.map(grant => ({ ...grant }));
  const keys: PermissionKey[] = role === "FINANCE"
    ? ["finance.read", "finance.write", "finance.confirm", "invoices.process"]
    : ["matters.read", "intakes.create", "matters.write", "clients.read", "clients.write", "documents.read", "documents.write", "documents.download", "schedule.read", "schedule.write", "archive.read", "archive.submit", "seals.request"];
  return keys.map(permissionKey => ({ permissionKey, scope: (role === "FINANCE" ? "ALL" : permissionKey === "matters.read" && role === "PRINCIPAL_LAWYER" ? "ALL" : "OWN") as RoleScope }));
}

export const normalizeRoleName = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
