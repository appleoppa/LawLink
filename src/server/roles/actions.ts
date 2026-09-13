"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { approvalTransaction } from "@/lib/approvals/service";
import { roleTablesReady } from "@/lib/roles/service";
import { roleDefinitionSchema, builtinRolePresentationSchema, normalizeRoleName, type RoleDefinitionInput, type BuiltinRolePresentationInput } from "./schema";
import { ADMINISTRATIVE_ROLE_ID, BUILTIN_ROLES, isBuiltinRole } from "@/lib/roles/catalog";
import { BUILTIN_PRESENTATION_KEY, readBuiltinPresentations } from "@/lib/roles/presentation";
import type { Prisma } from "@prisma/client";
export async function listRoleDefinitions() {
  await requireSystemAdmin();
  if (!await roleTablesReady()) return { ready: false, roles: [], builtins: [] };
  const roles = await prisma.roleDefinition.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }], include: { permissions: true, _count: { select: { users: true } } } });
  const builtins = await readBuiltinPresentations();
  const administrative = roles.find(role => role.id === ADMINISTRATIVE_ROLE_ID);
  return { ready: true, roles, builtins: builtins.map(role => role.id === ADMINISTRATIVE_ROLE_ID && administrative ? { ...role, name: administrative.name, description: administrative.description, version: administrative.version } : role) };
}
export async function saveRoleDefinition(input: RoleDefinitionInput) {
  const session = await requireSystemAdmin();
  if (input.id && isBuiltinRole(input.id)) throw new Error("内置角色只能修改名称和介绍，不能修改权限或启停状态");
  const parsed = roleDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const result = await approvalTransaction(async db => {
    const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true, active: true } });
    if (!actor?.active || actor.systemRole !== "SUPER_ADMIN") throw new Error("系统管理权限已失效");
    const old = data.id ? await db.roleDefinition.findUnique({ where: { id: data.id }, include: { permissions: true } }) : null;
    if (data.id && (!old || old.version !== data.version)) throw new Error("角色配置已变化，请刷新后再保存");
    await assertUniqueRoleName(db, data.name, data.id);
    const values = { name: data.name, normalizedName: normalizeRoleName(data.name), description: data.description, active: data.active };
    const definition = old
      ? await db.roleDefinition.update({ where: { id: old.id, version: data.version }, data: { ...values, version: { increment: 1 } } })
      : await db.roleDefinition.create({ data: values });
    // 配置条目按集合替换；不删除角色、账号或历史审计。
    await db.rolePermission.deleteMany({ where: { roleId: definition.id } });
    if (data.permissions.length) await db.rolePermission.createMany({ data: data.permissions.map(p => ({ ...p, roleId: definition.id })) });
    const affected = await db.user.updateMany({ where: { role: "CUSTOM", roleDefinitionId: definition.id }, data: { sessionVersion: { increment: 1 } } });
    await db.auditLog.create({ data: { userId: session.user.id, action: "ROLE_DEFINITION_SAVE", targetType: "RoleDefinition", targetId: definition.id, detail: { before: old ? { name: old.name, active: old.active, permissions: old.permissions.map(p => ({ permissionKey: p.permissionKey, scope: p.scope })) } : null, after: { ...values, permissions: data.permissions }, affectedUsers: affected.count } } });
    return { id: definition.id };
  });
  revalidatePath("/", "layout");
  return result;
}

/** 所有角色同一命名空间；沿用角色权限事务锁序列化检查和写入。 */
async function assertUniqueRoleName(db: Prisma.TransactionClient, name: string, ownId?: string) {
  const normalized = normalizeRoleName(name);
  const builtins = await readBuiltinPresentations(db);
  if (BUILTIN_ROLES.some(role => role.id !== ownId && (normalizeRoleName(role.name) === normalized || normalizeRoleName(role.id) === normalized)) ||
      builtins.some(role => role.id !== ownId && normalizeRoleName(role.name) === normalized)) {
    throw new Error("角色名称已被内置角色使用，请换一个名称");
  }
  const duplicate = await db.roleDefinition.findFirst({ where: { normalizedName: normalized, ...(ownId ? { id: { not: ownId } } : {}) }, select: { id: true } });
  if (duplicate) throw new Error("角色名称已存在，请换一个名称");
}

export async function saveBuiltinRolePresentation(input: BuiltinRolePresentationInput) {
  const session = await requireSystemAdmin();
  const parsed = builtinRolePresentationSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  await approvalTransaction(async db => {
    const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true, active: true } });
    if (!actor?.active || actor.systemRole !== "SUPER_ADMIN") throw new Error("系统管理权限已失效");
    const presentations = await readBuiltinPresentations(db);
    const stored = data.id === ADMINISTRATIVE_ROLE_ID
      ? await db.roleDefinition.findUnique({ where: { id: ADMINISTRATIVE_ROLE_ID }, select: { name: true, description: true, version: true } })
      : presentations.find(role => role.id === data.id);
    if (!stored || stored.version !== data.version) throw new Error("角色资料已变化，请刷新后再保存");
    await assertUniqueRoleName(db, data.name, data.id);
    const after = { name: data.name, description: data.description, version: data.version + 1 };
    if (data.id === ADMINISTRATIVE_ROLE_ID) {
      await db.roleDefinition.update({ where: { id: data.id, version: data.version }, data: { ...after, normalizedName: normalizeRoleName(data.name) } });
    } else {
      const value = Object.fromEntries(presentations.map(role => [role.id, role.id === data.id ? after : { name: role.name, description: role.description, version: role.version }]));
      await db.systemSetting.upsert({ where: { key: BUILTIN_PRESENTATION_KEY }, create: { key: BUILTIN_PRESENTATION_KEY, value }, update: { value } });
    }
    await db.auditLog.create({ data: { userId: session.user.id, action: "BUILTIN_ROLE_PRESENTATION_UPDATE", targetType: "BuiltinRole", targetId: data.id,
      detail: { before: { name: stored.name, description: stored.description, version: stored.version }, after } } });
  });
  revalidatePath("/", "layout");
  return { id: data.id };
}
