import { scopeFor, type RoleGrant, type PermissionKey } from "@/lib/roles/catalog";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 主任律师属于业务管理岗位；系统管理身份不扩大业务数据范围。 */
export function isManager(role: string): boolean {
  return role === "PRINCIPAL_LAWYER";
}

// ============ 案件可见性 ============

/** 列表查询用：返回 Prisma where 片段，AND 到现有 where */
export function matterVisibilityFilter(
  userId: string,
  role: string,
  grants?: RoleGrant[]
): Prisma.MatterWhereInput {
  if (role === "CUSTOM") return customMatterFilter(userId, grants, "matters.read", false);
  if (isManager(role) || role === "FINANCE") return {};
  if (role === "LAWYER") {
    return {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } }
      ]
    };
  }
  // ASSISTANT
  return { members: { some: { userId } } };
}

/** 操作/关联案件用：不因主任律师或财务岗位放大全所范围 */
export function matterAssociationFilter(userId: string): Prisma.MatterWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } }
    ]
  };
}

/** 团队只读授权实时走成员关系，不能用于写入、财务、附件或导出。 */
export function readableTeamFilter(userId: string): Prisma.TeamWhereInput {
  return {
    active: true,
    members: { some: { userId, active: true, user: { active: true } } },
    OR: [
      { leaderId: userId },
      { members: { some: { userId, active: true, canViewAllMatters: true } } }
    ]
  };
}

function teamSubjectFilter(userId: string, teamId?: string): Prisma.UserWhereInput {
  return {
    teamMemberships: { some: {
      active: true,
      team: { ...readableTeamFilter(userId), ...(teamId ? { id: teamId } : {}) }
    } }
  };
}

export function teamMatterFilter(userId: string, teamId?: string): Prisma.MatterWhereInput {
  const subject = teamSubjectFilter(userId, teamId);
  return { OR: [{ owner: subject }, { registeredBy: subject }] };
}

export function teamIntakeFilter(userId: string, teamId?: string): Prisma.IntakeWhereInput {
  const subject = teamSubjectFilter(userId, teamId);
  return { OR: [{ ownerUser: subject }, { createdBy: subject }] };
}

export function matterReadVisibilityFilter(userId: string, role: string, grants?: RoleGrant[]): Prisma.MatterWhereInput {
  if (role === "CUSTOM") return customMatterFilter(userId, grants, "matters.read", true);
  if (isManager(role)) return {};
  const own = role === "FINANCE" ? matterAssociationFilter(userId) : matterVisibilityFilter(userId, role, grants);
  return { AND: [{ OR: [own, teamMatterFilter(userId)] }] };
}

export function intakeReadVisibilityFilter(userId: string, role: string, grants?: RoleGrant[]): Prisma.IntakeWhereInput {
  if (role === "CUSTOM") {
    const scope = scopeFor({ role, rolePermissions: grants }, "matters.read");
    if (!scope) return { id: { in: [] } };
    if (scope === "ALL") return {};
    const own = intakeVisibilityFilter(userId, "LAWYER");
    return { AND: [scope === "TEAM" ? { OR: [own, teamIntakeFilter(userId)] } : own] };
  }
  if (isManager(role)) return {};
  return { AND: [{ OR: [intakeVisibilityFilter(userId, role), teamIntakeFilter(userId)] }] };
}

export async function assertCanReadMatter(userId: string, role: string, matterId: string, grants?: RoleGrant[]): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...matterReadVisibilityFilter(userId, role, grants) },
    select: { id: true }
  });
  if (!row) throw new Error("案件不存在");
}

export async function hasMatterBusinessAccess(userId: string, role: string, matterId: string, grants?: RoleGrant[]): Promise<boolean> {
  if (role === "CUSTOM") return Boolean(scopeFor({ role, rolePermissions: grants }, "matters.read")) && Boolean(await prisma.matter.count({ where: { id: matterId, deletedAt: null, ...matterAssociationFilter(userId) } }));
  return Boolean(await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...(role === "FINANCE" ? matterAssociationFilter(userId) : matterVisibilityFilter(userId, role, grants)) },
    select: { id: true }
  }));
}

/** 原有访问断言：团队只读授权不扩大此范围。 */
export async function assertCanAccessMatter(
  userId: string,
  role: string,
  matterId: string,
  grants?: RoleGrant[]
): Promise<void> {
  if (isManager(role)) {
    const exists = await prisma.matter.findFirst({
      where: { id: matterId, deletedAt: null },
      select: { id: true }
    });
    if (!exists) throw new Error("案件不存在");
    return;
  }
  const row = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      ...(role === "FINANCE" ? matterAssociationFilter(userId) : matterVisibilityFilter(userId, role, grants))
    },
    select: { id: true }
  });
  if (!row) throw new Error("案件不存在");
}

/** 财务授权仅用于财务字段，不能作为案件正文或材料访问授权。 */
export async function assertCanAccessMatterFinance(userId: string, role: string, matterId: string, grants?: RoleGrant[]): Promise<void> {
  if (role === "CUSTOM") {
    if (!await prisma.matter.count({ where: { id: matterId, deletedAt: null, ...matterFinanceVisibilityFilter(userId, role, grants) } })) throw new Error("案件不存在或无财务权限");
    return;
  }
  if (role === "FINANCE") {
    if (!await prisma.matter.count({ where: { id: matterId, deletedAt: null } })) throw new Error("案件不存在");
    return;
  }
  await assertCanAccessMatter(userId, role, matterId);
}

/** 操作/关联断言：只允许主办或案件成员，不因管理角色放开 */
export async function assertCanAssociateMatter(
  userId: string,
  matterId: string
): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      ...matterAssociationFilter(userId)
    },
    select: { id: true }
  });
  if (!row) throw new Error("案件不存在或无权关联");
}

/** 案件处理断言：只允许主办或案件成员，不因管理角色放开 */
export async function assertCanHandleMatter(
  userId: string,
  matterId: string
): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      ...matterAssociationFilter(userId)
    },
    select: { id: true }
  });
  if (!row) throw new Error("案件不存在或无权处理");
}

/** 主办/协办断言：用于归档、团队、核心信息、文书生成等较敏感处理 */
export async function assertCanLeadMatter(
  userId: string,
  matterId: string,
  message = "仅案件主办/协办可操作"
): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, role: { in: ["LEAD", "CO_LEAD"] } } } }
      ]
    },
    select: { id: true }
  });
  if (!row) throw new Error(message);
}

/** 当前主办律师断言：用于变更承办团队、删除案件等所有权级操作 */
export async function assertCanOwnMatter(
  userId: string,
  matterId: string,
  message = "仅案件主办律师可操作"
): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      ownerId: userId
    },
    select: { id: true }
  });
  if (!row) throw new Error(message);
}

/** 修改断言：只允许主办或案件成员，不因管理角色放开 */
export async function assertCanModifyMatter(
  userId: string,
  _role: string,
  matterId: string
): Promise<void> {
  const matter = await prisma.matter.findFirst({
    where: {
      id: matterId,
      deletedAt: null,
      ...matterAssociationFilter(userId)
    },
    select: { id: true }
  });
  if (!matter) throw new Error("案件不存在");
}

// ============ 收案可见性 ============

export function intakeVisibilityFilter(
  userId: string,
  role: string,
  grants?: RoleGrant[]
): Prisma.IntakeWhereInput {
  if (role === "CUSTOM") {
    const scope = scopeFor({ role, rolePermissions: grants }, "matters.read");
    if (!scope) return { id: { in: [] } };
    if (scope === "ALL") return {};
  }
  if (isManager(role)) return {};
  return {
    OR: [
      { createdById: userId },
      { ownerUserId: userId },
      { coUserIds: { has: userId } }
    ]
  };
}

// ============ 客户可见性 ============

/** 客户通过关联的案件判断可见性；manager/finance 看全部 */
export function clientVisibilityFilter(
  userId: string,
  role: string,
  grants?: RoleGrant[]
): Prisma.ClientWhereInput {
  if (role === "CUSTOM") {
    const scope = scopeFor({ role, rolePermissions: grants }, "clients.read");
    if (!scope) return { id: { in: [] } };
    if (scope === "ALL") return {};
    return { AND: [{ OR: [{ matters: { some: { deletedAt: null, ...matterAssociationFilter(userId) } } }, { intakes: { some: intakeVisibilityFilter(userId, "LAWYER") } }] }] };
  }
  if (isManager(role) || role === "FINANCE") return {};
  return {
    OR: [
      { matters: { some: { deletedAt: null, ...matterVisibilityFilter(userId, role, grants) } } },
      { intakes: { some: intakeVisibilityFilter(userId, role) } }
    ]
  };
}

// ============ 通用断言 ============

export function assertManagerOrRole(role: string, ...allowed: string[]): void {
  if (isManager(role)) return;
  if (allowed.includes(role)) return;
  throw new Error("权限不足");
}

/** 自定义角色的全所查看只影响读取，不替代案件经办与独立业务授权。 */
export function customMatterFilter(userId: string, grants: RoleGrant[] | undefined, key: PermissionKey, includeTeam: boolean): Prisma.MatterWhereInput {
  const scope = scopeFor({ role: "CUSTOM", rolePermissions: grants }, key);
  if (!scope) return { id: { in: [] } };
  if (scope === "ALL") return {};
  const own = matterAssociationFilter(userId);
  return { AND: [scope === "TEAM" && includeTeam ? { OR: [own, teamMatterFilter(userId)] } : own] };
}
export function matterFinanceVisibilityFilter(userId: string, role: string, grants?: RoleGrant[]): Prisma.MatterWhereInput {
  return role === "CUSTOM" ? customMatterFilter(userId, grants, "finance.read", false) : matterVisibilityFilter(userId, role);
}
