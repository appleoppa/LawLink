import type { ApprovalAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canApproveItem, canExecuteInvoice } from "@/lib/approvals/service";
import { APPROVAL_EVENTS, approvalTargetType, canonicalApprovalAction, type ApprovalHistoryEntry, type ApprovalWorkspaceRow } from "@/lib/approvals/workspace";
import { isSystemAdmin } from "@/lib/auth/system-role";

export type ApprovalRecord = Omit<ApprovalWorkspaceRow, "task"> & {
  requesterId: string | null; intakeOwnerId?: string | null; history: ApprovalHistoryEntry[]; participantIds: string[];
};

// 只在服务端加载最小业务索引，详情和附件在对象级授权后另行读取。
export async function loadApprovalRecords(filter?: { action: ApprovalAction; id: string }) {
  const action = filter ? canonicalApprovalAction(filter.action) : null;
  const whereId = filter ? { id: filter.id } : {};
  const [intakes, documents, archives, invoices, seals, logs] = await Promise.all([
    !action || action === "INTAKE_APPROVE" ? prisma.intake.findMany({ where: { ...whereId, status: { not: "INTAKE" } }, select: { id: true, title: true, status: true, receivedAt: true, ownerUserId: true, createdById: true, createdBy: { select: { name: true } }, matter: { select: { title: true } } } }) : [],
    !action || action === "DOCUMENT_APPROVE" ? prisma.document.findMany({ where: { ...whereId, deletedAt: null }, select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, uploadedById: true, uploadedBy: { select: { name: true } }, approvedById: true, approvedBy: { select: { name: true } }, approvedAt: true, reviewedById: true, reviewedBy: { select: { name: true } }, reviewedAt: true, matter: { select: { title: true } } } }) : [],
    !action || action === "ARCHIVE_APPROVE" ? prisma.archiveRecord.findMany({ where: whereId, select: { id: true, archiveNo: true, status: true, archivedAt: true, archivedBy: true, archivedById: true, reviewedById: true, reviewedAt: true, reviewNote: true, matter: { select: { title: true } } } }) : [],
    !action || action === "INVOICE_APPROVE" ? prisma.invoiceRequest.findMany({ where: whereId, select: { id: true, buyerName: true, title: true, amount: true, status: true, requestedAt: true, requestedById: true, requestedBy: { select: { name: true } }, processedById: true, processedBy: { select: { name: true } }, processedAt: true, processNote: true, matter: { select: { title: true } } } }) : [],
    !action || action === "SEAL_APPROVE" ? prisma.sealRequest.findMany({ where: whereId, select: { id: true, documentTitle: true, status: true, requestedAt: true, requestedById: true, requestedBy: { select: { name: true } }, approvedById: true, approvedBy: { select: { name: true } }, approvedAt: true, approveNote: true, stampedById: true, stampedByUser: { select: { name: true } }, stampedAt: true, matter: { select: { title: true } } } }) : [],
    prisma.auditLog.findMany({ where: { action: { in: Object.keys(APPROVAL_EVENTS) }, ...(filter ? { targetId: filter.id, targetType: approvalTargetType(filter.action) } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, action: true, targetId: true, targetType: true, userId: true, user: { select: { name: true } }, createdAt: true, detail: true } })
  ]);
  const historyMap = new Map<string, ApprovalHistoryEntry[]>();
  for (const log of logs) {
    const event = APPROVAL_EVENTS[log.action];
    if (!event || !log.targetId || log.targetType !== approvalTargetType(event.action)) continue;
    const key = `${event.action}:${log.targetId}`;
    const entries = historyMap.get(key) ?? [];
    const detail = log.detail && typeof log.detail === "object" && !Array.isArray(log.detail) ? log.detail : {};
    // 旧收案转化及归档有同一次事务后再次记录的兼容日志。
    const compatibilityDuplicate = log.action === "INTAKE_CONVERT" || (log.action === "ARCHIVE_APPROVE" && typeof detail.archiveNo === "string") || (log.action === "SEAL_STAMPED" && typeof detail.sealType === "string");
    if (compatibilityDuplicate && entries.some(e => e.decision && e.userId === log.userId && e.label === (log.action === "INTAKE_CONVERT" ? "审批通过" : event.label) && Math.abs(log.createdAt.getTime() - e.at.getTime()) < 5000)) continue;
    const previous = detail.previousApproval;
    if (log.action === "SEAL_LEGACY_CLASSIFY" && previous && typeof previous === "object" && !Array.isArray(previous) && typeof previous.userId === "string" && typeof previous.at === "string") {
      const at = new Date(previous.at);
      if (Number.isFinite(at.getTime()) && !entries.some(e => e.userId === previous.userId && e.decision && Math.abs(e.at.getTime() - at.getTime()) < 5000)) entries.push({ id: log.id + "-previous", label: "审批通过", userId: previous.userId, userName: typeof previous.userName === "string" ? previous.userName : "历史账号", at, note: typeof previous.note === "string" ? previous.note : null, decision: true, legacy: true });
    }
    const note = [detail.note, detail.reason, detail.processNote].find(v => typeof v === "string" && v.trim());
    entries.push({ id: log.id, label: event.label, userId: log.userId, userName: log.user?.name ?? "历史账号", at: log.createdAt, note: typeof note === "string" ? note : null, decision: event.decision });
    historyMap.set(key, entries);
  }
  const rows: ApprovalRecord[] = [];
  const reviewerIds = [...new Set(archives.flatMap(r => r.reviewedById ? [r.reviewedById] : []))];
  const reviewers = reviewerIds.length ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } }) : [];
  const reviewerNames = new Map(reviewers.map(r => [r.id, r.name]));
  function add(row: Omit<ApprovalRecord, "history" | "participantIds" | "processedAt" | "processor">, fallback: ApprovalHistoryEntry[] = []) {
    const history = [...(historyMap.get(`${row.action}:${row.id}`) ?? [])];
    for (const entry of fallback) {
      const recorded = history.find(e => e.decision && e.label === entry.label && e.userId === entry.userId && Math.abs(e.at.getTime() - entry.at.getTime()) < 5000);
      if (!recorded) history.push(entry);
      else if (!recorded.note && entry.note) recorded.note = entry.note;
    }
    history.sort((a, b) => a.at.getTime() - b.at.getTime());
    const decisions = history.filter(e => e.decision);
    const last = decisions.at(-1);
    rows.push({ ...row, history, participantIds: decisions.flatMap(e => e.userId ? [e.userId] : []), processedAt: last?.at ?? null, processor: last?.userName ?? null });
  }
  function fallback(id: string, label: string, userId: string | null, at: Date | null, userName?: string | null, note?: string | null): ApprovalHistoryEntry[] {
    return userId && at ? [{ id: `legacy-${id}-${label}`, label, userId, userName: userName ?? "历史处理人（姓名未记录）", at, note: note ?? null, decision: true, legacy: true }] : [];
  }
  for (const r of intakes) add({ id: r.id, action: "INTAKE_APPROVE", title: r.title, status: r.status === "PENDING_CONFIRMATION" ? "PENDING" : r.status, submittedAt: r.receivedAt, intakeOwnerId: r.ownerUserId, requesterId: r.createdById, requester: r.createdBy.name, matter: r.matter?.title ?? r.title });
  for (const r of documents) {
    const history = historyMap.get(`DOCUMENT_APPROVE:${r.id}`) ?? [];
    if (r.status !== "PENDING_REVIEW" && !r.approvedAt && !r.reviewedAt && !history.length) continue;
    add({ id: r.id, action: "DOCUMENT_APPROVE", title: r.name, status: r.status === "PENDING_REVIEW" ? "PENDING" : r.status, submittedAt: history.find(e => e.label === "提交审核")?.at ?? r.createdAt, requesterId: r.uploadedById, requester: r.uploadedBy.name, matter: r.matter?.title ?? "非案件事项" }, [...fallback(r.id, "审批通过", r.approvedById, r.approvedAt, r.approvedBy?.name), ...fallback(r.id, "驳回修改", r.reviewedById, r.reviewedAt, r.reviewedBy?.name)]);
  }
  for (const r of archives) add({ id: r.id, action: "ARCHIVE_APPROVE", title: `${r.matter.title} · ${r.archiveNo}`, status: r.status === "PENDING_REVIEW" ? "PENDING" : r.status === "APPROVED" ? "FILED" : r.status, submittedAt: r.archivedAt, requesterId: r.archivedById, requester: r.archivedBy, matter: r.matter.title }, fallback(r.id, r.status === "REJECTED" ? "驳回归档" : "审批通过并归档", r.reviewedById, r.reviewedAt, r.reviewedById ? reviewerNames.get(r.reviewedById) : null, r.reviewNote));
  for (const r of invoices) add({ id: r.id, action: "INVOICE_APPROVE", title: [r.title ?? "开票申请", `¥${Number(r.amount).toLocaleString("zh-CN")}`, r.buyerName ? `抬头 ${r.buyerName}` : null].filter(Boolean).join(" · "), status: r.status === "APPROVED" ? "WAITING_INVOICE" : r.status, submittedAt: r.requestedAt, requesterId: r.requestedById, requester: r.requestedBy.name, matter: r.matter?.title ?? "非案件事项" }, fallback(r.id, r.status === "ISSUED" ? "完成开票" : r.status === "REJECTED" ? "驳回开票" : "审批通过", r.processedById, r.processedAt, r.processedBy?.name, r.processNote));
  for (const r of seals) add({ id: r.id, action: "SEAL_APPROVE", title: r.documentTitle, status: r.status === "APPROVED" ? "WAITING_STAMP" : r.status, submittedAt: r.requestedAt, requesterId: r.requestedById, requester: r.requestedBy.name, matter: r.matter?.title ?? "非案件事项" }, [...fallback(r.id, r.status === "REJECTED" ? "驳回用章" : "审批通过", r.approvedById, r.approvedAt, r.approvedBy?.name, r.approveNote), ...fallback(r.id, "完成盖章回填", r.stampedById, r.stampedAt, r.stampedByUser?.name)]);
  return rows;
}

export async function approvalRecordAccess(user: { id: string; role: string; systemRole: string }, row: ApprovalRecord) {
  let task: ApprovalWorkspaceRow["task"] = null;
  if (row.status === "PENDING" && await canApproveItem(user.id, row.action, row.id)) task = "approve";
  if (row.status === "WAITING_INVOICE" && await canExecuteInvoice(user.id, row.id)) task = "issue";
  if (row.status === "WAITING_STAMP" && await canApproveItem(user.id, "SEAL_STAMP", row.id)) task = "stamp";
  return { task, readable: isSystemAdmin(user) || row.requesterId === user.id || row.intakeOwnerId === user.id || row.participantIds.includes(user.id) || task !== null };
}

export async function requireApprovalRecord(user: { id: string; role: string; systemRole: string }, input: { action: ApprovalAction; id: string }) {
  const row = (await loadApprovalRecords(input))[0];
  if (!row) throw new Error("审批申请不存在或不可查看");
  const access = await approvalRecordAccess(user, row);
  if (!access.readable) throw new Error("审批申请不存在或不可查看");
  return { row, ...access };
}
