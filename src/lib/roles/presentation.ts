import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUILTIN_ROLES, type BuiltinRolePresentation } from "./catalog";

export const BUILTIN_PRESENTATION_KEY = "roles.builtinPresentation";

/** 只解析显示资料；配置中的权限、启用状态和系统身份永不参与授权。 */
export function parseBuiltinPresentations(value: unknown): BuiltinRolePresentation[] {
  const entries = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return BUILTIN_ROLES.map(role => {
    const raw = entries[role.id];
    const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return { ...role,
      name: typeof saved.name === "string" && saved.name.trim() && saved.name.length <= 60 ? saved.name.trim() : role.name,
      description: typeof saved.description === "string" && saved.description.length <= 300 ? saved.description : role.description,
      version: typeof saved.version === "number" && Number.isSafeInteger(saved.version) && saved.version >= 0 ? saved.version : 0,
    };
  });
}
export async function readBuiltinPresentations(db: Prisma.TransactionClient = prisma) {
  const setting = await db.systemSetting.findUnique({ where: { key: BUILTIN_PRESENTATION_KEY }, select: { value: true } });
  return parseBuiltinPresentations(setting?.value);
}
export async function builtinRoleName(role: string, db: Prisma.TransactionClient = prisma) {
  return (await readBuiltinPresentations(db)).find(entry => entry.id === role)?.name;
}

/** 仅追加岗位显示名称，不返回证件、联系方式或权限信息。 */
export async function withRoleNames<T extends { id: string; role: string }>(users: T[], db: Prisma.TransactionClient = prisma): Promise<(T & { roleName?: string })[]> {
  const names = new Map((await readBuiltinPresentations(db)).map(role => [role.id, role.name]));
  const customIds = users.filter(user => user.role === "CUSTOM").map(user => user.id);
  const custom = customIds.length ? await db.user.findMany({ where: { id: { in: customIds } }, select: { id: true, roleDefinition: { select: { name: true } } } }) : [];
  const customNames = new Map(custom.map(user => [user.id, user.roleDefinition?.name]));
  return users.map(user => ({ ...user, roleName: user.role === "CUSTOM" ? customNames.get(user.id) : names.get(user.role) }));
}
