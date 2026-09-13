import { scopeFor } from "@/lib/roles/catalog";
import { matterAssociationFilter } from "@/lib/permissions";
import { Prisma, type ApprovalAction } from "@prisma/client";
import { resolveRoleUser } from "@/lib/roles/service";
import { prisma } from "@/lib/prisma";
import { matchesApprovalRule, mayApproveSelf, type ApprovalContext } from "./rules";
export type ApprovalDb = Prisma.TransactionClient;
export const APPROVAL_SETTING_KEY = "approvalAuthorization";
export async function approvalSettings(db: ApprovalDb = prisma) {
  const setting = await db.systemSetting.findUnique({ where: { key: APPROVAL_SETTING_KEY } });
  const value = setting?.value as { enabled?: boolean; allowSelfApproval?: boolean } | null;
  // enabled 是只读策略状态；历史配置不能恢复角色审批。
  return { enabled: true as const, allowSelfApproval: value?.allowSelfApproval === true };
}
export async function canApproveContext(userId: string, context: ApprovalContext, db: ApprovalDb = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active || !(await resolveRoleUser(userId, user.role, db)).enabled) return false;
  const settings = await approvalSettings(db);
  if (context.sealType) {
    const config = await db.sealTypeConfig.findUnique({ where: { type: context.sealType } });
    if (!config?.enabled) return false;
    if (context.action === "SEAL_APPROVE" && (config.requiresLegalRep || context.sealType === "LEGAL_REP_SEAL")) {
      const rep = await db.systemSetting.findUnique({ where: { key: "firmLegalRepUserId" } });
      if ((rep?.value as { value?: string } | null)?.value !== userId) return false;
    }
    const purpose = context.purposeId ? await db.sealPurposeConfig.findUnique({ where: { id: context.purposeId } }) : null;
    if (!purpose?.active || !purpose.allowedSealTypes.includes(context.sealType)) return false;
  }
  if (!mayApproveSelf(userId, context, settings.allowSelfApproval)) return false;
  const rules = await db.approvalPermissionRule.findMany({ where: {
    active: true, action: context.action, group: { active: true, members: { some: { userId, active: true } } }
  } });
  return rules.some(rule => matchesApprovalRule(rule, context));
}
export async function approvalContextFor(action: ApprovalAction, id: string, db: ApprovalDb = prisma): Promise<ApprovalContext> {
  const base = { action, category: null, requesterId: null } as ApprovalContext;
  if (action === "INTAKE_APPROVE") {
    const row = await db.intake.findUniqueOrThrow({ where: { id }, select: { category: true, createdById: true } });
    return { ...base, category: row.category, requesterId: row.createdById };
  }
  if (action === "DOCUMENT_APPROVE") {
    const row = await db.document.findUniqueOrThrow({ where: { id, deletedAt: null }, select: {
      uploadedById: true, matter: { select: { category: true } }, intake: { select: { category: true } }
    } });
    return { ...base, category: row.matter?.category ?? row.intake?.category ?? null, requesterId: row.uploadedById };
  }
  if (action === "ARCHIVE_APPROVE") {
    const row = await db.archiveRecord.findUniqueOrThrow({ where: { id }, select: { archivedById: true, matter: { select: { category: true } } } });
    return { ...base, category: row.matter.category, requesterId: row.archivedById };
  }
  if (action === "INVOICE_APPROVE") {
    const row = await db.invoiceRequest.findUniqueOrThrow({ where: { id }, select: { requestedById: true, matter: { select: { category: true } } } });
    return { ...base, category: row.matter?.category ?? null, requesterId: row.requestedById };
  }
  const row = await db.sealRequest.findUniqueOrThrow({ where: { id }, select: { requestedById: true, sealType: true, purposeConfigId: true, matter: { select: { category: true } } } });
  return { ...base, category: row.matter?.category ?? null, requesterId: row.requestedById, sealType: row.sealType, purposeId: row.purposeConfigId };
}
export async function canApproveItem(userId: string, action: ApprovalAction, id: string, db: ApprovalDb = prisma) {
  return canApproveContext(userId, await approvalContextFor(action, id, db), db);
}
export async function assertApprovalItem(userId: string, action: ApprovalAction, id: string, db: ApprovalDb = prisma) {
  if (!await canApproveItem(userId, action, id, db)) throw new Error("未获授此事项的审批权限，或申请人不能审批本人申请");
}
export async function approvalRecipients(context: ApprovalContext, db: ApprovalDb = prisma) {
  const users = await db.user.findMany({ where: { active: true }, select: { id: true } });
  const checks = await Promise.all(users.map(async user => await canApproveContext(user.id, context, db) ? user.id : null));
  return checks.filter((id): id is string => id !== null);
}
export async function requireApprovalRoute(context: ApprovalContext, db: ApprovalDb = prisma) {
  if (!(await approvalRecipients(context, db)).length) throw new Error("此事项尚无可审批人员，请联系管理员配置审批权限后再提交");
}
export async function approvalTransaction<T>(fn: (db: ApprovalDb) => Promise<T>) {
  try {
    return await prisma.$transaction(async db => {
      // 与授权变更共用事务锁，确保撤权与审批具有明确的提交先后顺序。
      await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
      return fn(db);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2025"].includes(error.code)) {
      throw new Error("权限或申请状态已发生变化，请刷新后重新处理");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new Error("名称已存在，请使用其他名称");
      throw new Error("审批权限或处理结果未能保存，请稍后重试；如持续失败，请联系管理员检查数据库");
    }
    throw error;
  }
}
export async function approvalAudit(db: ApprovalDb, userId: string, action: string, targetId: string, detail: Prisma.InputJsonValue = {}) {
  const targetType = action.startsWith("USER_") ? "User"
    : action.startsWith("INTAKE_") ? "Intake"
    : action.startsWith("DOCUMENT_") ? "Document"
    : action.startsWith("ARCHIVE_") ? "ArchiveRecord"
    : action.startsWith("INVOICE_") ? "InvoiceRequest"
    : action.startsWith("SEAL_PURPOSE_") ? "SealPurposeConfig"
    : action.startsWith("SEAL_") ? "SealRequest"
    : action === "APPROVAL_PERMISSION_GROUP_SAVE" ? "ApprovalPermissionGroup" : "SystemSetting";
  await db.auditLog.create({ data: { userId, action, targetType, targetId, detail } });
}

/** 开票执行独立于审批：自定义岗位仅能执行已批准且在授权范围内的申请。 */
export async function canExecuteInvoice(userId: string, id: string, db: ApprovalDb = prisma) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) return false;
  if (user.role !== "CUSTOM") return canApproveItem(userId, "INVOICE_APPROVE", id, db);
  const access = await resolveRoleUser(userId, user.role, db);
  const scope = access.enabled ? scopeFor(access, "invoices.process") : undefined;
  if (!scope) return false;
  return Boolean(await db.invoiceRequest.count({ where: { id, status: "APPROVED", ...(scope === "ALL" ? {} : { matter: { deletedAt: null, ...matterAssociationFilter(userId) } }) } }));
}
