"use server";
import {closureReady} from "@/server/archive/closure";
import { ApprovalAction } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canReadDocument } from "@/lib/approvals/documents";
import { APPROVAL_STATUS_LABELS, canonicalApprovalAction, type ApprovalWorkspaceRow } from "@/lib/approvals/workspace";
import { loadApprovalRecords, approvalRecordAccess, requireApprovalRecord } from "./records";
import { loadIntakeApprovalDetail } from "./intake-detail";
import { audit } from "@/server/audit";
import { archiveHasExceptions, parseArchiveSnapshot, requiredArchiveVerificationIds } from "@/lib/archive/snapshot";
import { isSystemAdmin } from "@/lib/auth/system-role";
const workspaceQuery = z.object({
  tab: z.enum(["pending", "processed", "mine", "all"]).catch("pending").default("pending"),
  type: z.nativeEnum(ApprovalAction).optional().catch(undefined),
  status: z.string().max(40).optional(), q: z.string().max(200).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1)
});
export async function listApprovalWorkspace(input: Record<string, unknown> = {}) {
  const session = await requireSession("approval");
  const query = workspaceQuery.parse(input);
  const canViewAll = isSystemAdmin(session.user);
  if (query.tab === "all" && !canViewAll) throw new Error("仅管理员可查看全部审批记录");
  const records = await loadApprovalRecords();
  const accessible = await Promise.all(records.map(async row => ({ row, ...await approvalRecordAccess(session.user, row) })));
  const visible = accessible.filter(r => r.readable).map(item => {
    if (query.tab !== "processed") return item;
    const own = item.row.history.filter(h => h.decision && h.userId === session.user.id).at(-1);
    return own ? { ...item, row: { ...item.row, processedAt: own.at, processor: own.userName } } : item;
  });
  const counts = {
    pending: visible.filter(r => r.task).length,
    processed: visible.filter(r => r.row.participantIds.includes(session.user.id)).length,
    mine: visible.filter(r => r.row.requesterId === session.user.id).length,
    all: canViewAll ? visible.length : 0
  };
  const rows = visible.filter(({ row, task }) => {
    if (query.tab === "pending" && !task) return false;
    if (query.tab === "processed" && !row.participantIds.includes(session.user.id)) return false;
    if (query.tab === "mine" && row.requesterId !== session.user.id) return false;
    if (query.type && row.action !== canonicalApprovalAction(query.type)) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.q && !`${row.title} ${row.requester} ${row.matter}`.toLocaleLowerCase().includes(query.q.trim().toLocaleLowerCase())) return false;
    const date = query.tab === "processed" ? row.processedAt ?? row.submittedAt : row.submittedAt;
    const day = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    return (!query.start || day >= query.start) && (!query.end || day <= query.end);
  }).sort((a, b) => {
    if (query.tab === "pending") return a.row.submittedAt.getTime() - b.row.submittedAt.getTime();
    return (query.tab === "processed" ? b.row.processedAt?.getTime() ?? 0 : b.row.submittedAt.getTime()) - (query.tab === "processed" ? a.row.processedAt?.getTime() ?? 0 : a.row.submittedAt.getTime());
  });
  const pageSize = 20;
  const page = Math.min(query.page, Math.max(1, Math.ceil(rows.length / pageSize)));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(({ row, task }): ApprovalWorkspaceRow => ({ id: row.id, action: row.action, title: row.title, requester: row.requester, matter: row.matter, status: row.status, submittedAt: row.submittedAt, processedAt: row.processedAt, processor: row.processor, task })), counts, canViewAll, total: rows.length, page, pageSize, query };
}
export async function getApprovalDetail(input: { action: ApprovalAction; id: string }) {
  const parsed = z.object({ action: z.nativeEnum(ApprovalAction), id: z.string().cuid() }).parse(input);
  const { id } = parsed;
  const action = canonicalApprovalAction(parsed.action);
  const session = await requireSession("approval");
  const { row, task } = await requireApprovalRecord(session.user, { action, id });
  const fields: { label: string; value: string }[] = [];
  let intakeDetail: Awaited<ReturnType<typeof loadIntakeApprovalDetail>> | null = null;
  let attachments: { id: string; name: string }[] = [];
  let sealType: string | null = null;
  let archiveReview: {
    legacy: boolean;
    policy: { name: string; version: string; effectiveAt: string; sourceFileId: string; sourceFileName: string } | null;
    items: { id: string; label: string; required: boolean; status: string; note: string; documentIds: string[] }[];
    documents: { id: string; name: string; folderName: string | null; mimeType: string | null; size: number; sha256: string; workflowStatus: string; version: number; isLatest: boolean; order: number }[];
    excludedDocuments: { id: string; name: string; folderName: string | null; size: number | null }[];
    manualChecks: { id: string; label: string; confirmed: boolean; note: string }[];
    verificationIds: string[];
    hasExceptions: boolean;
  } | null = null;
  function field(label: string, value: unknown) { if (value != null && value !== "") fields.push({ label, value: value instanceof Date ? value.toLocaleDateString("zh-CN") : String(value) }); }
  if (action === "INTAKE_APPROVE") {
    intakeDetail = await loadIntakeApprovalDetail(id);
    if(!task&&!isSystemAdmin(session.user)&&row.requesterId!==session.user.id&&row.intakeOwnerId!==session.user.id){
      const lastOwn=row.history.filter(h=>h.decision&&h.userId===session.user.id).at(-1)?.at;
      const rounds=lastOwn&&intakeDetail.rounds.length?await prisma.$queryRaw<{round:number}[]>`SELECT round FROM "IntakeRevision" WHERE "intakeId"=${id} AND "submittedAt"<=${lastOwn} ORDER BY round DESC`:[];
      const permitted=new Set(rounds.map(r=>r.round));
      intakeDetail={...intakeDetail,sections:[],currentParties:[],checks:[],attachments:[],rounds:intakeDetail.rounds.filter(r=>permitted.has(r.round))};
    }
    field("冲突审查结论", intakeDetail.checks[0]?.conclusion ?? "尚未核查");
    attachments = intakeDetail.attachments;
  } else if (action === "DOCUMENT_APPROVE") {
    const r = await prisma.document.findUniqueOrThrow({ where: { id, deletedAt: null }, select: { id: true, name: true, version: true, uploadedBy: { select: { name: true } }, matter: { select: { title: true } } } });
    field("文书", r.name); field("版本", r.version); field("上传人", r.uploadedBy.name); field("关联案件", r.matter?.title); attachments = [{ id: r.id, name: r.name }];
  } else if (action === "ARCHIVE_APPROVE") {
    const r = await prisma.archiveRecord.findUniqueOrThrow({ where: { id }, include: { matter: { select: { title: true } } } });
    field("案件名称", r.matter.title); field("归档编号", r.archiveNo); field("归档人", r.archivedBy); field("结案总结", r.summary); field("裁判结果", r.judgmentSummary); field("缺失材料", r.missingItems.join("、") || "无"); field("完成时间", r.completedAt);
    if(await closureReady(prisma)){
      const [w]=await prisma.$queryRaw<{parentNo:string|null;workflowSnapshot:{plan:{reason:string;financeOwnerId:string|null;serviceCompletedAt:string};facts:{finance:{outstanding:string;unallocated:string;commissionBalance:string}}}|null}[]>`SELECT a."workflowSnapshot",p."archiveNo" AS "parentNo" FROM "ArchiveRecord" a LEFT JOIN "ArchiveRecord" p ON p.id=a."supplementOfId" WHERE a.id=${id}`;
      if(w?.parentNo)field('补充归档对应原卷宗',w.parentNo);
      if(w?.workflowSnapshot){const snap=w.workflowSnapshot;field('服务完成与收尾说明',snap.plan.reason);field('财务未结应收',snap.facts.finance.outstanding);field('未分配收款',snap.facts.finance.unallocated);field('未结分成',snap.facts.finance.commissionBalance);const owner=snap.plan.financeOwnerId?await prisma.user.findUnique({where:{id:snap.plan.financeOwnerId},select:{name:true}}):null;field('指定财务收尾负责人',owner?.name??'无未结财务');}
    }
    const snapshot = parseArchiveSnapshot(r.checklistJson);
    if (snapshot) {
      field("制度依据", `${snapshot.policy.name}（${snapshot.policy.version}）`);
      field("送审材料", `${snapshot.documents.length} 份`);
      field("材料快照", "已固定文件名称、大小和内容校验值");
      attachments = snapshot.documents.map((document) => ({ id: document.id, name: document.name }));
      archiveReview = {
        legacy: false,
        policy: {
          name: snapshot.policy.name,
          version: snapshot.policy.version,
          effectiveAt: snapshot.policy.effectiveAt,
          sourceFileId: snapshot.policy.sourceFileId,
          sourceFileName: snapshot.policy.sourceFileName
        },
        items: snapshot.checklist.items.map((item) => ({ id: item.id, label: item.label, required: item.required, status: item.status, note: item.note, documentIds: item.documentIds })),
        documents: snapshot.documents.map((document) => ({ id: document.id, name: document.name, folderName: document.folderName, mimeType: document.mimeType, size: document.size, sha256: document.sha256, workflowStatus: document.workflowStatus, version: document.version, isLatest: document.isLatest, order: document.order })),
        excludedDocuments: snapshot.excludedDocuments,
        manualChecks: snapshot.manualChecks,
        verificationIds: requiredArchiveVerificationIds(snapshot),
        hasExceptions: archiveHasExceptions(snapshot)
      };
    } else {
      field("材料快照", "历史申请未固定实际送审材料，不能据此认定齐全");
      attachments = await prisma.document.findMany({ where: { id: { in: [r.coverDocId, r.catalogDocId].filter((d): d is string => !!d) }, deletedAt: null }, select: { id: true, name: true } });
      archiveReview = { legacy: true, policy: null, items: [], documents: [], excludedDocuments: [], manualChecks: [], verificationIds: [], hasExceptions: true };
    }
  } else if (action === "INVOICE_APPROVE") {
    const r = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id }, include: { requestedBy: { select: { name: true } }, matter: { select: { title: true } } } });
    field("开票抬头", r.buyerName ?? r.title); field("金额（元）", r.amount); field("申请人", r.requestedBy.name); field("关联案件", r.matter?.title ?? "非案件事项"); field("无案件原因", r.noMatterReason); field("类型", r.invoiceType === "SPECIAL" ? "增值税专用发票" : "普通发票"); field("税号", r.buyerTaxNo); field("购方地址", r.buyerAddress); field("购方电话", r.buyerPhone); field("开户行", r.buyerBank); field("账号", r.buyerBankAccount); field("申请说明", r.requestNote); field("发票号码", r.invoiceNo); field("开票时间", r.issuedAt);
    attachments = await prisma.document.findMany({ where: { id: { in: [...r.evidenceDocIds, ...[r.contractScanId, r.invoiceFileId].filter((d): d is string => !!d)] }, deletedAt: null }, select: { id: true, name: true } });
  } else {
    const r = await prisma.sealRequest.findUniqueOrThrow({ where: { id }, include: { requestedBy: { select: { name: true } }, draftDoc: { select: { id: true, name: true } }, stampedDoc: { select: { id: true, name: true } }, matter: { select: { title: true } } } });
    sealType = r.sealType;
    field("申请编号", r.code); field("文件名称", r.documentTitle); field("用章事项", r.purposeLabel ?? "未分类"); field("事由", r.purpose); field("关联案件", r.matter?.title ?? "非案件事项"); field("申请人", r.requestedBy.name); field("份数", r.copies); field("页数", r.pageCount); field("骑缝章", r.requireCrossPageSeal ? "需要" : "不需要"); field("说明", r.requestNote); attachments = [r.draftDoc, ...(r.stampedDoc ? [r.stampedDoc] : [])];
  }
  field("当前状态", APPROVAL_STATUS_LABELS[row.status] ?? "状态待核实");
  const checkedAttachments = await Promise.all(attachments.map(async attachment => {
    const doc = await prisma.document.findUnique({ where: { id: attachment.id }, select: { id: true, uploadedById: true, matterId: true, intakeId: true, deletedAt: true } });
    return { ...attachment, readable: !!doc && await canReadDocument(session.user.id, doc) };
  }));
  await audit({ userId: session.user.id, action: "APPROVAL_REQUEST_VIEW", targetType: "Approval", targetId: id, detail: { action } });
  return { fields, intakeDetail: intakeDetail ? { rounds:intakeDetail.rounds, sections: intakeDetail.sections, currentParties: intakeDetail.currentParties, checks: intakeDetail.checks } : null, attachments: checkedAttachments, archiveReview, history: row.history, task, status: row.status, title: row.title, requester: row.requester, submittedAt: row.submittedAt, sealType, canResubmit: ((row.action === "INTAKE_APPROVE" && row.status === "NEEDS_REVISION") || (row.action === "DOCUMENT_APPROVE" && row.status === "DRAFT")) && (row.requesterId === session.user.id || row.intakeOwnerId === session.user.id), canCancel: row.action === "SEAL_APPROVE" && row.status === "PENDING" && row.requesterId === session.user.id };
}
