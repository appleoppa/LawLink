"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApprovalAction, ApprovalCaseScope, MatterCategory, SealType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { APPROVAL_SETTING_KEY, approvalAudit, approvalSettings, approvalTransaction, type ApprovalDb } from "@/lib/approvals/service";

async function admin(db: ApprovalDb = prisma) {
  const session = await requireSession();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { active: true, systemRole: true } });
  if (!user?.active || user.systemRole !== "SUPER_ADMIN") throw new Error("仅系统超级管理员可以配置审批权限");
  return session.user.id;
}
const ruleSchema = z.object({
  action: z.nativeEnum(ApprovalAction), caseScope: z.nativeEnum(ApprovalCaseScope),
  categories: z.array(z.nativeEnum(MatterCategory)).max(8),
  allSealPurposes: z.boolean(), purposeId: z.string().cuid().nullable(),
  sealTypes: z.array(z.nativeEnum(SealType)).max(5)
}).superRefine((rule, ctx) => {
  if (rule.caseScope === "CATEGORIES" && !rule.categories.length) ctx.addIssue({ code: "custom", message: "请选择案件类别" });
  if (["SEAL_APPROVE", "SEAL_STAMP"].includes(rule.action)) {
    if (!rule.sealTypes.length) ctx.addIssue({ code: "custom", message: "请选择印章类型" });
    if (!rule.allSealPurposes && !rule.purposeId) ctx.addIssue({ code: "custom", message: "请选择用章事项" });
  }
});
const groupSchema = z.object({
  id: z.string().cuid().optional(), name: z.string().trim().min(1).max(60), description: z.string().trim().max(300),
  active: z.boolean(), userIds: z.array(z.string().cuid()).max(500), rules: z.array(ruleSchema).min(1).max(100)
});
export type PermissionGroupInput = z.infer<typeof groupSchema>;
export async function getPermissionAdministration() {
  await admin();
  const [groups, purposes, users, settings] = await Promise.all([
    prisma.approvalPermissionGroup.findMany({ orderBy: { name: "asc" }, include: { rules: { where: { active: true } }, members: { where: { active: true } } } }),
    prisma.sealPurposeConfig.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, role: true, active: true } }),
    approvalSettings()
  ]);
  return { groups, purposes, users, settings };
}
export async function savePermissionGroup(input: PermissionGroupInput) {
  const data = groupSchema.parse(input);
  data.rules = data.rules.map(rule => rule.action.startsWith("SEAL_")
    ? { ...rule, purposeId: rule.allSealPurposes ? null : rule.purposeId }
    : { ...rule, allSealPurposes: false, purposeId: null, sealTypes: [] });
  await approvalTransaction(async db => {
    const actorId = await admin(db);
    const before = data.id ? await db.approvalPermissionGroup.findUniqueOrThrow({ where: { id: data.id }, include: { rules: { where: { active: true } }, members: { where: { active: true } } } }) : null;
    const uniqueIds = [...new Set(data.userIds)];
    if (await db.user.count({ where: { id: { in: uniqueIds } } }) !== uniqueIds.length) throw new Error("存在已失效的账号");
    for (const rule of data.rules) {
      if (data.active && rule.purposeId) {
        const purpose = await db.sealPurposeConfig.findUnique({ where: { id: rule.purposeId } });
        if (!purpose?.active || rule.sealTypes.some(type => !purpose.allowedSealTypes.includes(type))) throw new Error("事项已停用或不支持所选印章");
      }
    }
    const group = data.id ? await db.approvalPermissionGroup.update({ where: { id: data.id }, data: { name: data.name, description: data.description, active: data.active } })
      : await db.approvalPermissionGroup.create({ data: { name: data.name, description: data.description, active: data.active } });
    await db.approvalPermissionRule.updateMany({ where: { groupId: group.id, active: true }, data: { active: false } });
    await db.approvalPermissionRule.createMany({ data: data.rules.map(rule => ({ ...rule, groupId: group.id })) });
    await db.approvalPermissionMember.updateMany({ where: { groupId: group.id }, data: { active: false } });
    for (const userId of uniqueIds) await db.approvalPermissionMember.upsert({ where: { groupId_userId: { groupId: group.id, userId } }, update: { active: true }, create: { groupId: group.id, userId } });
    await approvalAudit(db, actorId, "APPROVAL_PERMISSION_GROUP_SAVE", group.id, {
      before: before ? { name: before.name, active: before.active, rules: before.rules, userIds: before.members.map(m => m.userId) } : null,
      after: { name: data.name, active: data.active, rules: data.rules, userIds: uniqueIds }
    });
  });
  revalidatePath("/admin/approval-permissions"); revalidatePath("/admin/users"); revalidatePath("/approvals");
}
const purposeSchema = z.object({ id: z.string().cuid().optional(), name: z.string().trim().min(1).max(60), description: z.string().trim().max(300), active: z.boolean(), allowedSealTypes: z.array(z.nativeEnum(SealType)).min(1).max(5) });
export async function saveSealPurpose(input: z.infer<typeof purposeSchema>) {
  const data = purposeSchema.parse(input);
  await approvalTransaction(async db => {
    const actorId = await admin(db);
    const { id, ...values } = data;
    const before = id ? await db.sealPurposeConfig.findUniqueOrThrow({ where: { id } }) : null;
    const row = id ? await db.sealPurposeConfig.update({ where: { id }, data: values }) : await db.sealPurposeConfig.create({ data: values });
    await approvalAudit(db, actorId, "SEAL_PURPOSE_SAVE", row.id, { before: before ? { name: before.name, active: before.active, allowedSealTypes: before.allowedSealTypes } : null, after: values });
  });
  revalidatePath("/admin/approval-permissions"); revalidatePath("/approvals/seals");
}
export async function saveApprovalSettings(input: { allowSelfApproval: boolean }) {
  const data = z.object({ allowSelfApproval: z.boolean() }).parse(input);
  await approvalTransaction(async db => {
    const actorId = await admin(db);
    const before = await approvalSettings(db);
    await db.systemSetting.upsert({ where: { key: APPROVAL_SETTING_KEY }, create: { key: APPROVAL_SETTING_KEY, value: data }, update: { value: data } });
    await approvalAudit(db, actorId, "APPROVAL_AUTHORIZATION_SETTINGS", APPROVAL_SETTING_KEY, { before, after: data });
  });
  revalidatePath("/", "layout");
}
export async function listActiveSealPurposes() {
  await requireSession("approval");
  return prisma.sealPurposeConfig.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, allowedSealTypes: true } });
}
