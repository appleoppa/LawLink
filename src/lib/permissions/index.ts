import { scopeFor, type RoleGrant, type PermissionKey } from "@/lib/roles/catalog";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action-error";

/**
 * 业务管理判定：合伙人岗位，或获按人授予的业务管理权（User.managerAuthorized，
 * 2026-09-19 与岗位解耦）。系统管理身份不自动获得业务权限。
 * 传岗位字符串时仅认合伙人；有用户对象时请整体传入。
 */
export function isManager(roleOrUser: string | { role: string; managerAuthorized?: boolean | null }): boolean {
  if (typeof roleOrUser === "string") return roleOrUser === "PRINCIPAL_LAWYER";
  return roleOrUser.role === "PRINCIPAL_LAWYER" || roleOrUser.managerAuthorized === true;
}

/** 内置岗位用户携带全所范围授权（业务管理权合成的 grants）时，按该范围放开可见性。 */
export function hasAllScope(grants: RoleGrant[] | undefined, key: PermissionKey): boolean {
  return scopeFor({ role: "CUSTOM", rolePermissions: grants }, key) === "ALL";
}

/**
 * 实收确认权（2026-09-19 用户确认）：任何人登记的实收都先挂「待确认」，包括主任律师
 * 自己收的案件；只有具备「确认实收到账」（finance.confirm）的财务管理人员才能确认或退回。
 * 内置角色里仅「财务」自带该权限，其余人员由管理后台的自定义角色授予，人选与范围在后台配置。
 */
export function canConfirmReceipt(user: { role: string; rolePermissions?: RoleGrant[] | null }): boolean {
  if (user.role === "CUSTOM") return scopeFor({ role: user.role, rolePermissions: user.rolePermissions ?? undefined }, "finance.confirm") === "ALL";
  return user.role === "FINANCE";
}

/**
 * 财务岗的案件关联豁免（与 assertMatterWritable({allowFinanceRole:true}) 同一判定）：
 * 内置财务岗，或自定义角色具全所范围「维护收付款 / 确认实收到账」之一。
 * 只放开收付登记等场景的案件关联范围（如登记收付时的案件搜索），不改变其他权限语义。
 */
export function financeRoleAssociatesAnyMatter(user: { role: string; rolePermissions?: RoleGrant[] | null }): boolean {
  if (user.role === "FINANCE") return true;
  if (user.role !== "CUSTOM") return false;
  const grants = user.rolePermissions ?? undefined;
  return scopeFor({ role: "CUSTOM", rolePermissions: grants }, "finance.write") === "ALL" ||
    scopeFor({ role: "CUSTOM", rolePermissions: grants }, "finance.confirm") === "ALL";
}

// ============ 案件可见性 ============

/** 列表查询用：返回 Prisma where 片段，AND 到现有 where */
export function matterVisibilityFilter(
  userId: string,
  role: string,
  grants?: RoleGrant[]
): Prisma.MatterWhereInput {
  if (role === "CUSTOM") return customMatterFilter(userId, grants, "matters.read", false);
  if (isManager(role) || role === "FINANCE" || hasAllScope(grants, "matters.read")) return {};
  if (role === "LAWYER" || role === "INDEPENDENT_LAWYER") {
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
  // v1.x 制度决策 4.1（选项 A）：受限事项（teamAccessRestricted）不进入
  // 团队汇总视图——限制优先于团队授权；个人直接授权（主办/成员）不受影响。
  return { AND: [{ teamAccessRestricted: false }], OR: [{ owner: subject }, { registeredBy: subject }] };
}

export function teamIntakeFilter(userId: string, teamId?: string): Prisma.IntakeWhereInput {
  const subject = teamSubjectFilter(userId, teamId);
  return { OR: [{ ownerUser: subject }, { createdBy: subject }] };
}

export function matterReadVisibilityFilter(userId: string, role: string, grants?: RoleGrant[]): Prisma.MatterWhereInput {
  if (role === "CUSTOM") return customMatterFilter(userId, grants, "matters.read", true);
  if (isManager(role) || hasAllScope(grants, "matters.read")) return {};
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
  if (isManager(role) || hasAllScope(grants, "matters.read")) return {};
  return { AND: [{ OR: [intakeVisibilityFilter(userId, role), teamIntakeFilter(userId)] }] };
}

export async function assertCanReadMatter(userId: string, role: string, matterId: string, grants?: RoleGrant[]): Promise<void> {
  const row = await prisma.matter.findFirst({
    where: { id: matterId, deletedAt: null, ...matterReadVisibilityFilter(userId, role, grants) },
    select: { id: true }
  });
  if (row) return;
  // F-6 归档借阅：常规可见性不通过时，实时校验该案有效借阅单（已批准、未归还、
  // 未到期）——到期即失效，不靠隐藏入口；借阅只读，不改变其余权限面
  const borrowed = await prisma.archiveBorrowRequest.findFirst({
    where: {
      applicantId: userId,
      status: "APPROVED",
      accessUntil: { gte: new Date() },
      archiveRecord: { status: "APPROVED", matterId }
    },
    select: { id: true }
  });
  if (!borrowed) throw new ActionError("案件不存在");
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
    if (!exists) throw new ActionError("案件不存在");
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
  if (!row) throw new ActionError("案件不存在");
}

/** 财务授权仅用于财务字段，不能作为案件正文或材料访问授权。 */
export async function assertCanAccessMatterFinance(userId: string, role: string, matterId: string, grants?: RoleGrant[]): Promise<void> {
  if (role === "CUSTOM") {
    if (!await prisma.matter.count({ where: { id: matterId, deletedAt: null, ...matterFinanceVisibilityFilter(userId, role, grants) } })) throw new ActionError("案件不存在或无财务权限");
    return;
  }
  if (role === "FINANCE") {
    if (!await prisma.matter.count({ where: { id: matterId, deletedAt: null } })) throw new ActionError("案件不存在");
    return;
  }
  await assertCanAccessMatter(userId, role, matterId);
}

/**
 * 案件办理/材料操作断言（2026-09-20 A 批 P1-1）：合伙人岗位沿用全所可见口径，
 * 其余岗位（含 managerAuthorized 业务管理权）须本案经办关联——管理权只放大「可见」
 * 不放大「写入」。结构性案件编辑（程序当事人信息、证据、材料新版本/归档）统一走此断言，
 * 不各自调用 assertCanAccessMatter 导致 MANAGER_GRANTS 的 matters.read:ALL 渗入写路径。
 */
export async function assertCanHandleMatter(
  user: { id: string; role: string; rolePermissions?: RoleGrant[] },
  matterId: string
): Promise<void> {
  if (user.role === "PRINCIPAL_LAWYER") {
    return assertCanAccessMatter(user.id, user.role, matterId, user.rolePermissions);
  }
  return assertCanAssociateMatter(user.id, matterId);
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
  if (!row) throw new ActionError("案件不存在或无权关联");
}

/** 案件处理断言（并入 2026-09-20 A 批 assertCanHandleMatter）：合伙人全所、其余须经办。 */

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
  if (!matter) throw new ActionError("案件不存在");
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
  if (isManager(role) || hasAllScope(grants, "matters.read")) return {};
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
  if (isManager(role) || role === "FINANCE" || hasAllScope(grants, "clients.read")) return {};
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
  throw new ActionError("权限不足");
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
  if (role === "CUSTOM") return customMatterFilter(userId, grants, "finance.read", false);
  if (isManager(role) || hasAllScope(grants, "finance.read") || hasAllScope(grants, "matters.read")) return {};
  return matterVisibilityFilter(userId, role, grants);
}
