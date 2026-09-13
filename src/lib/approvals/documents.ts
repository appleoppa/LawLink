import { resolveRoleUser } from "@/lib/roles/service";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { prisma } from "@/lib/prisma";
import { canApproveItem, canExecuteInvoice } from "./service";
import { hasHandledApproval } from "./history-access";
export async function canReadDocument(userId: string, doc: { id: string; uploadedById: string; matterId: string | null; intakeId: string | null; deletedAt?: Date | null }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user?.active || doc.deletedAt) return false;
  const access = await resolveRoleUser(userId, user.role);
  if (!access.enabled) return false;
  const canReadBusiness = hasCustomPermission(access, "documents.download") && hasCustomPermission(access, "matters.read");
  if (user.role === "PRINCIPAL_LAWYER") return true;
  const seal = await prisma.sealRequest.findFirst({ where: { OR: [{ draftDocId: doc.id }, { stampedDocId: doc.id }] }, select: { id: true, requestedById: true, approvedById: true, stampedById: true, status: true } });
  if (seal) {
    return seal.requestedById === userId || seal.approvedById === userId || seal.stampedById === userId
      || (seal.status === "PENDING" && await canApproveItem(userId, "SEAL_APPROVE", seal.id))
      || (seal.status === "APPROVED" && await canApproveItem(userId, "SEAL_STAMP", seal.id))
      || await hasHandledApproval(userId, "SEAL_APPROVE", seal.id, doc.id);
  }
  if (canReadBusiness && doc.uploadedById === userId && (user.role !== "CUSTOM" || (!doc.matterId && !doc.intakeId))) return true;
  if (canReadBusiness && doc.matterId && await prisma.matter.count({ where: { id: doc.matterId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] } })) return true;
  if (doc.intakeId) {
    const intake = await prisma.intake.findUnique({ where: { id: doc.intakeId }, select: { createdById: true, ownerUserId: true, coUserIds: true, status: true } });
    if (intake?.createdById === userId) return true;
    if (canReadBusiness && intake && (intake.createdById === userId || intake.ownerUserId === userId || intake.coUserIds.includes(userId))) return true;
    if (intake?.status === "PENDING_CONFIRMATION" && await canApproveItem(userId, "INTAKE_APPROVE", doc.intakeId)) return true;
    if (await hasHandledApproval(userId, "INTAKE_APPROVE", doc.intakeId, doc.id)) return true;
  }
  const review = await prisma.document.findUnique({ where: { id: doc.id }, select: { status: true, approvedById: true, reviewedById: true } });
  if (doc.uploadedById === userId && review && (review.status !== "DRAFT" || await prisma.auditLog.findFirst({ where: { userId, action: "DOCUMENT_SUBMIT_REVIEW", targetType: "Document", targetId: doc.id }, select: { id: true } }))) return true;
  if (review?.status === "PENDING_REVIEW" && await canApproveItem(userId, "DOCUMENT_APPROVE", doc.id)) return true;
  if (review?.approvedById === userId || review?.reviewedById === userId || await hasHandledApproval(userId, "DOCUMENT_APPROVE", doc.id)) return true;
  const invoices = await prisma.invoiceRequest.findMany({ where: { OR: [{ evidenceDocIds: { has: doc.id } }, { contractScanId: doc.id }, { invoiceFileId: doc.id }] }, select: { id: true, requestedById: true, processedById: true, status: true } });
  for (const invoice of invoices) if (invoice.requestedById === userId || invoice.processedById === userId || ((invoice.status === "PENDING" && await canApproveItem(userId, "INVOICE_APPROVE", invoice.id)) || (invoice.status === "APPROVED" && await canExecuteInvoice(userId, invoice.id))) || await hasHandledApproval(userId, "INVOICE_APPROVE", invoice.id, doc.id)) return true;
  const archives = await prisma.archiveRecord.findMany({
    where: {
      OR: [
        { coverDocId: doc.id },
        { catalogDocId: doc.id },
        { checklistJson: { path: ["documentIds"], array_contains: [doc.id] } }
      ]
    },
    select: { id: true, status: true, archivedById: true, reviewedById: true }
  });
  for (const archive of archives) if (archive.archivedById === userId || archive.reviewedById === userId || (archive.status === "PENDING_REVIEW" && await canApproveItem(userId, "ARCHIVE_APPROVE", archive.id)) || await hasHandledApproval(userId, "ARCHIVE_APPROVE", archive.id, doc.id)) return true;
  return false;
}
