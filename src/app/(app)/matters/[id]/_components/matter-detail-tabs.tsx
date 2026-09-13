"use client";
import Link from "next/link";
import { hasCustomPermission, type RoleGrant } from "@/lib/roles/catalog";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClientType, Prisma } from "@prisma/client";
import {
  ArrowLeft,
  CircleDollarSign,
  Clock3,
  Gavel,
  Pencil,
  Plus,
  Users,
  X
} from "lucide-react";
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
import { ProcedureStageChain } from "./procedure-stage-chain";
import { ProcedureWorkflowPanel } from "./procedure-workflow-panel";
import type { WorkflowPreservationCase } from "./procedure-workflow-panel";
import { MatterSignalStrip, type MatterSignal } from "./matter-signal-strip";

import { ApprovalsPanel } from "./approvals-panel";
import type { SealContractItem, ExpressItem } from "./info-extras";
import { AddProcedureSheet } from "./procedure-forms";
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
  signals,
  reviewNode
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
  /** 墨案 04 ②：风险信号条（卷宗头之下、程序链之上），数据在服务端算好 */
  signals: MatterSignal[];
  /** AI 审查总览（服务端渲染节点），置于三栏之下的附属信息区 */
  reviewNode?: React.ReactNode;
}) {
  const allowed = (key: import("@/lib/roles/catalog").PermissionKey) => hasCustomPermission({ role: currentUserRole ?? "", rolePermissions }, key);
  const [selectedProcId, setSelectedProcId] = useState<string | null>(null);
  const [addProcOpen, setAddProcOpen] = useState(false);
  const [matterEditorOpen, setMatterEditorOpen] = useState(false);
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
  const [archiveOpen, setArchiveOpen] = useState(false);

  const engagedProcedures = matter.procedures
    .filter((p) => p.engagement === "ENGAGED")
    .sort((a, b) => a.order - b.order);

  // 默认选中第一个在办程序（若有）
  const currentProcedure: ProcedureItem | null = selectedProcId
    ? engagedProcedures.find((p) => p.id === selectedProcId) ?? null
    : engagedProcedures[0] ?? null;
  const canEditMatterInfo = canLeadThisMatter;
  const canOpenUnifiedEditor =
    canEditMatterInfo ||
    canOwnThisMatter ||
    Boolean(currentProcedure && canAssociateThisMatter);

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
          stageId: d.stageId ?? null
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

  return (
    <div className="space-y-4">
      {/* 案件详情是每天要开几十次的页面，页面级入场动画只会让它显得慢，故不加动效 */}
      {/* 墨案 04：卷宗头（返回 / 宋体标题 / 编号行 / 徽章行 / 横向 meta / 右上操作） */}
      <header className="rounded-xl border border-[#E8ECEA] bg-card px-5 py-4 shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link href="/matters" className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" />返回案件列表
            </Link>
            <h1
              className="mt-1 truncate text-[23px] font-bold leading-snug"
              style={{ fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif', letterSpacing: "0.01em" }}
              title={matter.title}
            >
              {matter.title}{matterCategoryKind(matter.category) !== "project" && "案"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 font-mono text-[11px] text-muted-foreground tabular">
              <span>{matter.internalCode}</span>
              {matter.firmCaseNo && <><span className="text-muted-foreground/40">·</span><span>所内 {matter.firmCaseNo}</span></>}
              {matter.procedures[0]?.caseNumber && <><span className="text-muted-foreground/40">·</span><span>{matter.procedures[0].caseNumber}</span></>}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="badge b-white">{matterCategoryLabel[matter.category]}</span>
              {matter.procedures[0] && <span className="badge b-white">{procedureTypeLabel[matter.procedures[0].type] ?? matter.procedures[0].type}</span>}
              {matter.ourStanding && <span className="badge b-teal">{litigationStandingLabel[matter.ourStanding]}</span>}
              <MatterStatusPill status={matter.status} />
              {matter.serviceStatus === "SERVICE_COMPLETED" && (
                <span className="badge b-bronze" title="服务轴与程序轴分离：服务已完成">服务已完成</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#E8ECEA] pt-2.5 text-[12px]">
              {[
                ["委托方", matter.primaryClient?.name ?? "—"],
                ["受理机构", matter.procedures[0]?.handlingAgency ?? "—"],
                ["收案", matter.intakeDate ? formatShortDate(matter.intakeDate) : "—"],
                ["合同额", finance.stats.contractAmount > 0 ? `¥${finance.stats.contractAmount.toLocaleString("zh-CN")}` : "—"],
                ["标的额", matter.claimAmount != null ? `¥${Number(matter.claimAmount).toLocaleString("zh-CN")}` : "—"],
                ["案由", matter.causeFreeText ?? matter.cause?.name ?? "—"]
              ].map(([k, v]) => (
                <span key={k as string} className="flex items-baseline gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{k}</span>
                  <span className="font-medium text-foreground">{v as string}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {canOpenUnifiedEditor && (
              <button type="button" onClick={() => setMatterEditorOpen(true)} className="btn btn-secondary btn-sm">
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />编辑信息
              </button>
            )}
            {currentUserRole && canLeadThisMatter && (
              <LifecycleActions matterId={matter.id} status={matter.status} serviceStatus={matter.serviceStatus} canArchive={canLeadThisMatter} />
            )}
          </div>
        </div>
      </header>

      {/* v1.1 UI（方案 B）：吸顶摘要条——标题滚出视野后，案件身份 +
          下一节点倒计时仍常驻可见 */}
      <MatterStickyBar
        title={matter.title}
        caseNumber={currentProcedure?.caseNumber ?? null}
        procedures={engagedProcedures}
      />

      {/* 归档状态 banner */}
      {latestArchive && (
        <div>
          <ArchiveStatusBanner
            record={latestArchive}
            onReArchive={
              latestArchive.status === "REJECTED" &&
              canLeadThisMatter
                ? () => setArchiveOpen(true)
                : undefined
            }
          />
        </div>
      )}

      {/* 墨案 04 ②：信号条（紧跟卷宗头） */}
      <MatterSignalStrip signals={signals} />

      {/* 墨案 04 ③：程序链卡（卡头 = 程序切换 chips + 卡体 = 环节节点链） */}
      <section className="ll-surface px-5 pb-3 pt-3.5" aria-label="程序链">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] font-bold">程序链</span>
          <span className="hidden text-[10.5px] text-muted-foreground/80 sm:inline">
            程序间独立推进，材料互不共用
          </span>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
            {engagedProcedures.map((procedure) => {
              const isActive = currentProcedure?.id === procedure.id;
              const isDone = procedure.status === "CONCLUDED";
              const label = procedure.customLabel ?? procedureTypeLabel[procedure.type];
              return (
                <span
                  key={procedure.id}
                  className={cn(
                    "group/proc relative inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] whitespace-nowrap",
                    isActive
                      ? "border-[#10233A] bg-[#10233A] font-semibold text-white"
                      : isDone
                        ? "cursor-pointer border-transparent bg-muted text-muted-foreground hover:bg-muted/80"
                        : "cursor-pointer border-[#DDE3E0] bg-card text-muted-foreground hover:border-[#CFD7D3] hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#4FC3C0]" aria-hidden />
                  )}
                  <button type="button" onClick={() => setSelectedProcId(procedure.id)}>
                    <span className="max-w-[144px] truncate">{label}</span>
                  </button>
                  {canLeadThisMatter && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(deleteProcedureWarning(procedure, label))) {
                          handleDeleteProcedure(procedure.id);
                        }
                      }}
                      className={cn(
                        "pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity group-hover/proc:pointer-events-auto group-hover/proc:opacity-100",
                        isActive
                          ? "text-primary-foreground/75 hover:text-primary-foreground"
                          : "text-muted-foreground hover:text-destructive"
                      )}
                      title="删除此程序"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              );
            })}
            {canAssociateThisMatter ? (
              <button
                type="button"
                onClick={() => setAddProcOpen(true)}
                className="inline-flex h-[26px] items-center gap-1 rounded-full px-2 text-[11.5px] text-muted-foreground/70 transition-colors hover:text-foreground"
                title="新增程序"
              >
                <Plus className="h-3 w-3" strokeWidth={2.2} />
                新增程序
              </button>
            ) : null}
          </div>
        </div>
        <ProcedureStageChain procedure={currentProcedure} bare />
        {(!currentProcedure || currentProcedure.stages.filter((s) => s.status !== "HIDDEN").length < 2) && (
          <p className="px-1 py-1.5 text-[11px] text-muted-foreground">
            {currentProcedure
              ? "当前程序仅一个环节：环节期限、任务与材料直接在下方工作台处理。"
              : "暂无在办程序；点击右上「新增程序」开始办案流程。"}
          </p>
        )}
      </section>

      {/* 墨案 04 ④：三栏工作区（环节导航 196px | 环节工作区 | 辅助栏 272px） */}
      <ProcedureWorkflowPanel
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
        matterInfoNode={
          <InfoPanel
            matter={matter}
            currentProcedure={currentProcedure}
            canEdit={false}
            canManageRelatedMatters={canAssociateThisMatter}
            onEdit={() => setMatterEditorOpen(true)}
          />
        }
        railSlot={
          <MatterRailCards
            matter={matter}
            financeStats={finance.stats}
            parties={procedureParties}
            sealContracts={sealContracts}
            canManageTeam={canOwnThisMatter}
            onManageTeam={() => setMatterEditorOpen(true)}
          />
        }
      />

      {/* 附属信息区（全宽，位于三栏之下）：AI 审查 / 财务 / 审批 / 提醒备忘 / 证据 / 委托 / 自定义字段 */}
      <div className="space-y-3.5">
        {reviewNode}
        {allowed("finance.read") && (
          <FinancePanel
            matterId={matter.id}
            finance={finance}
            userOptions={userOptions}
            canRequestInvoice={canAssociateThisMatter}
          />
        )}
        <ApprovalsPanel
          matterId={matter.id}
          matterTitle={matter.title}
          sealContracts={sealContracts}
          canRequest={canAssociateThisMatter && allowed("seals.request")}
        />
        <ProcedureRemindersAndMemos
          matterId={matter.id}
          procedures={engagedProcedures}
          currentProcedureId={currentProcedure?.id ?? ""}
          expresses={expresses}
          canManage={canAssociateThisMatter}
        />
        {allowed("matters.read") && (
          <EvidencePanel
            matterId={matter.id}
            items={evidenceItems}
            documents={documents.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))}
            canManage={canAssociateThisMatter}
          />
        )}
        {allowed("matters.read") && (
          <EngagementPanel
            matterId={matter.id}
            client={matter.primaryClient ? { id: matter.primaryClient.id, name: matter.primaryClient.name } : null}
            engagements={engagements}
            canManage={canAssociateThisMatter}
          />
        )}
        {hasCustomFields && (
          <CustomFieldsPanel
            matterId={matter.id}
            defs={customFieldDefs}
            values={customValues}
            canEdit={canLeadThisMatter}
          />
        )}
      </div>

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
            teamAccessRestricted: (matter as { teamAccessRestricted?: boolean }).teamAccessRestricted ?? false
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

const SEAL_STATUS: Record<string, { label: string; seal: string; sealText: string; badge: string | null }> = {
  PENDING: { label: "审批中", seal: "#96650B", sealText: "待 审", badge: null },
  APPROVED: { label: "已批准", seal: "#007B7F", sealText: "审 毕", badge: null },
  STAMPED: { label: "已用印", seal: "#007B7F", sealText: "用 印", badge: "b-green" },
  REJECTED: { label: "已驳回", seal: "#B42318", sealText: "驳 回", badge: "b-outline-red" },
  CANCELLED: { label: "已取消", seal: "#5B6B75", sealText: "取 消", badge: null }
};

/**
 * 墨案 04 rail：右辅助栏四卡（团队 / 当事人 / 财务速览 / 最近审批）。
 * 只读速览；管理动作全部走「管理」链接打开统一编辑器，不在栏内做业务操作。
 */
function MatterRailCards({
  matter,
  financeStats,
  parties,
  sealContracts,
  canManageTeam,
  onManageTeam
}: {
  matter: MatterPayload;
  financeStats: FinancePayload["stats"];
  parties: ReturnType<typeof buildProcedurePartyOptions>;
  sealContracts: SealContractItem[];
  canManageTeam: boolean;
  onManageTeam: () => void;
}) {
  // —— 团队（主办置顶，去重）——
  const roleOrder = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = matter.members.map((m) => ({ id: m.userId, name: m.user.name, matterRole: m.role }));
  if (matter.owner && !members.some((m) => m.id === matter.ownerId)) {
    members.unshift({ id: matter.owner.id, name: matter.owner.name, matterRole: "LEAD" });
  }
  members.sort((a, b) => roleOrder[a.matterRole] - roleOrder[b.matterRole]);
  const avatarTone: Record<string, string> = {
    LEAD: "bg-[#E4F1F0] text-[#005054]",
    CO_LEAD: "bg-[#F0EAFB] text-[#6C3FC5]",
    ASSISTANT: "bg-[#FBF1DC] text-[#96650B]"
  };
  const roleTag: Record<string, string> = { LEAD: "b-teal", CO_LEAD: "b-slate", ASSISTANT: "b-slate" };

  // —— 当事人（委托方在前，最多展示 6 方）——
  const railPartyRows = [...parties]
    .sort((a, b) => (a.role === "CLIENT_PARTY" ? -1 : 0) - (b.role === "CLIENT_PARTY" ? -1 : 0))
    .slice(0, 6);

  // —— 财务速览 ——
  const contract = financeStats.contractAmount;
  const received = financeStats.received;
  const receivable = financeStats.receivable;
  const outstanding = Math.max(0, receivable - received);
  const progressBase = receivable > 0 ? receivable : contract;
  const receivedPercent = progressBase > 0 ? Math.min(100, Math.round((received / progressBase) * 100)) : 0;
  const money = (n: number) => (n > 0 ? `¥${n.toLocaleString("zh-CN")}` : "—");

  // —— 最近审批（最近一次用章申请）——
  const latestSeal = sealContracts[0] ?? null;
  const sealMeta = latestSeal ? SEAL_STATUS[latestSeal.status] ?? SEAL_STATUS.PENDING : null;

  return (
    <>
      <section className="rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <header className="flex items-center gap-1.5 border-b border-[#E8ECEA] px-3.5 py-2.5 text-[12.5px] font-bold">
          <Users className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.8} />
          团队
          {canManageTeam && (
            <button
              type="button"
              onClick={onManageTeam}
              className="ml-auto text-[11px] font-medium text-[#005054] hover:underline"
            >
              管理
            </button>
          )}
        </header>
        {members.length === 0 ? (
          <p className="px-3.5 py-4 text-[11.5px] text-muted-foreground">暂无团队成员</p>
        ) : (
          members.map((m) => (
            <div key={`${m.id}-${m.matterRole}`} className="flex items-center gap-2 px-3.5 py-[7px]">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${avatarTone[m.matterRole]}`}>
                {m.name.trim().charAt(0) || "—"}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold">{m.name}</div>
                <div className="text-[10.5px] text-muted-foreground">{matterTeamRoleDescription(m.matterRole)}</div>
              </div>
              <span className={`badge ${roleTag[m.matterRole]} ml-auto shrink-0 !text-[10px]`}>
                {matterTeamRoleLabel(m.matterRole)}
              </span>
            </div>
          ))
        )}
        <p className="border-t border-[#E8ECEA] px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {(matter as { teamAccessRestricted?: boolean }).teamAccessRestricted
            ? "本案件为受限事项，不进入团队汇总视图"
            : "团队只读成员可在团队汇总中查看本案件正文"}
        </p>
      </section>

      <section className="rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <header className="flex items-center gap-1.5 border-b border-[#E8ECEA] px-3.5 py-2.5 text-[12.5px] font-bold">
          <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-current text-[9px] text-muted-foreground" aria-hidden>
            i
          </span>
          当事人
        </header>
        {railPartyRows.length === 0 ? (
          <p className="px-3.5 py-4 text-[11.5px] text-muted-foreground">暂未登记当事人</p>
        ) : (
          railPartyRows.map((party) => {
            const isClient = party.role === "CLIENT_PARTY";
            const roleText = party.standing ? litigationStandingLabel[party.standing] : PARTY_ROLE_LABEL[party.role] ?? "当事人";
            const agent = party.legalRep
              ? `法定代表人 ${party.legalRep}`
              : party.contactName
                ? `联系人 ${party.contactName}`
                : null;
            return (
              <div key={party.id} className="border-b border-[#E8ECEA] px-3.5 py-2 last:border-b-0">
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span className={`h-[7px] w-[7px] rounded-full ${isClient ? "bg-[#007B7F]" : "bg-[#8296A1]"}`} aria-hidden />
                  {roleText}
                  {isClient && <span className="text-[#005054]">（委托方）</span>}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] font-semibold" title={party.name}>{party.name}</div>
                {agent && <div className="mt-px truncate text-[11px] text-muted-foreground">{agent}</div>}
              </div>
            );
          })
        )}
      </section>

      <section className="rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <header className="flex items-center gap-1.5 border-b border-[#E8ECEA] px-3.5 py-2.5 text-[12.5px] font-bold">
          <CircleDollarSign className="h-[15px] w-[15px] text-muted-foreground" strokeWidth={1.8} />
          财务速览
          <Link href="/finance" className="ml-auto text-[11px] font-medium text-[#005054] hover:underline">
            明细
          </Link>
        </header>
        <div className="flex items-baseline justify-between px-3.5 pt-2">
          <span className="text-[11.5px] text-muted-foreground">合同额</span>
          <span className="font-mono text-[13px] font-semibold tabular">{money(contract)}</span>
        </div>
        <div className="flex items-baseline justify-between px-3.5 pt-1.5">
          <span className="text-[11.5px] text-muted-foreground">已实收</span>
          <span className="font-mono text-[13px] font-semibold tabular text-[#1A7F45]">{money(received)}</span>
        </div>
        <div className="flex items-baseline justify-between px-3.5 pt-1.5">
          <span className="text-[11.5px] text-muted-foreground">待收</span>
          <span className="font-mono text-[13px] font-semibold tabular text-[#96650B]">{money(outstanding)}</span>
        </div>
        <div className="flex items-baseline justify-between px-3.5 pt-1.5">
          <span className="text-[11.5px] text-muted-foreground">已开票</span>
          <span className="font-mono text-[13px] font-semibold tabular">{money(financeStats.invoiced)}</span>
        </div>
        <div className="px-3.5 pb-3 pt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#EDF1EF]">
            <div className="h-full rounded-full bg-[#007B7F]" style={{ width: `${receivedPercent}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>回款进度</span>
            <span className="font-mono tabular">{receivedPercent}%</span>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <header className="flex items-center gap-1.5 border-b border-[#E8ECEA] px-3.5 py-2.5 text-[12.5px] font-bold">
          <span className="text-[13px] leading-none text-muted-foreground" aria-hidden>✓</span>
          最近审批
        </header>
        {latestSeal && sealMeta ? (
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span
              className="flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-full border-2 text-[8.5px] font-bold leading-tight"
              style={{ borderColor: sealMeta.seal, color: sealMeta.seal }}
              aria-hidden
            >
              <span className="text-[10px]">★</span>
              <span>{sealMeta.sealText}</span>
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold" title={latestSeal.documentTitle}>
                用章 · {latestSeal.documentTitle}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {latestSeal.code} · {formatMonthDay(latestSeal.createdAt)} · {sealMeta.label}
              </div>
              {sealMeta.badge && (
                <span className={`badge ${sealMeta.badge} mt-1.5 !text-[10px]`}>
                  {latestSeal.stampedDoc ? "已用印回填" : sealMeta.label}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="px-3.5 py-4 text-[11.5px] text-muted-foreground">暂无用章审批记录</p>
        )}
      </section>
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
      setPinned(el.getBoundingClientRect().top < 56);
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
    days === null ? "" : days < 0 || days <= 7 ? "text-destructive" : days <= 30 ? "text-amber-600" : "text-muted-foreground";
  const deadlineText =
    days === null ? "" : days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`;

  return (
    <div ref={wrapRef} className="h-0 w-full" aria-hidden={!pinned}>
      {pinned && rect && (
        <div className="fixed top-12 z-10" style={{ left: rect.left, width: rect.width }}>
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-background/90 px-3 py-1.5 shadow-[var(--shadow-low)] backdrop-blur">
            <span className="min-w-0 truncate text-[12.5px] font-medium" title={title}>
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

function MatterStatusPill({ status }: { status: MatterPayload["status"] }) {
  const map: Record<MatterPayload["status"], { label: string; cls: string }> = {
    PENDING_ACCEPTANCE: {
      label: matterStatusLabel.PENDING_ACCEPTANCE,
      cls: "bg-amber-500/15 text-amber-700 border-amber-500/30"
    },
    IN_PROGRESS: {
      label: matterStatusLabel.IN_PROGRESS,
      cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
    },
    ON_HOLD: {
      label: matterStatusLabel.ON_HOLD,
      cls: "bg-slate-400/15 text-slate-700 border-slate-400/30"
    },
    CLOSED: {
      label: matterStatusLabel.CLOSED,
      cls: "bg-blue-500/15 text-blue-700 border-blue-500/30"
    },
    ARCHIVED: {
      label: matterStatusLabel.ARCHIVED,
      cls: "bg-purple-500/15 text-purple-700 border-purple-500/30"
    }
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium leading-none",
        m.cls
      )}
    >
      {m.label}
    </span>
  );
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
