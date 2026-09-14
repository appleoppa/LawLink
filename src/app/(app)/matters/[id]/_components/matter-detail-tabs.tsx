"use client";
import Link from "next/link";
import { hasCustomPermission, type RoleGrant } from "@/lib/roles/catalog";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClientType, Prisma } from "@prisma/client";
import { Archive, ChevronLeft, CircleDollarSign, Clock3, CreditCard, Gavel, Pencil, Plus, Scale, SquareCheck, Stamp, Upload, UserRound, Users, X } from "lucide-react";
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
import { InfoPanel } from "./info-panel";
import { FinancePanel } from "./finance-panel";
import { ProcedureRemindersAndMemos } from "./procedure-content";
import { ProcedureWorkflowPanel } from "./procedure-workflow-panel";
import type { WorkflowApi, WorkflowNote, WorkflowPreservationCase } from "./procedure-workflow-panel";
import { MatterSignalStrip } from "./matter-signal-strip";

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
  const [financeOpen, setFinanceOpen] = useState(false);
  const [caseSearchOpen, setCaseSearchOpen] = useState(false);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const docActions = useMemo(() => (capabilities.aiReview && allowed("documents.write") ? { onReview: (id: string) => setReviewDocId(id) } : {}), [capabilities.aiReview, currentUserRole, rolePermissions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [approvalsOpen, setApprovalsOpen] = useState(false);
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
  const canWriteRecords = canAssociateThisMatter && allowed("schedule.write");

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
  const isLitigation = matterCategoryKind(matter.category) === "litigation";

  const moreItems = [
    ...(canOpenUnifiedEditor ? [{ key: "edit", label: "编辑信息与团队", icon: Pencil, onSelect: () => setMatterEditorOpen(true) }] : []),
    ...(canAssociateThisMatter ? [{ key: "proc", label: "新增程序", icon: Plus, onSelect: () => setAddProcOpen(true) }] : []),
    ...(allowed("finance.read") ? [{ key: "fin", label: "财务明细与开票", icon: CircleDollarSign, onSelect: () => setFinanceOpen(true) }] : []),
    { key: "seal", label: "用印审批", icon: Stamp, onSelect: () => setApprovalsOpen(true) },
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

  return (
    <DocActionsContext.Provider value={docActions}>
    <div className="mo-matter">
      {/* ① 上下文头 */}
      <div className="card ctx-head" style={{ marginBottom: 14 }}>
        <div className="ctx-top flex-wrap">
          <div style={{ minWidth: 0 }} className="flex-1">
            <Link href="/matters" className="ctx-back no-underline">
              <ChevronLeft className="h-3.5 w-3.5" />
              返回案件列表
            </Link>
            <h1 className="ctx-title">{matter.title}</h1>
            <div className="ctx-code">
              {[matter.internalCode, matter.firmCaseNo ? `所内编号 ${matter.firmCaseNo}` : null, currentProcedure?.caseNumber].filter(Boolean).join(" · ")}
            </div>
            <div className="ctx-badges">
              <span className="badge b-white">{matterCategoryLabel[matter.category]}</span>
              {currentProcedure ? <span className="badge b-white">{procLabel(currentProcedure)}</span> : null}
              {standingLabel ? <span className="badge b-teal">{isLitigation ? `${standingLabel}方代理` : standingLabel}</span> : null}
              <span className={cn("badge", `b-${matterStatusTone(matter.status)}`)}>
                <span className="bdot" />
                {matterStatusLabel[matter.status]}
              </span>
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
            {canAssociateThisMatter && allowed("documents.write") && currentProcedure ? (
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
        <div className="ctx-meta">
          {[
            ["委托方", matter.primaryClient?.name ?? matter.clientLinks[0]?.client.name ?? "—", false],
            [isLitigation ? "受理法院" : "受理机构", currentProcedure?.handlingAgency ?? "—", false],
            ["收案", matter.intakeDate ? formatShortDate(matter.intakeDate) : "—", true],
            ...(allowed("finance.read") ? [["合同额", finance.stats.contractAmount > 0 ? `¥${finance.stats.contractAmount.toLocaleString("zh-CN")}` : "—", true] as const] : []),
            ["标的额", matter.claimAmount != null ? `¥${Number(matter.claimAmount).toLocaleString("zh-CN")}` : "—", true],
            ["案由", matter.cause?.name ?? matter.causeFreeText ?? "—", false]
          ].filter(([k, v]) => k === "委托方" || v !== "—").map(([k, v, mono]) => (
            <div key={k as string} className="m">
              <span className="k">{k}</span>
              <span className={cn("v", mono && "mono")}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 吸顶摘要：标题滚出视野后常驻案件身份与下一节点 */}
      <MatterStickyBar title={matter.title} caseNumber={currentProcedure?.caseNumber ?? null} procedures={engagedProcedures} />

      {/* 归档状态说明 */}
      {latestArchive && latestArchive.status !== "APPROVED" ? (
        <div style={{ marginBottom: 14 }}>
          <ArchiveStatusBanner
            record={latestArchive}
            onReArchive={latestArchive.status === "REJECTED" && canLeadThisMatter ? () => setArchiveOpen(true) : undefined}
          />
        </div>
      ) : null}

      {/* ② 信号条 */}
      <MatterSignalStrip
        procedures={currentProcedure ? [currentProcedure] : engagedProcedures}
        allProcedures={engagedProcedures}
        finance={allowed("finance.read") ? finance.stats : null}
        invoicePending={finance.stats.receivable > finance.stats.invoiced ? finance.stats.receivable - finance.stats.invoiced : 0}
      />

      {/* ③ 程序链 + ④ 三栏工作区 */}
      <ProcedureWorkflowPanel
        apiRef={workflowApi}
        matter={{
          id: matter.id,
          internalCode: matter.internalCode,
          title: matter.title,
          category: matter.category
        }}
        procedure={currentProcedure}
        documents={procDocs}
        preservationCases={preservationCases}
        folders={folders}
        templates={templates}
        users={colleagues}
        canManage={canAssociateThisMatter}
        notes={notes}
        timelineEvents={matter.timelineEvents}
        onWriteNote={({ judgment, stageName }) => setProgress({ mode: judgment ? "judgment" : "record", stage: stageName, stageNames: workflowApi.current?.stageNames ?? [] })}
        chainHeader={
          <>
            {engagedProcedures.map((procedure) => {
              const isActive = currentProcedure?.id === procedure.id;
              const label = procLabel(procedure);
              return (
                <span key={procedure.id} className={cn("prog-chip group/proc relative", isActive && "active")}>
                  {isActive ? <span className="dot" style={{ width: 5, height: 5, background: "#4FC3C0" }} /> : null}
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
            {canAssociateThisMatter ? (
              <button type="button" className="prog-chip" style={{ color: "var(--t-faint)" }} onClick={() => setAddProcOpen(true)}>
                + 新增程序
              </button>
            ) : null}
          </>
        }
        matterInfoNode={
          <>
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
            {allowed("matters.read") ? (
              <EvidencePanel
                matterId={matter.id}
                items={evidenceItems}
                documents={documents.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))}
                canManage={canAssociateThisMatter}
              />
            ) : null}
            {allowed("matters.read") ? (
              <EngagementPanel
                matterId={matter.id}
                client={matter.primaryClient ? { id: matter.primaryClient.id, name: matter.primaryClient.name } : null}
                engagements={engagements}
                canManage={canAssociateThisMatter}
              />
            ) : null}
            {hasCustomFields ? (
              <CustomFieldsPanel matterId={matter.id} defs={customFieldDefs} values={customValues} canEdit={canLeadThisMatter} />
            ) : null}
            {reviewNode}
          </>
        }
        railSlot={
          <MatterRailCards
            matter={matter}
            financeStats={allowed("finance.read") ? finance.stats : null}
            parties={procedureParties}
            sealContracts={sealContracts}
            canManageTeam={canOwnThisMatter}
            onManageTeam={() => setMatterEditorOpen(true)}
            onOpenFinance={() => setFinanceOpen(true)}
            onOpenApprovals={() => setApprovalsOpen(true)}
            restricted={restricted}
          />
        }
      />

      {/* 抽屉：财务明细 / 用印审批（效果图右栏「明细」「全部」入口） */}
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

      <Sheet open={financeOpen} onOpenChange={setFinanceOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[760px]">
          <SheetHeader className="px-5 pt-5">
            <SheetTitle>财务明细 · {matter.title}</SheetTitle>
          </SheetHeader>
          <div className="p-5">
            {allowed("finance.read") ? (
              <FinancePanel matterId={matter.id} finance={finance} userOptions={userOptions} canRequestInvoice={canAssociateThisMatter} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={approvalsOpen} onOpenChange={setApprovalsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[680px]">
          <SheetHeader className="px-5 pt-5">
            <SheetTitle>用印审批 · {matter.title}</SheetTitle>
          </SheetHeader>
          <div className="p-5">
            <ApprovalsPanel matterId={matter.id} matterTitle={matter.title} sealContracts={sealContracts} canRequest={canAssociateThisMatter && allowed("seals.request")} />
          </div>
        </SheetContent>
      </Sheet>

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
 * 墨案 04 rail：右辅助栏四卡（团队 / 当事人 / 财务速览 / 最近审批）。
 * 只读速览；管理动作走「管理」「明细」「全部」入口，不在栏内做业务操作。
 */
function MatterRailCards({
  matter,
  financeStats,
  parties,
  sealContracts,
  canManageTeam,
  onManageTeam,
  onOpenFinance,
  onOpenApprovals,
  restricted
}: {
  matter: MatterPayload;
  financeStats: FinancePayload["stats"] | null;
  parties: ReturnType<typeof buildProcedurePartyOptions>;
  sealContracts: SealContractItem[];
  canManageTeam: boolean;
  onManageTeam: () => void;
  onOpenFinance: () => void;
  onOpenApprovals: () => void;
  restricted: boolean;
}) {
  const roleOrder = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = matter.members.map((m) => ({ id: m.userId, name: m.user.name, matterRole: m.role, roleName: m.user.roleName }));
  if (matter.owner && !members.some((m) => m.id === matter.ownerId)) {
    members.unshift({ id: matter.owner.id, name: matter.owner.name, matterRole: "LEAD", roleName: (matter.owner as { roleName?: string }).roleName });
  }
  members.sort((a, b) => roleOrder[a.matterRole] - roleOrder[b.matterRole]);
  const roleTag: Record<string, string> = { LEAD: "b-teal", CO_LEAD: "b-slate", ASSISTANT: "b-slate" };

  const railPartyRows = [...parties]
    .sort((a, b) => (a.role === "CLIENT_PARTY" ? -1 : 0) - (b.role === "CLIENT_PARTY" ? -1 : 0))
    .slice(0, 6);

  const latestSeal = sealContracts[0] ?? null;
  const sealMeta = latestSeal ? SEAL_STATUS[latestSeal.status] ?? SEAL_STATUS.PENDING : null;

  return (
    <>
      <div className="card">
        <div className="rail-sec-head">
          <Users className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          团队
          {canManageTeam ? (
            <button type="button" className="link border-0 bg-transparent p-0" onClick={onManageTeam}>
              管理
            </button>
          ) : null}
        </div>
        {members.length === 0 ? (
          <div className="member t-xs t-mute">暂无团队成员</div>
        ) : (
          members.map((m, i) => (
            <div key={`${m.id}-${m.matterRole}`} className="member" style={i === members.length - 1 ? { borderBottom: "1px solid var(--bd-hair)" } : undefined}>
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
        <div className="panel-body" style={{ padding: "10px 14px" }}>
          <span className="t-xs t-mute">{restricted ? "本案件为受限事项，不进入团队汇总视图" : "团队只读成员可在团队汇总中查看本案件正文"}</span>
        </div>
      </div>

      <div className="card">
        <div className="rail-sec-head">
          <UserRound className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          当事人
        </div>
        {railPartyRows.length === 0 ? (
          <div className="party t-xs t-mute">暂未登记当事人</div>
        ) : (
          railPartyRows.map((party) => {
            const isClient = party.role === "CLIENT_PARTY";
            const roleText = party.standing ? litigationStandingLabel[party.standing] : PARTY_ROLE_LABEL[party.role] ?? "当事人";
            const agent = [party.legalRep ? `法定代表人 ${party.legalRep}` : null, party.contactName ? `联系人 ${party.contactName}` : null].filter(Boolean).join(" · ");
            return (
              <div key={party.id} className="party">
                <div className="party-role">
                  <span className={cn("dot", isClient ? "dot-teal" : "dot-slate")} />
                  {roleText}
                  {isClient && party.standing ? "（委托方）" : ""}
                </div>
                <div className="party-name truncate" title={party.name}>{party.name}</div>
                {agent ? <div className="party-agent truncate">{agent}</div> : null}
              </div>
            );
          })
        )}
      </div>

      {financeStats ? (
        <div className="card">
          <div className="rail-sec-head">
            <CreditCard className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
            财务速览
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
          最近审批
          <button type="button" className="link border-0 bg-transparent p-0" onClick={onOpenApprovals}>
            全部
          </button>
        </div>
        {latestSeal && sealMeta ? (
          <div className="panel-body" style={{ display: "flex", gap: 13, alignItems: "center", padding: "13px 14px" }}>
            <span className={cn("seal", sealMeta.tone === "teal" && "teal")} style={{ width: 46, height: 46, fontSize: 8.5, ...(sealMeta.tone === "amber" ? { borderColor: "var(--amber)", color: "var(--amber)" } : sealMeta.tone === "slate" ? { borderColor: "var(--t-faint)", color: "var(--t-faint)" } : {}) }} aria-hidden>
              <span className="seal-star">★</span>
              <span>{sealMeta.sealText}</span>
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }} title={latestSeal.documentTitle}>
                用章申请 · {latestSeal.documentTitle}
              </div>
              <div className="t-xs t-mute" style={{ marginTop: 2 }}>
                {latestSeal.code} · {formatMonthDay(latestSeal.createdAt)} · {sealMeta.label}
              </div>
              {sealMeta.badge ? (
                <span className={`badge ${sealMeta.badge}`} style={{ marginTop: 6, fontSize: 10 }}>
                  <span className="bdot" />
                  {latestSeal.stampedDoc ? "已用印回填" : sealMeta.label}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="panel-body t-xs t-mute">暂无用章审批记录</div>
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
        <div className="progress"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span className="t-xs t-mute">回款进度</span>
          <span className="num-sm t-mute">{percent}%</span>
        </div>
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
                    {new Date(hearing.startsAt).toTimeString().slice(0, 5)}
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

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function daysFromToday(date: Date) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - startOfToday().getTime()) / 86_400_000);
}

function formatShortDate(date: Date) {
  const value = new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}

function formatMonthDay(date: Date) {
  const value = new Date(date);
  return `${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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
