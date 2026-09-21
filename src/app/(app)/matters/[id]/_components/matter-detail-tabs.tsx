"use client";
import Link from "next/link";
import { hasCustomPermission, type RoleGrant } from "@/lib/roles/catalog";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClientType, Prisma } from "@prisma/client";
import { Archive, ChevronLeft, Clock3, FileSignature, Gavel, Pencil, Plus, Upload, X } from "lucide-react";
import { CaseSearchPanel } from "./case-search-panel";
import { DocumentReviewDialog } from "./document-review-dialog";
import { DocActionsContext } from "./doc-actions-context";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { matterStatusTone } from "@/lib/ui/moan-tones";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { ProgressDialog } from "./progress-dialog";
import {
  matterStatusLabel,
  procedureTypeLabel,
  matterCategoryKind,
  matterCategoryLabel
} from "@/lib/enums";
import { cn } from "@/lib/utils";
import { contactRoleLabels } from "./info-panel";
import { MatterArchive, TeamRailCard } from "./matter-archive";
import { FinancePanel } from "./finance-panel";
import { ImportantItemDialog } from "./procedure-content";
import { ProcedureWorkflowPanel } from "./procedure-workflow-panel";
import type { DossierView, WaitingItem, WorkflowApi, WorkflowNote, WorkflowPreservationCase } from "./procedure-workflow-panel";

import { ApprovalsPanel } from "./approvals-panel";
import type { SealContractItem, ExpressItem } from "./info-extras";
import { AddDeadlineDialog, AddHearingDialog, AddProcedureSheet } from "./procedure-forms";
import { deleteProcedure } from "@/server/procedures/actions";
import { useRouter } from "next/navigation";
import { LifecycleActions } from "./lifecycle-actions";
import { AddBillingSheet } from "./finance-forms";
import { EvidenceItemDialog, type EvidenceItemRow } from "./evidence-panel";
import { ArchiveStatusBanner } from "./archive-status-banner";
import { ArchiveWizardDialog } from "./archive-wizard";
import { TeamEditorDialog } from "./team-editor-dialog";
import type { FolderPayload, FolderDocument, TemplateSummary } from "./folder-types";
import type { UserOption as PresUserOption } from "@/app/(app)/preservation/_components/preservation-types";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { shDayKey, shDaysFromToday, shMonthDay, shTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type MatterPayloadBase = Prisma.MatterGetPayload<{
  include: {
    primaryClient: { include: { contacts: { where: { isPrimary: true }; take: 1 } } };
    clientLinks: { include: { client: { select: { id: true; name: true; type: true; idNumber: true } } } };
    owner: { select: { id: true; name: true; role: true } };
    members: { include: { user: { select: { id: true; name: true; role: true } } } };
    cause: true;
    parties: true;
    relatedEntities: true;
    intake: {
      select: {
        counterclaim: true;
        claimDescription: true;
        description: true;
        contactName: true;
        contactPhone: true;
        receivedAt: true;
        feeType: true;
        feeAmount: true;
        feeSchedule: true;
        feeNote: true;
        contingencyTerms: true;
        createdBy: { select: { name: true } };
      };
    };
    linksFrom: {
      include: { relatedMatter: { select: { id: true; internalCode: true; firmCaseNo: true; title: true } } };
    };
    linksTo: {
      include: { matter: { select: { id: true; internalCode: true; firmCaseNo: true; title: true } } };
    };
    procedures: {
      include: {
        deadlines: true;
        hearings: true;
        stages: { include: { tasks: true } };
        procedureParties: { include: { party: true } };
        memos: true;
      };
    };
    timelineEvents: true;
  };
}>;

type MatterPayload = Omit<MatterPayloadBase, "claimAmount" | "members" | "intake"> & {
  intake: (Omit<NonNullable<MatterPayloadBase["intake"]>, "feeAmount"> & { feeAmount: number | null }) | null;
  claimAmount: number | null;
  members: (MatterPayloadBase["members"][number] & { user: MatterPayloadBase["members"][number]["user"] & { roleName?: string } })[];
};

export type FinancePayload = {
  billings: {
    id: string;
    title: string;
    contractAmount: number;
    schedule: string | null;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
    signedAt: Date | null;
    createdAt: Date;
  }[];
  entries: {
    id: string;
    type: "RECEIVABLE" | "RECEIVED" | "REFUND" | "COST" | "COMMISSION";
    amount: number;
    occurredAt: Date;
    billingId: string | null;
    invoiceNo: string | null;
    payerOrPayee: string | null;
    method: string | null;
    note: string | null;
    parentFeeEntryId: string | null;
    beneficiaryUserId: string | null;
    beneficiaryUser: { id: string; name: string } | null;
    parentFeeEntry: { id: string; type: string } | null;
    confirmState: "PENDING" | "CONFIRMED";
    recordedById: string;
  }[];
  plans: {
    id: string;
    userId: string;
    percent: number;
    label: string | null;
    active: boolean;
    user: { id: string; name: string; role: string; roleName?: string; isTeammate?: boolean; active?: boolean };
  }[];
  stats: {
    outstanding: number;
    allocated: number;
    clientFunds: number;
    contractAmount: number;
    receivable: number;
    received: number;
    /** 已登记、待确认到账的实收，不计入已收 */
    pendingReceived: number;
    refund: number;
    cost: number;
    commission: number;
    invoiced: number;
  };
};

type UserOption = { id: string; name: string; role: string; roleName?: string; isTeammate?: boolean; active?: boolean };

export type NotePayload = {
  id: string;
  channel: "PHONE" | "WECHAT" | "EMAIL" | "MEETING" | "COURT" | "OTHER";
  withWhom: string | null;
  occurredAt: Date;
  content: string;
  tags: string[];
  author: { id: string; name: string };
  authorId: string;
  createdAt: Date;
};


export function MatterDetailTabs({
  matter,
  finance,
  userOptions,
  documents,
  folders,
  templates,
  colleagues,
  currentUserRole,
  rolePermissions,
  canAssociateThisMatter,
  canLeadThisMatter,
  canOwnThisMatter,
  sealContracts,
  expresses,
  latestArchive,
  customFieldDefs,
  preservationCases,
  evidenceItems,
  notes,
  reviewNode, responsibilityNode, closureNode, conflictNode,
  capabilities = { aiReview: false, caseSearch: false }
}: {
  matter: MatterPayload;
  finance: FinancePayload;
  userOptions: UserOption[];
  documents: any[];
  folders: FolderPayload[];
  folderDocuments: FolderDocument[];
  templates: TemplateSummary[];
  colleagues: PresUserOption[];
  currentUserRole: string | null;
  rolePermissions?: RoleGrant[];
  canAssociateThisMatter: boolean;
  canLeadThisMatter: boolean;
  canOwnThisMatter: boolean;
  sealContracts: SealContractItem[];
  expresses: ExpressItem[];
  latestArchive: {
    id: string;
    archiveNo: string;
    status: "PENDING_REVIEW" | "REJECTED" | "APPROVED";
    reviewedAt: Date | null;
    reviewNote: string | null;
    archivedBy: string;
    missingItems: string[];
  } | null;
  customFieldDefs: {
    id: string;
    key: string;
    label: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT";
    options: string[];
    required: boolean;
  }[];
  preservationCases: WorkflowPreservationCase[];
  evidenceItems: EvidenceItemRow[];
  notes: WorkflowNote[];
  /** AI 审查总览（服务端渲染节点），归入「信息总览」 */
  reviewNode?: React.ReactNode;
  responsibilityNode?: React.ReactNode;
  closureNode?: React.ReactNode;
  conflictNode?: React.ReactNode;
  /** 外部能力是否已配置：AI 文书审查 / 元典类案检索（未配置不显示入口） */
  capabilities?: { aiReview: boolean; caseSearch: boolean };
}) {
  const allowed = (key: import("@/lib/roles/catalog").PermissionKey) => hasCustomPermission({ role: currentUserRole ?? "", rolePermissions }, key);
  const [selectedProcId, setSelectedProcId] = useState<string | null>(null);
  const [addProcOpen, setAddProcOpen] = useState(false);
  const [matterEditorOpen, setMatterEditorOpen] = useState(false);
  const [view, setView] = useState<DossierView>("archive");
  const [ledgerAdd, setLedgerAdd] = useState<"express" | "hearing" | "deadline" | null>(null);
  const [caseSearchOpen, setCaseSearchOpen] = useState(false);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  // 证据要点挂在材料行上（2026-09-14 证据链并入材料）
  const [evidenceDocId, setEvidenceDocId] = useState<string | null | undefined>(undefined);
  const evidenceByDoc = useMemo(() => {
    const map = new Map<string, EvidenceItemRow[]>();
    for (const item of evidenceItems) if (item.sourceDocumentId) map.set(item.sourceDocumentId, [...(map.get(item.sourceDocumentId) ?? []), item]);
    return map;
  }, [evidenceItems]);
  const canAddEvidence = canAssociateThisMatter && matter.status !== "ARCHIVED";
  const docActions = useMemo(
    () => ({
      ...(capabilities.aiReview && allowed("documents.write") ? { onReview: (id: string) => setReviewDocId(id) } : {}),
      evidenceByDoc,
      unlinkedEvidence: evidenceItems.filter((it) => !it.sourceDocumentId),
      ...(canAddEvidence ? { onAddEvidence: (docId: string | null) => setEvidenceDocId(docId) } : {})
    }),
    [capabilities.aiReview, currentUserRole, rolePermissions, evidenceByDoc, evidenceItems, canAddEvidence] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [progress, setProgress] = useState<{ mode: "record" | "judgment"; stage?: string; stageNames: string[] } | null>(null);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const workflowApi = useRef<WorkflowApi | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function handleDeleteProcedure(id: string) {
    startTransition(async () => {
      try {
        await deleteProcedure(id);
        toast.success("程序已删除");
        router.refresh();
      } catch (err) {
        toast.error("删除失败", { description: actionErrorMessage(err) });
      }
    });
  }

  const engagedProcedures = matter.procedures
    .filter((p) => p.engagement === "ENGAGED")
    .sort((a, b) => a.order - b.order);

  // 默认选中第一个在办程序（若有）
  const currentProcedure: ProcedureItem | null = selectedProcId
    ? engagedProcedures.find((p) => p.id === selectedProcId) ?? null
    : engagedProcedures.find((p) => p.status !== "CONCLUDED") ?? engagedProcedures[0] ?? null;
  const canEditMatterInfo = canLeadThisMatter;
  const canOpenUnifiedEditor =
    canEditMatterInfo ||
    canOwnThisMatter ||
    Boolean(currentProcedure && canAssociateThisMatter);
  const isArchived = matter.status === "ARCHIVED";
  // 已归档案件只读：不再提供添加记录、上传材料与新增程序入口
  const canWriteRecords = canAssociateThisMatter && allowed("schedule.write") && !isArchived;

  // 顶栏主操作 = 添加记录（＋记录 · 沟通）
  useTopbarAction(
    canWriteRecords ? { label: "添加记录", onClick: () => setProgress({ mode: "record", stage: workflowApi.current?.currentStageName ?? undefined, stageNames: workflowApi.current?.stageNames ?? [] }) } : null,
    [canWriteRecords]
  );

  // 当前选中程序的文档
  const procDocs = currentProcedure
    ? documents
        .filter((d) => d.procedureId === currentProcedure.id)
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          mimeType: d.mimeType,
          size: d.size,
          createdAt: d.createdAt,
          sourceParty: d.sourceParty,
          path: d.path,
          tags: d.tags ?? [],
          stageId: d.stageId ?? null,
          sourceOrigin: d.sourceOrigin ?? null,
          ocrStatus: d.ocrStatus ?? null,
          textSource: d.textSource ?? null,
          pageCount: d.pageCount ?? null,
          sha256: d.sha256 ?? null,
          templateId: d.templateId ?? null,
          version: d.version ?? null
        }))
    : [];
  const procedureParties = buildProcedurePartyOptions(matter);
  const customValues =
    matter.customValues &&
    typeof matter.customValues === "object" &&
    !Array.isArray(matter.customValues)
      ? (matter.customValues as Record<string, string>)
      : {};
  const restricted = Boolean((matter as { teamAccessRestricted?: boolean }).teamAccessRestricted);
  const procLabel = (p: ProcedureItem) => p.customLabel ?? procedureTypeLabel[p.type] ?? p.type;

  // 页头「···」菜单只留页面级编辑入口；页签切换（财务/用印）、类案检索、安排开庭与新增程序
  // 均在各自常驻位置有入口，不在此重复（2026-09-20 用户确认收敛）
  const moreItems = [
    ...(canOpenUnifiedEditor ? [{ key: "edit", label: "编辑信息与团队", icon: Pencil, onSelect: () => setMatterEditorOpen(true) }] : [])
  ];

  const archiveBadge = matter.status === "ARCHIVED"
    ? { tone: "bronze", text: "已归档" }
    : latestArchive?.status === "PENDING_REVIEW"
      ? { tone: "bronze", text: "预归档中" }
      : latestArchive?.status === "REJECTED"
        ? { tone: "outline-red", text: "归档被驳回" }
        : null;

  const categoryKind = matterCategoryKind(matter.category);
  const parties = procedureParties;
  const ours = parties.filter((p) => p.role === "CLIENT_PARTY");
  const opposing = parties.filter((p) => p.role === "OPPOSING_PARTY");

  // 案卷头异常标签：当前程序逾期事项、保全临期
  const overdueCount = currentProcedure
    ? currentProcedure.stages.flatMap((s) => (s.status === "HIDDEN" ? [] : s.tasks)).filter((t) => !t.completed && t.dueAt && shDaysFromToday(t.dueAt) < 0).length +
      currentProcedure.deadlines.filter((d) => !d.completed && shDaysFromToday(d.dueAt) < 0).length
    : 0;
  const expiringProps = preservationCases
    .flatMap((c) => c.targets.flatMap((t) => t.properties))
    .filter((p) => (p.status === "ACTIVE" || p.status === "RENEWED") && shDaysFromToday(p.expiryDate) <= 30);
  const nearestExpiry = expiringProps.length ? Math.min(...expiringProps.map((p) => shDaysFromToday(p.expiryDate))) : null;

  const waiting: WaitingItem[] = [
    ...sealContracts
      .filter((s) => s.status === "PENDING")
      .map((s) => ({ key: `seal-${s.id}`, title: `用印申请 · ${s.documentTitle}`, meta: `${s.code} · ${formatMonthDay(s.createdAt)} 提交`, onOpen: () => setView("seal") })),
    ...(latestArchive?.status === "PENDING_REVIEW" ? [{ key: "archive", title: `归档申请 · ${latestArchive.archiveNo}`, meta: `提交人 ${latestArchive.archivedBy} · 等待归档审核` }] : [])
  ];
  const money = (n: number | null | undefined) => (n != null && n > 0 ? `¥${n.toLocaleString("zh-CN")}` : null);

  return (
    <DocActionsContext.Provider value={docActions}>
    <div className="mo-matter mo-dossier">
      {/* ① 案卷头 */}
      <section className="card dos-head" aria-label="案卷头">
        <div className="dos-head-top">
          <div className="min-w-0 flex-1">
            <div className="dos-eyebrow">
              <Link href="/matters" className="ctx-back no-underline">
                <ChevronLeft className="h-3.5 w-3.5" />
                案件列表
              </Link>
              <span className="code">{matter.internalCode}</span>
              {matter.firmCaseNo ? <span className="code">所内 {matter.firmCaseNo}</span> : null}
              <span>{[matterCategoryLabel[matter.category], matter.cause?.name ?? matter.causeFreeText].filter(Boolean).join(" · ")}</span>
            </div>
            <h1 className="ctx-title dos-title">{matter.title}</h1>
            <div className="dos-sides">
              {categoryKind === "litigation" ? (
                <>
                  <span className="k">委托方</span>
                  <span className="v">{ours.map((p) => p.name).join("、") || matter.primaryClient?.name || "—"}</span>
                  <span className="k">{matter.category === "CRIMINAL" ? "办案机关" : "对方"}</span>
                  <span className="v">{matter.category === "CRIMINAL" ? currentProcedure?.handlingAgency || "—" : opposing.map((p) => p.name).join("、") || "—"}</span>
                </>
              ) : (
                <>
                  <span className="k">委托人</span>
                  <span className="v">{matter.primaryClient?.name ?? matter.clientLinks[0]?.client.name ?? "—"}</span>
                  <span className="k">{categoryKind === "counsel" ? "顾问期限" : "服务期间"}</span>
                  <span className="v mono">{[matter.serviceStart ? formatShortDate(matter.serviceStart) : null, matter.serviceEnd ? formatShortDate(matter.serviceEnd) : null].filter(Boolean).join(" — ") || "—"}</span>
                </>
              )}
            </div>
            <div className="ctx-badges">
              {isArchived && archiveBadge ? null : (
                <span className={cn("badge", `b-${matterStatusTone(matter.status)}`)}>
                  <span className="bdot" />
                  {matterStatusLabel[matter.status]}
                </span>
              )}
              {overdueCount > 0 ? <span className="badge b-red"><span className="bdot" />{overdueCount} 项逾期</span> : null}
              {nearestExpiry !== null ? <span className="badge b-bronze">保全 {nearestExpiry < 0 ? "已过期" : `${nearestExpiry} 天后到期`}</span> : null}
              {money(matter.claimAmount) ? <span className="badge b-white">{categoryKind === "litigation" ? "标的" : "金额"} <span className="mono">{money(matter.claimAmount)}</span></span> : null}
              {allowed("finance.read") && money(finance.stats.contractAmount) ? <span className="badge b-white">合同额 <span className="mono">{money(finance.stats.contractAmount)}</span></span> : null}
              {matter.intakeDate ? <span className="badge b-white">收案 <span className="mono">{formatShortDate(matter.intakeDate)}</span></span> : null}
              {archiveBadge ? (
                <span className={cn("badge", `b-${archiveBadge.tone}`)}>
                  <Archive className="h-3 w-3" />
                  {archiveBadge.text}
                </span>
              ) : null}
              {restricted ? <span className="badge b-slate" title="受限事项不进入团队汇总视图">受限事项</span> : null}
            </div>
          </div>
          <div className="ctx-actions">
            {canAssociateThisMatter && allowed("documents.write") && currentProcedure && !isArchived ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => workflowApi.current?.openUpload()}>
                <Upload />
                上传材料
              </button>
            ) : null}
            <LifecycleActions
              matterId={matter.id}
              status={matter.status}
              canArchive={canLeadThisMatter && allowed("archive.submit")}
              canChangeStatus={Boolean(currentUserRole && canLeadThisMatter)}
              canExportBundle={currentUserRole !== "FINANCE" && allowed("matters.export") && allowed("matters.read") && allowed("finance.read") && allowed("documents.download")}
              extraItems={moreItems}
            />
          </div>
        </div>
      </section>

      {/* 吸顶摘要：标题滚出视野后常驻案件身份与下一节点 */}
      <MatterStickyBar title={matter.title} caseNumber={currentProcedure?.caseNumber ?? null} procedures={engagedProcedures} />

      {/* ② 程序栏：每个程序一张卡片，点击切换，全页共用 */}
      <section className="dos-procs" aria-label="程序">
        <div className="dos-procs-h">
          <span className="t">程序</span>
        </div>
        <div className="dos-procs-list" role="tablist">
          {engagedProcedures.map((procedure) => {
            const active = currentProcedure?.id === procedure.id;
            const label = procLabel(procedure);
            const labels = contactRoleLabels(procedure.type);
            return (
              <div key={procedure.id} className={cn("dos-proc", active && "on")}>
                <button type="button" role="tab" aria-selected={active} className="dos-proc-main" onClick={() => setSelectedProcId(procedure.id)}>
                  <span className="top">
                    <span className="nm">{label}</span>
                    <span className={cn("badge", procedure.status === "CONCLUDED" ? "b-slate" : procedure.status === "IN_PROGRESS" ? "b-teal" : "b-white")} style={{ fontSize: 10 }}>
                      {PROC_STATUS_LABEL[procedure.status] ?? procedure.status}
                    </span>
                  </span>
                  {categoryKind === "litigation" ? (
                    <>
                      <span className="no">{procedure.caseNumber || "案号未登记"}</span>
                      <span className="ag">
                        {[procedure.handlingAgency, procedure.presidingJudge ? `${labels.lead} ${procedure.presidingJudge}` : null].filter(Boolean).join(" · ") || "受理机构未登记"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="ag">{procedure.stages.filter((st) => st.status !== "HIDDEN").length} 个环节 · 已完成 {procedure.stages.filter((st) => st.status !== "HIDDEN" && st.completedAt).length}</span>
                      <span className="ag">{procedure.acceptedAt ? `开始 ${formatShortDate(procedure.acceptedAt)}` : "\u00a0"}</span>
                    </>
                  )}
                </button>
                {canLeadThisMatter ? (
                  <button
                    type="button"
                    className="dos-proc-del"
                    title="删除此程序"
                    aria-label={`删除程序 ${label}`}
                    onClick={async () => {
                      if (await confirmDialog({ title: `删除程序「${label}」？`, description: deleteProcedureWarning(procedure, label).replace(/^确定删除程序「[^」]*」？\s*/, ""), confirmText: "删除程序", danger: true })) handleDeleteProcedure(procedure.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
          {canAssociateThisMatter && !isArchived ? (
            <button type="button" className="dos-proc add" onClick={() => setAddProcOpen(true)}>
              <Plus className="h-4 w-4" />
              <span>新增程序</span>
              <span className="t-xs t-mute">二审、执行、保全等</span>
            </button>
          ) : null}
          {engagedProcedures.length === 0 && !(canAssociateThisMatter && !isArchived) ? <span className="t-xs t-mute">暂无程序</span> : null}
        </div>
      </section>

      {latestArchive && latestArchive.status !== "APPROVED" ? (
        <div style={{ margin: "14px 0 0" }}>
          <ArchiveStatusBanner
            record={latestArchive}
            onReArchive={latestArchive.status === "REJECTED" && canLeadThisMatter ? () => setArchiveOpen(true) : undefined}
          />
        </div>
      ) : null}

      {/* ③ 页签 */}
      <ProcedureWorkflowPanel
        responsibilityNode={responsibilityNode}
        apiRef={workflowApi}
        matter={{ id: matter.id, internalCode: matter.internalCode, title: matter.title, category: matter.category }}
        procedure={currentProcedure}
        documents={procDocs}
        preservationCases={preservationCases}
        folders={folders}
        templates={templates}
        users={colleagues}
        canManage={canAssociateThisMatter && !isArchived}
        notes={notes}
        timelineEvents={matter.timelineEvents}
        onWriteNote={({ judgment, stageName }) => setProgress({ mode: judgment ? "judgment" : "record", stage: stageName, stageNames: workflowApi.current?.stageNames ?? [] })}
        view={view}
        onViewChange={setView}
        viewCounts={{ seal: sealContracts.filter((sc) => sc.status === "PENDING").length }}
        waiting={waiting}
        archiveNode={<>
          <MatterArchive
            matter={matter}
            currentProcedure={currentProcedure}
            parties={parties}
            billings={finance.billings}
            contractDocs={documents
              .filter((d: { category: string; deletedAt?: Date | null }) => d.category === "CONTRACT")
              .map((d: { id: string; name: string; createdAt: Date; mimeType: string | null }) => ({ id: d.id, name: d.name, createdAt: d.createdAt, mimeType: d.mimeType }))}
            canReadFinance={allowed("finance.read")}
            onOpenFinance={() => setView("money")}
            customFieldDefs={customFieldDefs}
            customValues={customValues}
            canEdit={canOpenUnifiedEditor}
            canEditCustom={canLeadThisMatter}
            canManageRelated={canAssociateThisMatter}
            onEdit={() => setMatterEditorOpen(true)}
          />
          {closureNode}
        </>}
        archiveRailTop={<><TeamRailCard matter={matter} canManage={canOwnThisMatter} onManage={() => setMatterEditorOpen(true)} />{conflictNode}</>}
        expresses={expresses}
        onAddLedger={canAssociateThisMatter && currentProcedure ? (type) => setLedgerAdd(type) : undefined}
        materialsExtra={reviewNode}
        onCaseSearch={capabilities.caseSearch && allowed("matters.write") ? () => setCaseSearchOpen(true) : undefined}
        financeNode={
          <div className="dos-main">
            {allowed("finance.read") ? <Link href={`/finance/reconciliation?matterId=${matter.id}`} className="btn btn-secondary btn-sm w-fit">应收与收款分配</Link> : null}
            {allowed("finance.read") ? <FinanceHero stats={finance.stats} /> : null}
            {allowed("finance.read") ? (
              <BillingsCard
                contractTotal={finance.stats.contractAmount}
                matterId={matter.id}
                billings={finance.billings}
                canManage={canAssociateThisMatter && !isArchived}
              />
            ) : null}
            {allowed("finance.read") ? (
              <FinancePanel matterId={matter.id} finance={finance} userOptions={userOptions} canRequestInvoice={canAssociateThisMatter} hideStats />
            ) : null}
          </div>
        }
        sealNode={
          <ApprovalsPanel matterId={matter.id} matterTitle={matter.title} sealContracts={sealContracts} canRequest={canAssociateThisMatter && allowed("seals.request")} />
        }
      />

      <Sheet open={caseSearchOpen} onOpenChange={setCaseSearchOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[760px]">
          <SheetHeader className="px-5 pt-5">
            <SheetTitle>类案检索 · {matter.title}</SheetTitle>
          </SheetHeader>
          <div className="p-5">
            {caseSearchOpen ? <CaseSearchPanel matterId={matter.id} matterCategory={matter.category} defaultCauseName={matter.cause?.name ?? matter.causeFreeText ?? null} /> : null}
          </div>
        </SheetContent>
      </Sheet>
      {currentProcedure && ledgerAdd ? (
        <ImportantItemDialog
          open={Boolean(ledgerAdd)}
          onOpenChange={(o) => { if (!o) setLedgerAdd(null); }}
          matterId={matter.id}
          defaultType={ledgerAdd}
          types={ledgerAdd === "express" ? ["express"] : ["hearing", "deadline"]}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
          hearingCounts={Object.fromEntries(engagedProcedures.map((p) => [p.id, p.hearings.length]))}
          proceduresDetail={Object.fromEntries(engagedProcedures.map((p) => [p.id, { handlingAgency: p.handlingAgency, panel: p.panel, jurisdiction: p.jurisdiction }]))}
        />
      ) : null}
      {evidenceDocId !== undefined ? (
        <EvidenceItemDialog
          open
          onOpenChange={(o) => { if (!o) setEvidenceDocId(undefined); }}
          matterId={matter.id}
          documents={documents.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))}
          defaultDocumentId={evidenceDocId}
        />
      ) : null}
      <DocumentReviewDialog open={Boolean(reviewDocId)} documentId={reviewDocId} matterId={matter.id} onOpenChange={(o) => { if (!o) setReviewDocId(null); }} />

      {progress ? (
        <ProgressDialog
          open={Boolean(progress)}
          onOpenChange={(o) => !o && setProgress(null)}
          matterId={matter.id}
          initialMode={progress.mode}
          initialStage={progress.stage}
          stageNames={progress.stageNames}
          onAddTask={canAssociateThisMatter && currentProcedure ? () => workflowApi.current?.openAddTask() : undefined}
          onAddDeadline={canAssociateThisMatter && currentProcedure ? () => setDeadlineOpen(true) : undefined}
          onAddHearing={canAssociateThisMatter && currentProcedure ? () => setHearingOpen(true) : undefined}
        />
      ) : null}
      {currentProcedure && deadlineOpen ? (
        <AddDeadlineDialog
          open={deadlineOpen}
          onOpenChange={setDeadlineOpen}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
        />
      ) : null}
      {currentProcedure && hearingOpen ? (
        <AddHearingDialog
          open={hearingOpen}
          onOpenChange={setHearingOpen}
          procedures={engagedProcedures.map((p) => ({ id: p.id, label: procLabel(p) }))}
          defaultProcedureId={currentProcedure.id}
          hearingCounts={Object.fromEntries(engagedProcedures.map((p) => [p.id, p.hearings.length]))}
          proceduresDetail={Object.fromEntries(engagedProcedures.map((p) => [p.id, { handlingAgency: p.handlingAgency, panel: p.panel, jurisdiction: p.jurisdiction }]))}
        />
      ) : null}

      {canAssociateThisMatter && (
        <AddProcedureSheet
          open={addProcOpen}
          onOpenChange={setAddProcOpen}
          matterId={matter.id}
          category={matter.category}
          nextOrder={matter.procedures.length + 1}
          colleagues={colleagues}
          existingTypes={matter.procedures.map(p => p.type)}
        />
      )}
      {canOpenUnifiedEditor && (
        <TeamEditorDialog
          open={matterEditorOpen}
          onOpenChange={setMatterEditorOpen}
          matterId={matter.id}
          matterMeta={{
            intakeDate: matter.intakeDate ?? null,
            category: matter.category,
            title: matter.title,
            causeId: matter.causeId ?? null,
            causeFreeText: matter.causeFreeText ?? null,
            claimAmount:
              matter.claimAmount === null || matter.claimAmount === undefined
                ? null
                : Number(matter.claimAmount),
            ourStanding: matter.ourStanding ?? null,
            teamAccessRestricted: restricted
          }}
          currentProcedure={currentProcedure}
          parties={procedureParties}
          currentOwnerId={matter.ownerId}
          currentMembers={matter.members.map((m) => ({
            userId: m.userId,
            role: m.role,
            name: m.user.name
          }))}
          userOptions={userOptions}
          canEditMatterInfo={canEditMatterInfo}
          canManageTeam={canOwnThisMatter}
          canManageProcedure={Boolean(currentProcedure && canAssociateThisMatter)}
        />
      )}
      {canLeadThisMatter && allowed("archive.submit") && (
        <ArchiveWizardDialog
          matterId={matter.id}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        />
      )}
    </div>
    </DocActionsContext.Provider>
  );
}

type ProcedureItem = MatterPayload["procedures"][number];

/**
 * 删除程序的确认文案。
 *
 * 原文案是「该程序下的所有开庭、期限、备忘和材料记录将被一并删除」——两个问题：
 * 1. 笼统。人对「所有相关记录」会习惯性点确定，对「3 条期限」会停手。
 * 2. 不准确。材料（Document）的外键是 SetNull，只会丢失程序关联，本身不删。
 *
 * 级联硬删的实际范围（schema onDelete: Cascade）：Deadline / Hearing /
 * MatterStage（含其下 Task 的关联）/ ProcedureMemo。
 */
function deleteProcedureWarning(procedure: ProcedureItem, label: string): string {
  const parts: string[] = [];
  if (procedure.deadlines.length > 0) parts.push(`${procedure.deadlines.length} 条期限`);
  if (procedure.hearings.length > 0) parts.push(`${procedure.hearings.length} 场开庭`);
  if (procedure.stages.length > 0) parts.push(`${procedure.stages.length} 个环节`);
  if (procedure.memos.length > 0) parts.push(`${procedure.memos.length} 条备忘`);

  if (parts.length === 0) {
    return `确定删除程序「${label}」？该程序下暂无期限、开庭、环节和备忘记录。`;
  }
  return (
    `确定删除程序「${label}」？\n\n` +
    `该程序下的 ${parts.join("、")} 将被一并删除，此操作不可撤销。\n` +
    `（材料不会被删除，仅解除与本程序的关联。）`
  );
}

const PROC_STATUS_LABEL: Record<string, string> = { PENDING: "未开始", IN_PROGRESS: "进行中", CONCLUDED: "已结" };


/**
 * 合同与补充协议：一案一签（2026-09-16 用户确认取消独立委托模块）。
 * 中途变更收费、增加代理程序＝新增一条补充协议，原合同保留，合同额自动合计。
 */
function BillingsCard({ matterId, billings, canManage, contractTotal }: { matterId: string; billings: FinancePayload["billings"]; canManage: boolean; contractTotal: number }) {
  const [addOpen, setAddOpen] = useState(false);
  const total = contractTotal;
  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <FileSignature className="ic" strokeWidth={1.8} />
          合同与补充协议
          <span className="badge b-white" style={{ marginLeft: 2 }}>{billings.length}</span>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddOpen(true)}>
            <Plus />
            合同 / 补充协议
          </button>
        ) : null}
      </div>
      {billings.length === 0 ? (
        <div className="panel-body t-xs t-mute">尚未登记合同金额</div>
      ) : (
        <>
          {billings.map((b) => (
            <div key={b.id} className="dos-bill row">
              <span className="t">{b.title}</span>
              <span className={cn("badge", b.status === "ACTIVE" ? "b-teal" : b.status === "CLOSED" ? "b-slate" : "b-white")}>
                {b.status === "ACTIVE" ? "执行中" : b.status === "CLOSED" ? "已结束" : "草稿"}
              </span>
              <span className="v mono">¥{Number(b.contractAmount).toLocaleString("zh-CN")}</span>
              <span className="m">{[b.signedAt ? `${formatShortDate(b.signedAt)} 签署` : null, b.schedule].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
          <div className="panel-foot flex items-center justify-between">
            <span className="t-xs t-mute">已签署律师费合同额</span>
            <span className="font-mono text-[14px] font-semibold">¥{total.toLocaleString("zh-CN")}</span>
          </div>
        </>
      )}
      {canManage ? <AddBillingSheet open={addOpen} onOpenChange={setAddOpen} matterId={matterId} /> : null}
    </section>
  );
}

/** 委托与财务：收费概览（大号数字 + 回款进度） */
function FinanceHero({ stats }: { stats: FinancePayload["stats"] }) {
  const outstanding = stats.outstanding;
  const base = stats.receivable;
  const received = base > 0 ? Math.min(100, Math.round((stats.allocated / base) * 100)) : 0;
  const pending = base > 0 ? Math.min(100 - received, Math.round((outstanding / base) * 100)) : 0;
  const money = (n: number) => (n > 0 ? `¥${n.toLocaleString("zh-CN")}` : "—");
  const cells: [string, number, string][] = [
    ["合同额", stats.contractAmount, ""],
    ["已收", stats.received, "green"],
    ["待收", outstanding, "amber"],
    ["已开票", stats.invoiced, "blue"],
    ...(stats.pendingReceived > 0 ? [["待确认实收", stats.pendingReceived, "amber"] as [string, number, string]] : []),
    ...(stats.cost > 0 ? [["支出", stats.cost, "red"] as [string, number, string]] : [])
  ];
  return (
    <section className="card dos-fin-hero" aria-label="收费概览">
      <div className="dos-fin-cells">
        {cells.map(([k, v, tone]) => (
          <div key={k} className={cn("dos-fin-cell", tone)}>
            <span className="k">{k}</span>
            <span className="v">{money(v)}</span>
          </div>
        ))}
      </div>
      {base > 0 ? (
        <div className="dos-fin-bar">
          <div className="track" aria-hidden>
            <i className="got" style={{ width: `${received}%` }} />
            <i className="due" style={{ width: `${pending}%` }} />
          </div>
          <div className="legend">
            <span><b className="dot got" />回款 {received}%</span>
            <span><b className="dot due" />待收 {pending}%</span>
            <span className="t-mute">按有效应收核销计算</span>
          </div>
        </div>
      ) : (
        <p className="t-xs t-mute" style={{ margin: "10px 0 0" }}>尚无有效应收，暂不计算核销进度</p>
      )}
    </section>
  );
}

function nextUncompletedDeadline(procedures: ProcedureItem[]) {
  const all = procedures
    .flatMap((procedure) => procedure.deadlines)
    .filter((deadline) => !deadline.completed)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return all.find((deadline) => daysFromToday(deadline.dueAt) >= 0) ?? all[0] ?? null;
}

function nextUpcomingHearing(procedures: ProcedureItem[]) {
  return (
    procedures
      .flatMap((procedure) => procedure.hearings)
      .filter((hearing) => new Date(hearing.startsAt).getTime() >= Date.now() - 2 * 3600_000)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

function MatterStickyBar({
  title,
  caseNumber,
  procedures
}: {
  title: string;
  caseNumber: string | null;
  procedures: ProcedureItem[];
}) {
  // 标题区自带期限/开庭卡片；摘要条只在标题滚出视野后以 fixed 形式出现，
  // 页首不占位也不重复（sticky 放在零高容器里不会生效，故用 fixed + 测宽）
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setRect({ left: box.left, width: box.width });
    };
    measure();
    window.addEventListener("resize", measure);
    // topbar 高 48px，滚过标题底部（即本容器位置）后出现
    const onScroll = () => {
      setPinned(el.getBoundingClientRect().top < 60);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const deadline = nextUncompletedDeadline(procedures);
  const hearing = nextUpcomingHearing(procedures);
  const days = deadline ? daysFromToday(deadline.dueAt) : null;
  const deadlineTone =
    days === null ? "" : days < 0 || days <= 3 ? "text-[var(--red)]" : days <= 7 ? "text-[var(--amber)]" : "text-[var(--t-muted)]";
  const deadlineText =
    days === null ? "" : days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`;

  return (
    <div ref={wrapRef} className="h-0 w-full" aria-hidden={!pinned}>
      {pinned && rect && (
        <div className="fixed top-[58px] z-10" style={{ left: rect.left, width: rect.width }}>
          <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--bd-hair)] bg-[var(--bg-glass)] px-3 py-1.5 shadow-[var(--sh-hover)] backdrop-blur-xl">
            <span className="min-w-0 truncate text-[13px] font-semibold" title={title}>
              {title}
            </span>
            {caseNumber && (
              <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground tabular md:inline">
                {caseNumber}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
              {deadline ? (
                <span className={cn("inline-flex items-center gap-1", deadlineTone)}>
                  <Clock3 className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{deadline.title}</span>
                  <span className="font-mono tabular">
                    {formatMonthDay(deadline.dueAt)} · {deadlineText}
                  </span>
                </span>
              ) : (
                <span className="hidden text-muted-foreground sm:inline">无未完成期限</span>
              )}
              {hearing && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Gavel className="h-3 w-3" />
                  <span className="font-mono tabular">
                    开庭 {formatMonthDay(hearing.startsAt)}{" "}
                    {shTime(hearing.startsAt)}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function daysFromToday(date: Date) {
  return shDaysFromToday(date);
}

function formatShortDate(date: Date) {
  return shDayKey(date);
}

function formatMonthDay(date: Date) {
  return shMonthDay(date);
}


function clientTypeToPartyType(type: ClientType) {
  if (type === "INDIVIDUAL") return "NATURAL_PERSON";
  if (type === "COMPANY") return "COMPANY";
  return "OTHER_ORG";
}

function buildProcedurePartyOptions(matter: MatterPayload) {
  const parties = [...matter.parties];
  const seenClientNames = new Set(
    parties.filter((party) => party.role === "CLIENT_PARTY").map((party) => party.name.trim())
  );
  const clients = [
    ...(matter.primaryClient ? [matter.primaryClient] : []),
    ...matter.clientLinks.map((link) => link.client)
  ];
  const seenClientIds = new Set<string>();

  for (const client of clients) {
    if (seenClientIds.has(client.id) || seenClientNames.has(client.name.trim())) continue;
    seenClientIds.add(client.id);
    parties.push({
      id: `client:${client.id}`,
      matterId: matter.id,
      intakeId: null,
      role: "CLIENT_PARTY",
      standing: null,
      ordinal: 0,
      name: client.name,
      partyType: clientTypeToPartyType(client.type),
      idType: null,
      idNumber: client.type === "INDIVIDUAL" ? client.idNumber : null,
      phone: null,
      address: null,
      legalRep: null,
      contactName: null,
      enterpriseId: null,
      enterpriseSocialCode: client.type === "INDIVIDUAL" ? null : client.idNumber,
      enterpriseName: client.type === "INDIVIDUAL" ? null : client.name,
      enterpriseBoundAt: null,
      notes: "案件关联客户",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  return parties;
}

export type { MatterPayload, UserOption };
