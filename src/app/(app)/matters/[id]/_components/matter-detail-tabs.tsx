"use client";
import Link from "next/link";
import { hasCustomPermission, type RoleGrant } from "@/lib/roles/catalog";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClientType, Prisma } from "@prisma/client";
import { Archive, ChevronLeft, CircleDollarSign, Clock3, CreditCard, Gavel, Pencil, Plus, Scale, ScrollText, SquareCheck, Stamp, Upload, Users, X } from "lucide-react";
import { CaseSearchPanel } from "./case-search-panel";
import { DocumentReviewDialog } from "./document-review-dialog";
import { DocActionsContext } from "./doc-actions-context";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InitialAvatar } from "@/components/patterns/moan";
import { avatarTone, matterStatusTone } from "@/lib/ui/moan-tones";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { ProgressDialog } from "./progress-dialog";
import {
  matterStatusLabel,
  procedureTypeLabel,
  matterCategoryKind,
  matterCategoryLabel,
  litigationStandingLabel
} from "@/lib/enums";
import { cn } from "@/lib/utils";
import { InfoPanel, contactRoleLabels } from "./info-panel";
import { FinancePanel } from "./finance-panel";
import { ProcedureRemindersAndMemos } from "./procedure-content";
import { ProcedureWorkflowPanel } from "./procedure-workflow-panel";
import type { DossierView, WaitingItem, WorkflowApi, WorkflowNote, WorkflowPreservationCase } from "./procedure-workflow-panel";

import { ApprovalsPanel } from "./approvals-panel";
import type { SealContractItem, ExpressItem } from "./info-extras";
import { AddDeadlineDialog, AddHearingDialog, AddProcedureSheet } from "./procedure-forms";
import { deleteProcedure } from "@/server/procedures/actions";
import { useRouter } from "next/navigation";
import { CustomFieldsPanel } from "./custom-fields-panel";
import { LifecycleActions } from "./lifecycle-actions";
import { EngagementPanel, type EngagementRow } from "./engagement-panel";
import { EvidencePanel, type EvidenceItemRow } from "./evidence-panel";
import { ArchiveStatusBanner } from "./archive-status-banner";
import { ArchiveWizardDialog } from "./archive-wizard";
import { TeamEditorDialog } from "./team-editor-dialog";
import type { FolderPayload, FolderDocument, TemplateSummary } from "./folder-types";
import type { UserOption as PresUserOption } from "@/app/(app)/preservation/_components/preservation-types";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { shDayKey, shDaysFromToday, shMonthDay, shTime } from "@/lib/ui/sh-time";

type MatterPayloadBase = Prisma.MatterGetPayload<{
  include: {
    primaryClient: { include: { contacts: { where: { isPrimary: true }; take: 1 } } };
    clientLinks: { include: { client: { select: { id: true; name: true; type: true; idNumber: true } } } };
    owner: { select: { id: true; name: true; role: true } };
    members: { include: { user: { select: { id: true; name: true; role: true } } } };
    cause: true;
    parties: true;
    relatedEntities: true;
    intake: { select: { counterclaim: true; claimDescription: true } };
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

type MatterPayload = Omit<MatterPayloadBase, "claimAmount" | "members"> & {
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
    contractAmount: number;
    receivable: number;
    received: number;
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

/** 上下文头「受理机构」随案件类别命名 */
const AGENCY_LABEL: Partial<Record<string, string>> = {
  CIVIL_COMMERCIAL: "受理法院",
  LABOR_ARBITRATION: "仲裁机构",
  COMMERCIAL_ARBITRATION: "仲裁机构",
  CRIMINAL: "办案机关",
  ADMINISTRATIVE: "受理机关"
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
  engagements,
  evidenceItems,
  notes,
  reviewNode,
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
  engagements: EngagementRow[];
  evidenceItems: EvidenceItemRow[];
  notes: WorkflowNote[];
  /** AI 审查总览（服务端渲染节点），归入「信息总览」 */
  reviewNode?: React.ReactNode;
  /** 外部能力是否已配置：AI 文书审查 / 元典类案检索（未配置不显示入口） */
  capabilities?: { aiReview: boolean; caseSearch: boolean };
}) {
  const allowed = (key: import("@/lib/roles/catalog").PermissionKey) => hasCustomPermission({ role: currentUserRole ?? "", rolePermissions }, key);
  const [selectedProcId, setSelectedProcId] = useState<string | null>(null);
  const [addProcOpen, setAddProcOpen] = useState(false);
  const [matterEditorOpen, setMatterEditorOpen] = useState(false);
  const [view, setView] = useState<DossierView>("work");
  const [caseSearchOpen, setCaseSearchOpen] = useState(false);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const docActions = useMemo(() => (capabilities.aiReview && allowed("documents.write") ? { onReview: (id: string) => setReviewDocId(id) } : {}), [capabilities.aiReview, currentUserRole, rolePermissions]); // eslint-disable-line react-hooks/exhaustive-deps
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
        toast.error("删除失败", { description: err instanceof Error ? err.message : "" });
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
  // 已归档案件只读：不再提供登记进展、上传材料与新增程序入口
  const canWriteRecords = canAssociateThisMatter && allowed("schedule.write") && !isArchived;

  // 顶栏主操作 = 登记进展（墨案 04）
  useTopbarAction(
    canWriteRecords ? { label: "登记进展", onClick: () => setProgress({ mode: "record", stage: workflowApi.current?.currentStageName ?? undefined, stageNames: workflowApi.current?.stageNames ?? [] }) } : null,
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
  const hasCustomFields = customFieldDefs.length > 0;
  const restricted = Boolean((matter as { teamAccessRestricted?: boolean }).teamAccessRestricted);
  const procLabel = (p: ProcedureItem) => p.customLabel ?? procedureTypeLabel[p.type] ?? p.type;

  const moreItems = [
    ...(canOpenUnifiedEditor ? [{ key: "edit", label: "编辑信息与团队", icon: Pencil, onSelect: () => setMatterEditorOpen(true) }] : []),
    ...(canAssociateThisMatter && !isArchived ? [{ key: "proc", label: "新增程序", icon: Plus, onSelect: () => setAddProcOpen(true) }] : []),
    ...(allowed("finance.read") ? [{ key: "fin", label: "财务明细与开票", icon: CircleDollarSign, onSelect: () => setView("money") }] : []),
    { key: "seal", label: "用印审批", icon: Stamp, onSelect: () => setView("money") },
    ...(capabilities.caseSearch && allowed("matters.write") ? [{ key: "cases", label: "类案检索（元典）", icon: Scale, onSelect: () => setCaseSearchOpen(true) }] : []),
    ...(canWriteRecords && currentProcedure ? [{ key: "hearing", label: "安排开庭", icon: Gavel, onSelect: () => setHearingOpen(true) }] : [])
  ];

  const archiveBadge = matter.status === "ARCHIVED"
    ? { tone: "bronze", text: "已归档" }
    : latestArchive?.status === "PENDING_REVIEW"
      ? { tone: "bronze", text: "预归档中" }
      : latestArchive?.status === "REJECTED"
        ? { tone: "outline-red", text: "归档被驳回" }
        : null;

  const standingLabel = matter.ourStanding ? litigationStandingLabel[matter.ourStanding] : null;
  const categoryKind = matterCategoryKind(matter.category);
  const parties = procedureParties;
  const standingOf = (partyId: string, fallback: string | null) => {
    const row = currentProcedure?.procedureParties.find((pp) => pp.partyId === partyId);
    const s = row?.standing ?? fallback;
    return s ? litigationStandingLabel[s as keyof typeof litigationStandingLabel] ?? null : null;
  };
  const sideOf = (role: string) => parties.filter((p) => p.role === role);
  const ours = sideOf("CLIENT_PARTY");
  const opposing = sideOf("OPPOSING_PARTY");
  const thirds = parties.filter((p) => p.role === "THIRD_PARTY" || p.role === "CO_LITIGANT");
  const contactLabels = contactRoleLabels(currentProcedure?.type);

  // 案卷头异常标签：当前程序逾期事项、保全临期
  const today0 = shDaysFromToday;
  const overdueCount = currentProcedure
    ? currentProcedure.stages.flatMap((s) => (s.status === "HIDDEN" ? [] : s.tasks)).filter((t) => !t.completed && t.dueAt && today0(t.dueAt) < 0).length +
      currentProcedure.deadlines.filter((d) => !d.completed && today0(d.dueAt) < 0).length
    : 0;
  const expiringProps = preservationCases
    .flatMap((c) => c.targets.flatMap((t) => t.properties))
    .filter((p) => (p.status === "ACTIVE" || p.status === "RENEWED") && today0(p.expiryDate) <= 30);
  const nearestExpiry = expiringProps.length ? Math.min(...expiringProps.map((p) => today0(p.expiryDate))) : null;

  const waiting: WaitingItem[] = [
    ...sealContracts
      .filter((s) => s.status === "PENDING")
      .map((s) => ({ key: `seal-${s.id}`, title: `用印申请 · ${s.documentTitle}`, meta: `${s.code} · ${formatMonthDay(s.createdAt)} 提交`, onOpen: () => setView("money") })),
    ...(latestArchive?.status === "PENDING_REVIEW" ? [{ key: "archive", title: `归档申请 · ${latestArchive.archiveNo}`, meta: `提交人 ${latestArchive.archivedBy} · 等待归档审核`, onOpen: () => setView("file") }] : [])
  ];

  const money = (n: number | null | undefined) => (n != null && n > 0 ? `¥${n.toLocaleString("zh-CN")}` : null);
  const requestLabel = currentProcedure && ["COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION"].includes(currentProcedure.type) ? "仲裁请求" : "诉讼请求";
  const requestText = matter.intake?.claimDescription?.trim() || "";

  return (
    <DocActionsContext.Provider value={docActions}>
    <div className="mo-matter mo-dossier">
      {/* ① 案卷头：这是什么案、谁对谁、在哪办 */}
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
              {currentProcedure?.caseNumber ? <span className="code">{currentProcedure.caseNumber}</span> : null}
              <span>{[matterCategoryLabel[matter.category], matter.cause?.name ?? matter.causeFreeText].filter(Boolean).join(" · ")}</span>
            </div>
            <h1 className="ctx-title dos-title">{matter.title}</h1>
            <div className="ctx-badges">
              {isArchived && archiveBadge ? null : (
                <span className={cn("badge", `b-${matterStatusTone(matter.status)}`)}>
                  <span className="bdot" />
                  {matterStatusLabel[matter.status]}
                  {currentProcedure ? ` · ${procLabel(currentProcedure)}` : ""}
                </span>
              )}
              {overdueCount > 0 ? <span className="badge b-red"><span className="bdot" />{overdueCount} 项逾期</span> : null}
              {nearestExpiry !== null ? <span className="badge b-bronze">保全 {nearestExpiry < 0 ? "已过期" : `${nearestExpiry} 天后到期`}</span> : null}
              {money(matter.claimAmount) ? <span className="badge b-white">{categoryKind === "litigation" ? "标的" : "金额"} <span className="mono">{money(matter.claimAmount)}</span></span> : null}
              {allowed("finance.read") && money(finance.stats.contractAmount) ? <span className="badge b-white">合同额 <span className="mono">{money(finance.stats.contractAmount)}</span></span> : null}
              {matter.intakeDate ? <span className="badge b-white">收案 <span className="mono">{formatShortDate(matter.intakeDate)}</span></span> : null}
              {matter.serviceStatus === "SERVICE_COMPLETED" ? <span className="badge b-green" title="服务轴与程序轴分离：律师服务已完成">服务已完成</span> : null}
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
              serviceStatus={matter.serviceStatus}
              canArchive={canLeadThisMatter && allowed("archive.submit")}
              canChangeStatus={Boolean(currentUserRole && canLeadThisMatter)}
              extraItems={moreItems}
            />
          </div>
        </div>

        {/* 对阵行：诉讼类「我方｜对方｜受理机构」；非诉 / 顾问「委托人｜业务｜服务期间」 */}
        {categoryKind === "litigation" ? (
          <div className="dos-versus">
            <div className="side ours">
              <div className="role">
                {ours[0] ? standingOf(ours[0].id, ours[0].standing) ?? standingLabel ?? "委托方" : standingLabel ?? "委托方"} · 我方委托人
              </div>
              <div className="who" title={ours.map((p) => p.name).join("、")}>{ours.map((p) => p.name).join("、") || matter.primaryClient?.name || "—"}</div>
              <div className="sub">{[ours[0]?.legalRep ? `法定代表人 ${ours[0].legalRep}` : null, ours[0]?.contactName ? `对接人 ${ours[0].contactName}` : null].filter(Boolean).join(" · ") || " "}</div>
            </div>
            <div className="vs" aria-hidden>{matter.category === "CRIMINAL" ? "辩" : "诉"}</div>
            {matter.category === "CRIMINAL" && opposing.length === 0 ? (
              <div className="side">
                <div className="role">涉嫌罪名</div>
                <div className="who">{matter.cause?.name ?? matter.causeFreeText ?? "—"}</div>
                <div className="sub">{currentProcedure ? procLabel(currentProcedure) : "\u00a0"}</div>
              </div>
            ) : (
              <div className="side">
                <div className="role">{opposing[0] ? standingOf(opposing[0].id, opposing[0].standing) ?? "对方" : "对方"}</div>
                <div className="who" title={opposing.map((p) => p.name).join("、")}>{opposing.map((p) => p.name).join("、") || "—"}</div>
                <div className="sub">{thirds.length ? `${thirds.map((p) => `${PARTY_ROLE_LABEL[p.role] ?? "第三人"} ${p.name}`).join("、")}` : opposing[0]?.legalRep ? `法定代表人 ${opposing[0].legalRep}` : " "}</div>
              </div>
            )}
            <div className="side court">
              <div className="role">{currentProcedure?.handlingAgency || AGENCY_LABEL[matter.category] || "受理机构"}</div>
              <div className="who">
                {[currentProcedure?.presidingJudge ? `${contactLabels.lead} ${currentProcedure.presidingJudge}` : null, currentProcedure?.judgeAssistant ? `${contactLabels.assistant} ${currentProcedure.judgeAssistant}` : null].filter(Boolean).join(" · ") || "承办人员未登记"}
              </div>
              <div className="sub mono">{currentProcedure?.presidingJudgeContact || currentProcedure?.judgeAssistantContact || " "}</div>
            </div>
          </div>
        ) : (
          <div className="dos-versus plain">
            <div className="side ours">
              <div className="role">委托人</div>
              <div className="who">{matter.primaryClient?.name ?? matter.clientLinks[0]?.client.name ?? "—"}</div>
              <div className="sub">{ours[0]?.contactName ? `对接人 ${ours[0].contactName}` : " "}</div>
            </div>
            <div className="side">
              <div className="role">{categoryKind === "counsel" ? "顾问类型" : "业务类型"}</div>
              <div className="who">{(categoryKind === "counsel" ? matter.counselType : matter.businessType) || "—"}</div>
              <div className="sub">{matterCategoryLabel[matter.category]}</div>
            </div>
            <div className="side court">
              <div className="role">{categoryKind === "counsel" ? "顾问期限" : "服务期间"}</div>
              <div className="who mono">{[matter.serviceStart ? formatShortDate(matter.serviceStart) : null, matter.serviceEnd ? formatShortDate(matter.serviceEnd) : null].filter(Boolean).join(" — ") || "未登记"}</div>
              <div className="sub">{matter.serviceEnd ? (shDaysFromToday(matter.serviceEnd) < 0 ? "已到期" : `剩 ${shDaysFromToday(matter.serviceEnd)} 天`) : " "}</div>
            </div>
          </div>
        )}
      </section>

      {/* 吸顶摘要：标题滚出视野后常驻案件身份与下一节点 */}
      <MatterStickyBar title={matter.title} caseNumber={currentProcedure?.caseNumber ?? null} procedures={engagedProcedures} />

      {latestArchive && latestArchive.status !== "APPROVED" ? (
        <div style={{ margin: "14px 0 0" }}>
          <ArchiveStatusBanner
            record={latestArchive}
            onReArchive={latestArchive.status === "REJECTED" && canLeadThisMatter ? () => setArchiveOpen(true) : undefined}
          />
        </div>
      ) : null}

      {/* ② 进程主线 → ③ 视图 */}
      <ProcedureWorkflowPanel
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
        viewCounts={{ docs: procDocs.length, evidence: evidenceItems.length }}
        waiting={waiting}
        chainHeader={
          <>
            {engagedProcedures.map((procedure) => {
              const isActive = currentProcedure?.id === procedure.id;
              const label = procLabel(procedure);
              return (
                <span key={procedure.id} className={cn("prog-chip group/proc relative", isActive && "active")}>
                  <button type="button" onClick={() => setSelectedProcId(procedure.id)} className="max-w-[144px] truncate border-0 bg-transparent p-0 text-inherit">
                    {label}
                    {procedure.status === "CONCLUDED" ? "（已结）" : ""}
                  </button>
                  {canLeadThisMatter ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirmDialog({ title: `删除程序「${label}」？`, description: deleteProcedureWarning(procedure, label).replace(/^确定删除程序「[^」]*」？\s*/, ""), confirmText: "删除程序", danger: true })) handleDeleteProcedure(procedure.id);
                      }}
                      className="pointer-events-none -mr-1 ml-0.5 opacity-0 transition-opacity group-hover/proc:pointer-events-auto group-hover/proc:opacity-100"
                      title="删除此程序"
                      aria-label={`删除程序 ${label}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {canAssociateThisMatter && !isArchived ? (
              <button type="button" className="prog-chip" onClick={() => setAddProcOpen(true)}>
                + 新增程序
              </button>
            ) : null}
          </>
        }
        railSlot={
          <DossierRail
            matter={matter}
            requestLabel={categoryKind === "litigation" ? requestLabel : "服务范围"}
            requestText={categoryKind === "litigation" ? (matter.category === "CRIMINAL" ? "" : requestText) : matter.serviceScope?.trim() ?? ""}
            financeStats={allowed("finance.read") ? finance.stats : null}
            sealContracts={sealContracts}
            canManageTeam={canOwnThisMatter}
            onManageTeam={() => setMatterEditorOpen(true)}
            onOpenFinance={() => setView("money")}
            restricted={restricted}
          />
        }
        evidenceNode={
          allowed("matters.read") ? (
            <div className="dos-view-stack">
              <EvidencePanel
                matterId={matter.id}
                items={evidenceItems}
                documents={documents.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))}
                canManage={canAssociateThisMatter}
              />
              {capabilities.caseSearch && allowed("matters.write") ? (
                <div className="card">
                  <div className="panel-head">
                    <div className="panel-title">
                      <Scale className="ic" strokeWidth={1.8} />
                      类案检索
                      <span className="t-xs t-mute" style={{ fontWeight: 400 }}>按案由与争点检索元典类案，结果可挂到证据链</span>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCaseSearchOpen(true)}>
                      开始检索
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : undefined
        }
        financeNode={
          <div className="dos-view-stack">
            {allowed("matters.read") ? (
              <EngagementPanel
                matterId={matter.id}
                client={matter.primaryClient ? { id: matter.primaryClient.id, name: matter.primaryClient.name } : null}
                engagements={engagements}
                canManage={canAssociateThisMatter}
              />
            ) : null}
            {allowed("finance.read") ? (
              <FinancePanel matterId={matter.id} finance={finance} userOptions={userOptions} canRequestInvoice={canAssociateThisMatter} />
            ) : null}
            <ApprovalsPanel matterId={matter.id} matterTitle={matter.title} sealContracts={sealContracts} canRequest={canAssociateThisMatter && allowed("seals.request")} />
          </div>
        }
        fileNode={
          <div className="dos-view-stack">
            <InfoPanel
              matter={matter}
              currentProcedure={currentProcedure}
              canEdit={canOpenUnifiedEditor}
              canManageRelatedMatters={canAssociateThisMatter}
              onEdit={() => setMatterEditorOpen(true)}
            />
            <ProcedureRemindersAndMemos
              matterId={matter.id}
              procedures={engagedProcedures}
              currentProcedureId={currentProcedure?.id ?? ""}
              expresses={expresses}
              canManage={canAssociateThisMatter}
            />
            {hasCustomFields ? (
              <CustomFieldsPanel matterId={matter.id} defs={customFieldDefs} values={customValues} canEdit={canLeadThisMatter} />
            ) : null}
            {reviewNode}
          </div>
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

const PARTY_ROLE_LABEL: Record<string, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "相对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他"
};

const SEAL_STATUS: Record<string, { label: string; tone: "amber" | "teal" | "red" | "slate"; sealText: string; badge: string | null }> = {
  PENDING: { label: "审批中", tone: "amber", sealText: "待 审", badge: "b-amber" },
  APPROVED: { label: "已批准", tone: "teal", sealText: "审 毕", badge: "b-teal" },
  STAMPED: { label: "已用印", tone: "teal", sealText: "审 毕", badge: "b-green" },
  REJECTED: { label: "已驳回", tone: "red", sealText: "驳 回", badge: "b-outline-red" },
  CANCELLED: { label: "已取消", tone: "slate", sealText: "取 消", badge: null }
};

/**
 * 办案视图右栏：只放随时要瞄一眼的——我方请求、承办团队、收费进度、审批与用印。
 * 当事人在案卷头对阵行；财务与用印全量在「委托与财务」视图。
 */
function DossierRail({
  matter,
  requestLabel,
  requestText,
  financeStats,
  sealContracts,
  canManageTeam,
  onManageTeam,
  onOpenFinance,
  restricted
}: {
  matter: MatterPayload;
  requestLabel: string;
  requestText: string;
  financeStats: FinancePayload["stats"] | null;
  sealContracts: SealContractItem[];
  canManageTeam: boolean;
  onManageTeam: () => void;
  onOpenFinance: () => void;
  restricted: boolean;
}) {
  const [requestOpen, setRequestOpen] = useState(false);
  const roleOrder = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = matter.members.map((m) => ({ id: m.userId, name: m.user.name, matterRole: m.role, roleName: m.user.roleName }));
  if (matter.owner && !members.some((m) => m.id === matter.ownerId)) {
    members.unshift({ id: matter.owner.id, name: matter.owner.name, matterRole: "LEAD", roleName: (matter.owner as { roleName?: string }).roleName });
  }
  members.sort((a, b) => roleOrder[a.matterRole] - roleOrder[b.matterRole]);
  const roleTag: Record<string, string> = { LEAD: "b-teal", CO_LEAD: "b-slate", ASSISTANT: "b-slate" };
  const recentSeals = sealContracts.slice(0, 3);
  const longRequest = requestText.length > 140;

  return (
    <>
      {/* 请求 / 服务范围来自收案登记；未登记时不占位 */}
      {requestText ? (
        <div className="card">
          <div className="rail-sec-head">
            <ScrollText className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
            {requestLabel}
          </div>
          <div className="panel-body dos-request">
            <p className={cn("whitespace-pre-wrap", !requestOpen && longRequest && "line-clamp-6")}>{requestText}</p>
            {longRequest ? (
              <button type="button" className="link-inline" onClick={() => setRequestOpen((v) => !v)}>
                {requestOpen ? "收起" : "展开全部"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="rail-sec-head">
          <Users className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          承办团队
          {canManageTeam ? (
            <button type="button" className="link border-0 bg-transparent p-0" onClick={onManageTeam}>
              管理
            </button>
          ) : null}
        </div>
        {members.length === 0 ? (
          <div className="member t-xs t-mute">暂无团队成员</div>
        ) : (
          members.map((m) => (
            <div key={`${m.id}-${m.matterRole}`} className="member">
              <InitialAvatar name={m.name} tone={avatarTone(m.name)} />
              <div className="min-w-0">
                <div className="n truncate">{m.name}</div>
                <div className="r truncate">{m.roleName ?? matterTeamRoleDescription(m.matterRole)}</div>
              </div>
              <span className={`badge ${roleTag[m.matterRole]} role-tag`} style={{ fontSize: 10 }}>
                {matterTeamRoleLabel(m.matterRole)}
              </span>
            </div>
          ))
        )}
        {restricted ? (
          <div className="panel-body" style={{ padding: "8px 14px" }}>
            <span className="t-xs t-mute">受限事项，不进入团队汇总视图</span>
          </div>
        ) : null}
      </div>

      {financeStats ? (
        <div className="card">
          <div className="rail-sec-head">
            <CreditCard className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
            收费
            <button type="button" className="link border-0 bg-transparent p-0" onClick={onOpenFinance}>
              明细
            </button>
          </div>
          <RailFinance stats={financeStats} />
        </div>
      ) : null}

      <div className="card">
        <div className="rail-sec-head">
          <SquareCheck className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          审批与用印
          <button type="button" className="link border-0 bg-transparent p-0" onClick={onOpenFinance}>
            全部
          </button>
        </div>
        {recentSeals.length === 0 ? (
          <div className="panel-body t-xs t-mute">暂无用印审批记录</div>
        ) : (
          recentSeals.map((seal) => {
            const meta = SEAL_STATUS[seal.status] ?? SEAL_STATUS.PENDING;
            return (
              <div key={seal.id} className="dos-seal-row">
                <span className={cn("seal", meta.tone === "teal" && "teal")} style={{ width: 34, height: 34, fontSize: 7.5, ...(meta.tone === "amber" ? { borderColor: "var(--amber)", color: "var(--amber)" } : meta.tone === "slate" ? { borderColor: "var(--t-faint)", color: "var(--t-faint)" } : meta.tone === "red" ? { borderColor: "var(--red)", color: "var(--red)" } : {}) }} aria-hidden>
                  <span>{meta.sealText}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }} title={seal.documentTitle}>
                    {seal.documentTitle}
                  </div>
                  <div className="t-xs t-mute">
                    {seal.code} · {formatMonthDay(seal.createdAt)} · {seal.stampedDoc ? "已用印回填" : meta.label}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function RailFinance({ stats }: { stats: FinancePayload["stats"] }) {
  const outstanding = Math.max(0, stats.receivable - stats.received);
  const base = stats.contractAmount > 0 ? stats.contractAmount : stats.receivable;
  const percent = base > 0 ? Math.min(100, Math.round((stats.received / base) * 100)) : 0;
  const money = (n: number) => (n > 0 ? `¥${n.toLocaleString("zh-CN")}` : "—");
  return (
    <>
      <div className="fin-row"><span className="k">合同额</span><span className="v">{money(stats.contractAmount)}</span></div>
      <div className="fin-row"><span className="k">已实收</span><span className="v" style={{ color: "var(--green)" }}>{money(stats.received)}</span></div>
      <div className="fin-row"><span className="k">待收</span><span className="v" style={{ color: outstanding > 0 ? "var(--amber)" : undefined }}>{money(outstanding)}</span></div>
      <div className="fin-row"><span className="k">已开票</span><span className="v">{money(stats.invoiced)}</span></div>
      <div className="panel-body" style={{ padding: "10px 14px 13px" }}>
        {base > 0 ? (
          <>
            <div className="progress"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <span className="t-xs t-mute">回款进度</span>
              <span className="num-sm t-mute">{percent}%</span>
            </div>
          </>
        ) : (
          <span className="t-xs t-mute">未登记合同金额，暂不计算回款进度</span>
        )}
      </div>
    </>
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
            <span className="min-w-0 truncate font-serif text-[13px] font-bold" title={title}>
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

function matterTeamRoleLabel(role: "LEAD" | "CO_LEAD" | "ASSISTANT") {
  if (role === "LEAD") return "主办";
  if (role === "CO_LEAD") return "协办";
  return "助理";
}

function matterTeamRoleDescription(role: "LEAD" | "CO_LEAD" | "ASSISTANT") {
  if (role === "LEAD") return "主办律师";
  if (role === "CO_LEAD") return "协办律师";
  return "律师助理";
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
