import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { approvalAudit } from "@/lib/approvals/service";
import { basicProfileSchema } from "./profile-schema";
import { identityDocumentTypeLabel } from "@/lib/identity-documents";
import type { z } from "zod";
import { ActionError } from "@/lib/action-error";

type Db = Prisma.TransactionClient;
export class ProfileInputError extends Error {}
export async function profileTransaction<T>(work: (db: Db) => Promise<T>) {
  try {
    return await prisma.$transaction(async db => {
      // 和账号停用、角色与审批授权变更共用锁。
      await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      return work(db);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = String(error.meta?.target ?? "");
        throw new Error(target.includes("identityDocument") ? "该类型的证件号码已登记，无法重复绑定" : "邮箱已被使用，请使用其他邮箱");
      }
      if (["P2034", "P2025"].includes(error.code)) throw new ActionError("资料或账号状态已变化，请刷新后重试");
      throw new ActionError("资料未能保存，请稍后重试");
    }
    if (error instanceof ProfileInputError) throw error;
    throw new ActionError("资料暂不可用，请稍后重试；如持续失败，请联系管理员");
  }
}
export async function assertProfileActor(db: Db, actorId: string, targetId: string, adminOnly = false) {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { active: true, systemRole: true } });
  if (!actor?.active) throw new ProfileInputError("账号已停用，请重新登录");
  if ((adminOnly || actorId !== targetId) && actor.systemRole !== "SUPER_ADMIN") throw new ProfileInputError("仅系统超级管理员可执行此操作");
}
export async function assertProfileVersion(db: Db, id: string, expectedUpdatedAt: string) {
  const current = await db.user.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) throw new ProfileInputError("资料已被更新，请刷新后重试");
}
export async function verifyProfilePassword(db: Db, id: string, password?: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } });
  if (!password || !await bcrypt.compare(password, user.passwordHash)) throw new ProfileInputError("当前密码不正确");
}
export async function saveBasicProfile(actorId: string, targetId: string, data: z.infer<typeof basicProfileSchema>, options: { admin: boolean; password?: string }) {
  return profileTransaction(async db => {
    await assertProfileActor(db, actorId, targetId, options.admin);
    await assertProfileVersion(db, targetId, data.expectedUpdatedAt);
    const current = await db.user.findUniqueOrThrow({ where: { id: targetId }, select: { name: true, email: true, phone: true } });
    const emailChanged = data.email !== current.email;
    if (emailChanged && (!options.admin || actorId === targetId)) await verifyProfilePassword(db, targetId, options.password);
    const fields = [current.name !== data.name ? "name" : null, emailChanged ? "email" : null,
      data.phone !== undefined && (data.phone || null) !== current.phone ? "phone" : null].filter((field): field is string => field !== null);
    if (!fields.length) return { emailChanged: false };
    await db.user.update({ where: { id: targetId, updatedAt: new Date(data.expectedUpdatedAt) }, data: {
      name: data.name, email: data.email, ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
      ...(emailChanged ? { sessionVersion: { increment: 1 } } : {})
    }, select: { id: true } });
    await approvalAudit(db, actorId, options.admin ? "USER_PROFILE_UPDATE" : "USER_PROFILE_UPDATE_SELF", targetId, { fields });
    return { emailChanged };
  });
}
export async function identitySummary(db: Db, id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: {
    identityDocumentType: true,
    identityDocumentName: true,
    identityDocumentNumber: true,
    identityDocuments: { where: { active: true }, orderBy: { createdAt: "asc" }, select: { id: true, pageKind: true } },
    updatedAt: true
  } });
  return {
    userId: id,
    documentType: user.identityDocumentType,
    documentTypeLabel: user.identityDocumentType ? (user.identityDocumentType === "OTHER" ? user.identityDocumentName || "其他身份证件" : identityDocumentTypeLabel[user.identityDocumentType]) : null,
    number: user.identityDocumentNumber,
    photos: user.identityDocuments,
    updatedAt: user.updatedAt.toISOString()
  };
}
