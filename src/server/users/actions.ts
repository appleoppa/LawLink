"use server";

import { readBuiltinPresentations } from "@/lib/roles/presentation";
import { roleTablesReady } from "@/lib/roles/service";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSystemAdmin } from "@/lib/auth/session";
import { approvalTransaction, approvalAudit } from "@/lib/approvals/service";
import { audit } from "@/server/audit";
import { identityDocumentInputSchema } from "@/lib/identity-documents";
import { storeIdentityDocumentFiles } from "@/server/identity-documents/storage";
import { adminProfileSchema } from "./profile-schema";
import { saveBasicProfile } from "./profile-service";

const userRoleSchema = z.enum([
  "CUSTOM",
  "PRINCIPAL_LAWYER",
  "LAWYER",
  "ASSISTANT",
  "FINANCE"
]);

const userCreateSchema = z.object({
  name: z.string().min(1, "姓名必填").max(40),
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(128),
  role: userRoleSchema,
  roleDefinitionId: z.string().cuid().nullable().optional(),
  phone: z.string().max(30).optional().or(z.literal(""))
}).and(identityDocumentInputSchema);

const userUpdateRoleSchema = z.object({
  id: z.string().cuid(),
  role: userRoleSchema,
  roleDefinitionId: z.string().cuid().nullable().optional(),
  expectedRole: userRoleSchema.optional(),
  expectedRoleDefinitionId: z.string().nullable().optional()
});

const userUpdateSystemRoleSchema = z.object({
  id: z.string().cuid(),
  systemRole: z.enum(["NONE", "SUPER_ADMIN"]),
  expectedSystemRole: z.enum(["NONE", "SUPER_ADMIN"])
});

const resetPasswordSchema = z.object({
  id: z.string().cuid(),
  newPassword: z.string().min(8).max(128)
});

const changeMyPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128)
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateRoleInput = z.infer<typeof userUpdateRoleSchema>;
export type UserUpdateSystemRoleInput = z.infer<typeof userUpdateSystemRoleSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;

async function requireAdmin() {
  return requireSystemAdmin();
}

export async function listUsers() {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      systemRole: true,
      phone: true,
      active: true,
      lastLoginAt: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      totpEnabled: true,
      totpEnforced: true,
      createdAt: true,
      updatedAt: true,
      approvalMemberships: { where: { active: true, group: { active: true } }, select: { group: { select: { id: true, name: true } } } },
      _count: { select: { ownedMatters: true, memberships: true } }
    }
  });
  const definitions = await roleTablesReady() ? await prisma.user.findMany({ where: { role: "CUSTOM" }, select: { id: true, roleDefinitionId: true, roleDefinition: { select: { name: true, active: true } } } }) : [];
  const builtinNames = new Map((await readBuiltinPresentations()).map(role => [role.id, role.name]));
  return users.map(user => { const custom = definitions.find(d => d.id === user.id); return { ...user, roleDefinitionId: custom?.roleDefinitionId ?? null, roleName: custom?.roleDefinition?.name ?? builtinNames.get(user.role), roleActive: custom?.roleDefinition?.active ?? true }; });
}

/**
 * 任意登录用户都可调：拿活跃同事列表，用于收案/案件团队选择。
 * 返回活跃同事及真实业务岗位；系统管理身份不影响业务协作选择。
 */
export async function listActiveColleagues() {
  const session = await requireSession("personal");
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true,
      teamMemberships: {
        where: { active: true, team: { active: true,
          members: { some: { userId: session.user.id, active: true } } } },
        select: { teamId: true }
      }
    }
  });
  const customUsers = users.filter(u => u.role === "CUSTOM");
  const customNames = customUsers.length ? await prisma.user.findMany({ where: { id: { in: customUsers.map(u => u.id) } }, select: { id: true, roleDefinition: { select: { name: true, active: true } } } }) : [];
  const customMap = new Map(customNames.map(u => [u.id, u.roleDefinition]));
  const builtinNames = new Map((await readBuiltinPresentations()).map(role => [role.id, role.name]));
  return users.filter(u => u.role !== "CUSTOM" || customMap.get(u.id)?.active).map(({ teamMemberships, ...user }) => ({
    ...user, roleName: customMap.get(user.id)?.name ?? builtinNames.get(user.role), isTeammate: teamMemberships.length > 0
  })).sort((a, b) => Number(b.isTeammate) - Number(a.isTeammate) || a.name.localeCompare(b.name, "zh-CN"));
}

export async function createUser(formData: FormData) {
  const session = await requireAdmin();
  const roleDefinitionId = formData.get("roleDefinitionId");
  const data = userCreateSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    roleDefinitionId: typeof roleDefinitionId === "string" && roleDefinitionId ? roleDefinitionId : null,
    phone: formData.get("phone"),
    identityDocumentType: formData.get("identityDocumentType"),
    identityDocumentName: formData.get("identityDocumentName"),
    identityDocumentNumber: formData.get("identityDocumentNumber")
  });
  const files = [formData.get("identityImagePrimary"), formData.get("identityImageSecondary")]
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length) throw new Error("请上传证件照片");
  if (files.length > 2) throw new Error("最多上传两张证件照片");

  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) throw new Error("邮箱已被使用");
  const existingIdentity = await prisma.user.findFirst({ where: {
    identityDocumentType: data.identityDocumentType,
    identityDocumentNumber: data.identityDocumentNumber
  }, select: { id: true } });
  if (existingIdentity) throw new Error("该类型的证件号码已登记");

  const passwordHash = await bcrypt.hash(data.password, 12);
  let created: { id: string };
  try {
    created = await approvalTransaction(async db => {
      await assertCurrentAdmin(db, session.user.id);
      const assignment = await validateRoleAssignment(db, data);
      const user = await db.user.create({ data: {
        name: data.name,
        email: data.email,
        passwordHash,
        ...assignment,
        phone: data.phone || null,
        identityDocumentType: data.identityDocumentType,
        identityDocumentName: data.identityDocumentType === "OTHER" ? data.identityDocumentName : null,
        identityDocumentNumber: data.identityDocumentNumber,
        active: true
      }, select: { id: true } });
      const identityFiles = await storeIdentityDocumentFiles({
        userId: user.id,
        uploadedById: session.user.id,
        documentType: data.identityDocumentType,
        files
      });
      await db.userIdentityDocument.createMany({ data: identityFiles });
      await approvalAudit(db, session.user.id, "USER_CREATE", user.id, {
        role: data.role,
        roleDefinitionId: data.roleDefinitionId ?? null,
        identityDocumentType: data.identityDocumentType,
        identityPhotoCount: identityFiles.length
      });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw new Error(target.includes("identityDocument") ? "该类型的证件号码已登记" : "邮箱已被使用");
    }
    throw error;
  }

  revalidatePath("/admin/users");
  return { ok: true, id: created.id };
}

export async function updateUserRole(input: UserUpdateRoleInput) {
  const session = await requireAdmin();
  const data = userUpdateRoleSchema.parse(input);
  if (data.id === session.user.id) {
    throw new Error("不能修改自己的角色");
  }

  await approvalTransaction(async db => {
    await assertCurrentAdmin(db, session.user.id);
    const current = await db.user.findUniqueOrThrow({ where: { id: data.id }, select: { role: true, active: true, roleDefinitionId: true } });
    if ((data.expectedRole && current.role !== data.expectedRole) || (data.expectedRoleDefinitionId !== undefined && current.roleDefinitionId !== data.expectedRoleDefinitionId)) throw new Error("账号角色已变化，请刷新后再修改");
    const assignment = await validateRoleAssignment(db, data);
    await db.user.update({ where: { id: data.id }, data: { ...assignment, sessionVersion: { increment: 1 } } });
    await approvalAudit(db, session.user.id, "USER_ROLE_UPDATE", data.id, { before: current.role, beforeRoleDefinitionId: current.roleDefinitionId, after: data.role, afterRoleDefinitionId: data.roleDefinitionId ?? null });
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

async function validateRoleAssignment(db: import("@prisma/client").Prisma.TransactionClient, data: { role: import("@prisma/client").UserRole; roleDefinitionId?: string | null }) {
  if (data.role !== "CUSTOM") {
    if (data.roleDefinitionId) throw new Error("系统角色不能同时关联自定义角色");
    return { role: data.role, roleDefinitionId: null };
  }
  if (!data.roleDefinitionId) throw new Error("请选择自定义角色");
  const role = await db.roleDefinition.findUnique({ where: { id: data.roleDefinitionId }, select: { active: true } });
  if (!role?.active) throw new Error("角色不存在或已停用，请重新选择");
  return { role: data.role, roleDefinitionId: data.roleDefinitionId };
}

async function assertCurrentAdmin(db: import("@prisma/client").Prisma.TransactionClient, id: string) {
  const actor = await db.user.findUnique({ where: { id }, select: { active: true, systemRole: true } });
  if (!actor?.active || actor.systemRole !== "SUPER_ADMIN") throw new Error("系统管理权限已失效");
}
async function protectLastSystemAdmin(db: import("@prisma/client").Prisma.TransactionClient) {
  if (await db.user.count({ where: { active: true, systemRole: "SUPER_ADMIN" } }) <= 1) {
    throw new Error("必须保留至少一个有效系统超级管理员账号");
  }
}

export async function updateUserSystemRole(input: UserUpdateSystemRoleInput) {
  const session = await requireAdmin();
  const data = userUpdateSystemRoleSchema.parse(input);
  if (data.id === session.user.id) throw new Error("不能修改自己的系统管理身份");
  await approvalTransaction(async db => {
    await assertCurrentAdmin(db, session.user.id);
    const current = await db.user.findUniqueOrThrow({ where: { id: data.id }, select: { active: true, systemRole: true } });
    if (current.systemRole !== data.expectedSystemRole) throw new Error("系统管理身份已变化，请刷新后再修改");
    if (current.active && current.systemRole === "SUPER_ADMIN" && data.systemRole !== "SUPER_ADMIN") {
      await protectLastSystemAdmin(db);
    }
    await db.user.update({ where: { id: data.id }, data: { systemRole: data.systemRole, sessionVersion: { increment: 1 } } });
    await approvalAudit(db, session.user.id, "USER_SYSTEM_ROLE_UPDATE", data.id, { before: current.systemRole, after: data.systemRole });
  });
  revalidatePath("/admin/users");
  return { ok: true };
}
export async function setUserActive(input: { id: string; active: boolean }) {
  const session = await requireAdmin();
  const data = z.object({ id: z.string().cuid(), active: z.boolean() }).parse(input);
  if (data.id === session.user.id && !data.active) throw new Error("不能禁用自己");
  await approvalTransaction(async db => {
    await assertCurrentAdmin(db, session.user.id);
    const current = await db.user.findUniqueOrThrow({ where: { id: data.id }, select: { active: true, systemRole: true } });
    if (current.active === data.active) return;
    if (current.active && current.systemRole === "SUPER_ADMIN" && !data.active) await protectLastSystemAdmin(db);
    await db.user.update({ where: { id: data.id }, data: { active: data.active, sessionVersion: { increment: 1 } } });
    await approvalAudit(db, session.user.id, data.active ? "USER_ACTIVATE" : "USER_DEACTIVATE", data.id);
  });
  revalidatePath("/admin/users");
  return { ok: true, active: data.active };
}
/** v1.x P0-3: 管理员解除登录锁定（清零失败计数，写审计） */
export async function unlockUserLogin(input: { id: string }) {
  const session = await requireAdmin();
  const { id } = z.object({ id: z.string().cuid() }).parse(input);

  await approvalTransaction(async db => {
    const user = await db.user.findUnique({ where: { id }, select: { lockedUntil: true, failedLoginAttempts: true } });
    if (!user) throw new Error("账号不存在");
    if (!user.lockedUntil) throw new Error("该账号未处于锁定状态");
    await db.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });
    await approvalAudit(db, session.user.id, "USER_LOGIN_UNLOCK", id);
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUserProfile(input: z.infer<typeof adminProfileSchema>) {
  const session = await requireAdmin();
  const parsed = adminProfileSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const result = await saveBasicProfile(session.user.id, parsed.data.id, parsed.data, { admin: true, password: parsed.data.currentPassword });
  revalidatePath("/", "layout");
  return result;
}

export async function resetUserPassword(input: ResetPasswordInput) {
  const session = await requireAdmin();
  const data = resetPasswordSchema.parse(input);

  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  await approvalTransaction(async db => {
    await assertCurrentAdmin(db, session.user.id);
    await db.user.update({ where: { id: data.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await approvalAudit(db, session.user.id, "USER_PASSWORD_RESET", data.id);
  });

  return { ok: true };
}

/**
 * 当前用户改自己的密码（任何角色可用）。
 */
export async function changeMyPassword(input: ChangeMyPasswordInput) {
  const session = await requireSession("personal");
  const data = changeMyPasswordSchema.parse(input);

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true }
  });
  if (!me) throw new Error("用户不存在");

  const matches = await bcrypt.compare(data.currentPassword, me.passwordHash);
  if (!matches) throw new Error("当前密码不正确");

  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  await approvalTransaction(async db => {
    await db.user.update({ where: { id: session.user.id, passwordHash: me.passwordHash, active: true }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await approvalAudit(db, session.user.id, "USER_PASSWORD_CHANGE_SELF", session.user.id);
  });

  return { ok: true };
}

/** v0.43：保存 / 清除个人头像（base64 data URL 内联存 User.avatar，约 256KB 上限） */
const AVATAR_MAX_CHARS = 256 * 1024;
export async function saveMyAvatar(input: { avatar: string | null }) {
  const session = await requireSession("personal");
  let avatar = input.avatar;
  if (typeof avatar === "string" && avatar.length > 0) {
    if (!/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(avatar)) {
      throw new Error("头像必须是 PNG / JPG / WebP / SVG 图片");
    }
    if (avatar.length > AVATAR_MAX_CHARS) {
      throw new Error("头像体积过大，请控制在约 180KB 以内");
    }
  } else {
    avatar = null;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatar }
  });

  await audit({
    userId: session.user.id,
    action: "USER_AVATAR_UPDATE",
    targetType: "User",
    targetId: session.user.id
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * v1.x P1 收尾 c: 管理端强制开启双步验证（仅 SUPER_ADMIN）。
 *
 * enforced 且用户尚未绑定（totpEnabled=false）时登录 authorize 直接拒绝并审计
 * （LOGIN_TOTP_ENFORCED_REJECT，提示文案由登录页 A 线经 checkLoginTotpEnforcement
 * 展示"请先绑定双步验证"）；已绑定者行为不变。enforced 用户不可自行关闭双步验证。
 * enabled 可传 false 撤销强制（误设置解锁用），默认 true。
 * UI 入口（用户管理页操作项）待 A 线接入。
 */
const totpEnforceSchema = z.object({
  id: z.string().cuid(),
  enabled: z.boolean().default(true)
});
export type TotpEnforceInput = z.input<typeof totpEnforceSchema>;

export async function forceEnforceTotp(input: TotpEnforceInput) {
  const session = await requireAdmin();
  const data = totpEnforceSchema.parse(input);

  await approvalTransaction(async db => {
    await assertCurrentAdmin(db, session.user.id);
    const current = await db.user.findUnique({
      where: { id: data.id },
      select: { active: true, totpEnforced: true, totpEnabled: true }
    });
    if (!current) throw new Error("账号不存在");
    if (current.totpEnforced === data.enabled) return; // 幂等：状态未变不重复审计
    await db.user.update({
      where: { id: data.id },
      data: { totpEnforced: data.enabled }
    });
    await approvalAudit(db, session.user.id, "USER_TOTP_ENFORCE", data.id, {
      enforced: data.enabled,
      alreadyBound: current.totpEnabled
    });
  });

  revalidatePath("/admin/users");
  return { ok: true, enforced: data.enabled };
}
