"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClientType, Prisma } from "@prisma/client";
import {
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Gavel,
  Landmark,
  Plus,
  Pencil,
  Users,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  matterStatusLabel,
  procedureTypeLabel,
  matterCategoryKind,
  matterCategoryLabel
} from "@/lib/enums";
import { cn, formatCurrency } from "@/lib/utils";
import { InfoPanel } from "./info-panel";
import { FinancePanel } from "./finance-panel";
import { ProcedureRemindersAndMemos } from "./procedure-content";
import { ProcedurePartiesCard } from "./procedure-info-panel";
import { ProcedureWorkflowPanel } from "./procedure-workflow-panel";
import type { WorkflowPreservationCase } from "./procedure-workflow-panel";

import { ApprovalsPanel } from "./approvals-panel";
import type { SealContractItem, ExpressItem } from "./info-extras";
import { AddProcedureSheet } from "./procedure-forms";
import { deleteProcedure } from "@/server/procedures/actions";
import { useRouter } from "next/navigation";
import { CustomFieldsPanel } from "./custom-fields-panel";
import { LifecycleActions } from "./lifecycle-actions";
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

type MatterPayload = Omit<MatterPayloadBase, "claimAmount"> & {
  claimAmount: number | null;
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
    user: { id: string; name: string; role: string };
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

type UserOption = { id: string; name: string; role: string };

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
  canAssociateThisMatter,
  canLeadThisMatter,
  canOwnThisMatter,
  sealContracts,
  expresses,
  latestArchive,
  customFieldDefs,
  preservationCases
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
}) {
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
  const causeLabel = matter.cause?.name ?? matter.causeFreeText ?? "未填写案由";

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

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
      <header className="ll-hero-surface px-5 py-4">
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>{matterCategoryLabel[matter.category]}</span>
              {matter.primaryClient?.name ? (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{matter.primaryClient.name}</span>
                </>
              ) : null}
              {matter.intakeDate ? (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>收案 {formatShortDate(matter.intakeDate)}</span>
                </>
              ) : null}
            </div>
            <h1 className="truncate text-[20px] font-semibold leading-tight" title={matter.title}>
              {matter.title}
              {matterCategoryKind(matter.category) !== "project" && "案"}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MatterStatusPill status={matter.status} />
              <Badge variant="outline" className="h-6 rounded-full bg-card px-2 text-[11px] leading-none">
                {causeLabel}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {canOpenUnifiedEditor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMatterEditorOpen(true)}
                className="gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                编辑信息
              </Button>
            )}
            {currentUserRole && canLeadThisMatter && (
              <LifecycleActions
                matterId={matter.id}
                status={matter.status}
                canArchive={canLeadThisMatter}
              />
            )}
          </div>
        </div>
        <MatterKeypoints
          matter={matter}
          finance={finance}
          procedures={engagedProcedures}
          currentProcedureId={currentProcedure?.id ?? null}
        />
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

      {/* 主内容 + 右侧动作栏：主区承载办案内容，侧栏承载速览和即时动作 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <ProcedureChainBar
            procedures={engagedProcedures}
            currentProcedure={currentProcedure}
            roman={ROMAN}
            canAdd={canAssociateThisMatter}
            canDelete={canLeadThisMatter}
            onSelect={setSelectedProcId}
            onAdd={() => setAddProcOpen(true)}
            onDelete={handleDeleteProcedure}
          />

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
          />

          {currentProcedure && (
            <ProcedurePartiesCard
              procedure={currentProcedure}
              parties={procedureParties}
              canEdit={false}
              onEdit={() => setMatterEditorOpen(true)}
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

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">
          <MatterTeamCard
            matter={matter}
            canManage={canOwnThisMatter}
            onManage={() => setMatterEditorOpen(true)}
          />
          <ProcedureRemindersAndMemos
            matterId={matter.id}
            procedures={engagedProcedures}
            currentProcedureId={currentProcedure?.id ?? ""}
            expresses={expresses}
            canManage={canAssociateThisMatter}
          />
          <ApprovalsPanel
            matterId={matter.id}
            matterTitle={matter.title}
            sealContracts={sealContracts}
            canRequest={canAssociateThisMatter}
          />
          <FinancePanel
            matterId={matter.id}
            finance={finance}
            userOptions={userOptions}
            canRequestInvoice={canAssociateThisMatter}
            compact
          />
        </aside>
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
            ourStanding: matter.ourStanding ?? null
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
      {canLeadThisMatter && (
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
type DeadlineProgressItem = ProcedureItem["deadlines"][number] & {
  procedureLabel: string;
};

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

function ProcedureChainBar({
  procedures,
  currentProcedure,
  roman,
  canAdd,
  canDelete,
  onSelect,
  onAdd,
  onDelete
}: {
  procedures: ProcedureItem[];
  currentProcedure: ProcedureItem | null;
  roman: string[];
  canAdd: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const currentLabel = currentProcedure
    ? currentProcedure.caseNumber || currentProcedure.customLabel || procedureTypeLabel[currentProcedure.type]
    : "暂无当前程序";

  return (
    <section className="ll-surface overflow-hidden">
      <div className="flex min-h-[46px] flex-wrap items-center gap-1 px-3.5 py-2.5">
        <span className="mr-1 shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          程序
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {procedures.length === 0 ? (
            <span className="text-[11.5px] text-muted-foreground">暂无在办程序</span>
          ) : (
            procedures.map((procedure, index) => {
              const isActive = currentProcedure?.id === procedure.id;
              const isDone = procedure.status === "CONCLUDED";
              const label = procedure.customLabel ?? procedureTypeLabel[procedure.type];
              return (
                <div key={procedure.id} className="flex shrink-0 items-center gap-1">
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/45" strokeWidth={2} />
                  )}
                  <span
                    className={cn(
                      "group/proc relative inline-flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(0,123,127,0.18)]"
                        : isDone
                          ? "border-transparent bg-muted text-muted-foreground hover:bg-muted/80"
                          : "border-border bg-card text-muted-foreground hover:border-input hover:bg-muted"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(procedure.id)}
                      className="flex min-w-0 items-center gap-1"
                    >
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}
                      >
                        {roman[index] ?? index + 1}
                      </span>
                      <span className="max-w-[144px] truncate">{label}</span>
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/70" aria-hidden="true" />
                      )}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(deleteProcedureWarning(procedure, label))) {
                            onDelete(procedure.id);
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
                </div>
              );
            })
          )}
          {canAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="ml-1 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-dashed border-input text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              title="添加程序"
            >
              <Plus className="h-3 w-3" strokeWidth={1.8} />
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11.5px] text-muted-foreground">
          <span className="hidden sm:inline">当前：</span>
          <span className="max-w-[260px] truncate font-mono tabular">{currentLabel}</span>
        </div>
      </div>
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

function MatterKeypoints({
  matter,
  finance,
  procedures,
  currentProcedureId
}: {
  matter: MatterPayload;
  finance: FinancePayload;
  procedures: ProcedureItem[];
  currentProcedureId: string | null;
}) {
  const allDeadlines = procedures
    .flatMap((procedure) =>
      procedure.deadlines.map((deadline) => ({
        ...deadline,
        procedureLabel: procedure.customLabel ?? procedureTypeLabel[procedure.type]
      }))
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const nextDeadline =
    allDeadlines.find((deadline) => !deadline.completed && daysFromToday(deadline.dueAt) >= 0) ??
    allDeadlines.find((deadline) => !deadline.completed) ??
    null;
  const allHearings = procedures
    .flatMap((procedure) =>
      procedure.hearings.map((hearing) => ({
        ...hearing,
        procedureLabel: procedure.customLabel ?? procedureTypeLabel[procedure.type]
      }))
    )
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const firstHearing = allHearings[0] ?? null;
  const acceptedDate =
    procedures.find((procedure) => procedure.id === currentProcedureId)?.acceptedAt ??
    procedures.find((procedure) => procedure.acceptedAt)?.acceptedAt ??
    matter.firstAcceptedAt ??
    matter.intakeDate ??
    null;
  const feeTarget = finance.stats.receivable || finance.stats.contractAmount;
  const receivedPercent = feeTarget > 0
    ? Math.min(100, Math.round((finance.stats.received / feeTarget) * 100))
    : 0;

  return (
    <div className="relative z-[1] mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted/70 p-1 lg:grid-cols-4">
      <ProgressMetricCard
        icon={<Clock3 className="h-3 w-3" />}
        label={nextDeadline?.title ?? "最近期限"}
        value={deadlineValue(nextDeadline)}
        sub={deadlineSub(nextDeadline)}
        tone={deadlineTone(nextDeadline)}
      />
      <ProgressMetricCard
        icon={<Landmark className="h-3 w-3" />}
        label="立案日期"
        value={acceptedDate ? formatMonthDay(acceptedDate) : "—"}
        sub={acceptedDate ? String(new Date(acceptedDate).getFullYear()) : "未填写立案日期"}
      />
      <ProgressMetricCard
        icon={<CalendarClock className="h-3 w-3" />}
        label="首次开庭"
        value={firstHearing ? formatMonthDay(firstHearing.startsAt) : "—"}
        sub={firstHearing ? `${formatTime(firstHearing.startsAt)} · ${firstHearing.title}` : "暂无开庭安排"}
      />
      <ProgressMetricCard
        icon={<CircleDollarSign className="h-3 w-3" />}
        label="实收进度"
        value={`${receivedPercent}%`}
        sub={`${formatCurrency(finance.stats.received, { compact: true })} / ${feeTarget ? formatCurrency(feeTarget, { compact: true }) : "未设目标"}`}
        progress={receivedPercent}
      />
    </div>
  );
}

type MatterTeamMember = {
  id: string;
  name: string;
  matterRole: "LEAD" | "CO_LEAD" | "ASSISTANT";
};

function MatterTeamCard({
  matter,
  canManage,
  onManage
}: {
  matter: MatterPayload;
  canManage: boolean;
  onManage: () => void;
}) {
  const roleOrder = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members: MatterTeamMember[] = matter.members.map((member) => ({
    id: member.userId,
    name: member.user.name,
    matterRole: member.role
  }));

  if (matter.owner && !members.some((member) => member.id === matter.ownerId)) {
    members.unshift({
      id: matter.owner.id,
      name: matter.owner.name,
      matterRole: "LEAD"
    });
  }

  const sortedMembers = members.sort((a, b) => roleOrder[a.matterRole] - roleOrder[b.matterRole]);

  return (
    <section className="rounded-lg border border-border bg-card shadow-[var(--shadow-low)]">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Users className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
          办案团队
          <span className="ml-1 font-mono text-[11px] text-muted-foreground tabular">
            {sortedMembers.length}
          </span>
        </span>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onManage}
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-primary"
          >
            管理
          </Button>
        )}
      </header>

      {sortedMembers.length === 0 ? (
        <p className="px-3 py-5 text-center text-xs text-muted-foreground">暂无团队成员</p>
      ) : (
        <ul className="divide-y divide-border px-3 py-1">
          {sortedMembers.map((member) => (
            <li key={`${member.id}-${member.matterRole}`} className="flex items-center gap-2.5 py-2">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                  member.matterRole === "LEAD" && "bg-primary/10 text-primary",
                  member.matterRole === "CO_LEAD" && "bg-violet-500/10 text-violet-700",
                  member.matterRole === "ASSISTANT" && "bg-emerald-500/10 text-emerald-700"
                )}
              >
                {member.name.trim().charAt(0) || "—"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{member.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {matterTeamRoleDescription(member.matterRole)}
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 shrink-0 rounded-full px-1.5 text-[10px] font-normal",
                  member.matterRole === "LEAD" && "border-primary/25 bg-primary/10 text-primary",
                  member.matterRole === "CO_LEAD" && "border-violet-500/25 bg-violet-500/10 text-violet-700",
                  member.matterRole === "ASSISTANT" &&
                    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700"
                )}
              >
                {matterTeamRoleLabel(member.matterRole)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressMetricCard({
  icon,
  label,
  value,
  sub,
  tone,
  progress
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "warn" | "danger";
  progress?: number;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-md border border-border/70 bg-background/75 px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-colors",
        tone === "warn" &&
          "border-[#EDD9A6] bg-[#FBF1DC]",
        tone === "danger" &&
          "border-red-500/25 bg-red-500/[0.08]"
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-medium leading-4 text-muted-foreground">
          <span
            className={cn(
              "shrink-0 text-primary",
              tone === "warn" && "text-amber-700",
              tone === "danger" && "text-red-700"
            )}
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </div>
        <div
          className={cn(
            "truncate font-mono text-[14px] font-medium leading-5 text-foreground tabular",
            tone === "warn" && "text-amber-800",
            tone === "danger" && "text-red-800"
          )}
          title={value}
        >
          {value}
        </div>
        <div className="truncate font-mono text-[10.5px] leading-4 text-muted-foreground" title={sub}>
          {sub}
        </div>
      </div>
      {typeof progress === "number" ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-background/70">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function matterTeamRoleLabel(role: MatterTeamMember["matterRole"]) {
  if (role === "LEAD") return "主办";
  if (role === "CO_LEAD") return "协办";
  return "助理";
}

function matterTeamRoleDescription(role: MatterTeamMember["matterRole"]) {
  if (role === "LEAD") return "主办律师";
  if (role === "CO_LEAD") return "协办律师";
  return "律师助理";
}

function deadlineValue(deadline: DeadlineProgressItem | null) {
  if (!deadline) return "—";
  const days = daysFromToday(deadline.dueAt);
  if (days < 0) return `逾期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天";
  return `${days} 天`;
}

function deadlineSub(deadline: DeadlineProgressItem | null) {
  if (!deadline) return "暂无未完成期限";
  return formatShortDate(deadline.dueAt);
}

function deadlineTone(deadline: DeadlineProgressItem | null): "warn" | "danger" | undefined {
  if (!deadline) return undefined;
  const days = daysFromToday(deadline.dueAt);
  if (days < 0) return "danger";
  if (days <= 3) return "warn";
  return undefined;
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

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
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
