import type { ApprovalAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APPROVAL_EVENTS, approvalTargetType, canonicalApprovalAction } from "./workspace";

/** 仅授权实际处理过的申请所关联的原附件，不传播到其他案件材料。 */
export async function hasHandledApproval(userId: string, action: ApprovalAction, id: string, documentId?: string) {
  const canonical = canonicalApprovalAction(action);
  const actions = Object.entries(APPROVAL_EVENTS).filter(([, event]) => event.action === canonical && event.decision).map(([key]) => key);
  // 只有明确记录的当次附件 ID 才能扩大历史读取；不能用文件创建时间猜测关联时间。
  const handled = await prisma.auditLog.findFirst({ where: { userId, targetId: id, targetType: approvalTargetType(canonical), action: { in: actions }, ...(documentId ? { detail: { path: ["attachmentIds"], array_contains: [documentId] } } : {}) }, select: { id: true } });
  if (handled) return true;
  if (canonical !== "SEAL_APPROVE" || !documentId) return false;
  return !!await prisma.auditLog.findFirst({ where: { targetId: id, targetType: "SealRequest", action: "SEAL_LEGACY_CLASSIFY", AND: [{ detail: { path: ["previousApproval", "userId"], equals: userId } }, { detail: { path: ["previousApproval", "attachmentIds"], array_contains: [documentId] } }] }, select: { id: true } });
}
