"use client";

import Link from "next/link";
import type { Matter, PartyRole, LitigationStanding } from "@prisma/client";
import {
  matterCategoryColor,
  matterCategoryShort,
  matterStatusLabel,
  procedureTypeLabel as PROC_TYPE_LABEL
} from "@/lib/enums";
import { formatCurrency, cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";

export type MatterRow = Omit<Matter, "claimAmount"> & {
  primaryClient: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  cause: { id: string; name: string } | null;
  procedures: {
    id: string; type: string; caseNumber: string | null; status: string;
    stages?: { id: string; name: string; order: number; completedAt: Date | null }[];
    deadlines?: { title: string; dueAt: Date }[];
  }[];
  parties: { id: string; name: string; role: PartyRole; standing: LitigationStanding | null }[];
  archiveRecords?: { id: string }[];
  _count: { procedures: number };
  claimAmount: number | null;
  firmCaseNo: string | null;
  intakeDate: Date | null;
  latestHearingAt: Date | null;
};

type MetaColumn = "hearing" | "firmCaseNo";

// 墨案 03 效果图列结构：案件/案由 · 委托方 · 案号 · 程序 · 主办 · 标的 · 开庭时间 · 状态
const MATTER_ROW_GRID =
  "grid gap-x-3 gap-y-2 lg:grid-cols-[minmax(15rem,1.45fr)_9rem_minmax(9rem,1fr)_6.5rem_6rem_6rem_8rem_5.5rem] lg:items-center";
const MATTER_ROW_GRID_WITH_INTAKE =
  "grid gap-x-3 gap-y-2 lg:grid-cols-[8.5rem_minmax(16rem,1.1fr)_minmax(9rem,0.8fr)_minmax(13rem,1.2fr)_6.5rem_5.5rem] lg:items-center";
const MATTER_ROW_GRID_WITH_ARCHIVE =
  "grid gap-x-3 gap-y-2 lg:grid-cols-[8.5rem_minmax(16rem,1.1fr)_minmax(9rem,0.8fr)_minmax(13rem,1.2fr)_8.5rem_5.5rem] lg:items-center";

export function CaseListHeader({
  metaColumn = "hearing",
  showIntakeDateColumn = false,
  showArchiveDateColumn = false
}: {
  metaColumn?: MetaColumn;
  detailColumnLabel?: string;
  showIntakeDateColumn?: boolean;
  showArchiveDateColumn?: boolean;
}) {
  const metaHeader = <div>{metaColumn === "firmCaseNo" ? "所内案号" : "开庭时间"}</div>;

  // 与三种行栅格严格同列：默认 8 列（墨案 03 效果图）；收案/归档视图 6 列
  return (
    <div
      className={cn(
        showArchiveDateColumn
          ? MATTER_ROW_GRID_WITH_ARCHIVE
          : showIntakeDateColumn
            ? MATTER_ROW_GRID_WITH_INTAKE
            : MATTER_ROW_GRID,
        "hidden border-b border-border bg-[#FAFBFA] px-5 py-2.5 text-[10.5px] font-semibold tracking-[0.05em] text-[#98A3AD] lg:grid"
      )}
    >
      {showArchiveDateColumn ? (
        <>
          <div>归档时间</div>
          <div>案件 / 案由</div>
          <div>委托方</div>
          <div>案号</div>
          {metaHeader}
        </>
      ) : showIntakeDateColumn ? (
        <>
          <div>收案时间</div>
          <div>案件 / 案由</div>
          <div>委托方</div>
          <div>案由</div>
          <div>标的</div>
        </>
      ) : (
        <>
          <div>案件 / 案由</div>
          <div>委托方</div>
          <div>案号</div>
          <div>程序</div>
          <div>主办</div>
          <div>标的</div>
          {metaHeader}
        </>
      )}
      <div>状态</div>
    </div>
  );
}

export function MattersTable({
  items,
  metaColumn = "hearing",
  showIntakeDateColumn = false,
  showArchiveDateColumn = false
}: {
  items: MatterRow[];
  metaColumn?: MetaColumn;
  showIntakeDateColumn?: boolean;
  showArchiveDateColumn?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card py-20 text-center">
        <div className="text-base text-muted-foreground">没有匹配的案件</div>
        <div className="text-xs text-muted-foreground/70">
          点击右上角 <span className="text-foreground/80">新建收案</span> 开始
        </div>
      </div>
    );
  }

  // 墨案 03 效果图：默认（办理中/全部）视图用效果图原始 DOM 渲染（table + spine td）
  const isMockupView = !showIntakeDateColumn && !showArchiveDateColumn && metaColumn === "hearing";
  if (isMockupView) {
    return <MockupMattersTable items={items} />;
  }

  return (
    <div className="ll-surface overflow-hidden">
      <CaseListHeader
        metaColumn={metaColumn}
        showIntakeDateColumn={showIntakeDateColumn}
        showArchiveDateColumn={showArchiveDateColumn}
      />
      <ul>
        {items.map((m) => (
          <CaseListCard
            key={m.id}
            href={matterHref(m)}
            title={m.title}
            accent={matterCategoryColor[m.category]}
            status={{
              label:
                (m.archiveRecords?.length ?? 0) > 0
                  ? "归档中"
                  : matterStatusLabel[m.status],
              dot:
                (m.archiveRecords?.length ?? 0) > 0
                  ? MATTER_STATUS_DOT.ARCHIVED
                  : MATTER_STATUS_DOT[m.status]
            }}
            categoryShort={matterCategoryShort[m.category]}
            intakeDate={m.intakeDate}
            archivedAt={m.archivedAt}
            latestHearingAt={m.latestHearingAt}
            firmCaseNo={m.firmCaseNo}
            showTitleMeta={false}
            causeName={m.cause?.name ?? null}
            clientName={m.primaryClient?.name ?? null}
            ownerName={m.owner?.name ?? null}
            detailColumnLabel="案号"
            procedureLabel={m.procedures[0]?.caseNumber ?? null}
            procedureFallback="暂无案号"
            proceduresCount={m._count.procedures}
            claimAmount={m.claimAmount}
            metaColumn={metaColumn}
            showIntakeDateColumn={showIntakeDateColumn}
            showArchiveDateColumn={showArchiveDateColumn}
            inTable
          />
        ))}
      </ul>
    </div>
  );
}

// 墨案状态点（moan.css token 值；StatusChip 需拼 alpha，故用 hex 字面值）
const MATTER_STATUS_DOT: Record<MatterRow["status"], string> = {
  PENDING_ACCEPTANCE: "#96650B",
  IN_PROGRESS: "#1E56C8",
  ON_HOLD: "#98A3AD",
  CLOSED: "#1A7F45",
  ARCHIVED: "#8A6B3E" // 墨案：归档=青铜金
};

// 通用卡片：供 MattersTable + IntakesTable 共用
export function CaseListCard({
  href,
  title,
  accent,
  status,
  categoryShort,
  intakeDate,
  archivedAt = null,
  latestHearingAt = null,
  firmCaseNo = null,
  showTitleMeta = true,
  showTitleFirmCaseNo = true,
  causeName = null,
  clientName = null,
  ownerName = null,
  detailColumnLabel = "案号",
  procedureLabel = null,
  procedureFallback = "暂无案号",
  procedureValueClassName,
  showProcedureDots = true,
  proceduresCount = 0,
  claimAmount,
  metaColumn = "hearing",
  showIntakeDateColumn = false,
  showArchiveDateColumn = false,
  inTable = false
}: {
  href: string;
  title: string;
  accent: string;
  status: { label: string; dot: string };
  categoryShort: string;
  intakeDate: Date | null;
  archivedAt?: Date | null;
  latestHearingAt?: Date | null;
  firmCaseNo?: string | null;
  showTitleMeta?: boolean;
  showTitleFirmCaseNo?: boolean;
  causeName?: string | null;
  clientName?: string | null;
  ownerName?: string | null;
  detailColumnLabel?: string;
  procedureLabel?: string | null;
  procedureFallback?: string;
  procedureValueClassName?: string;
  showProcedureDots?: boolean;
  proceduresCount?: number;
  claimAmount: number | null;
  metaColumn?: MetaColumn;
  showIntakeDateColumn?: boolean;
  showArchiveDateColumn?: boolean;
  inTable?: boolean;
}) {
  const hasLeadingDateColumn = showIntakeDateColumn || showArchiveDateColumn;
  const metaCell = showIntakeDateColumn ? null : (
    <DataCell label={metaColumn === "firmCaseNo" ? "所内案号" : "开庭时间"}>
      {metaColumn === "firmCaseNo" ? (
        <span className="font-mono tabular-nums text-foreground/75">
          {firmCaseNo || "—"}
        </span>
      ) : (
        <span
          className={cn(
            "font-mono tabular-nums",
            latestHearingAt ? "text-primary" : "text-muted-foreground/55"
          )}
        >
          {formatDateTime(latestHearingAt)}
        </span>
      )}
    </DataCell>
  );

  // 墨案案卷脊：状态色竖条（PENDING=amber / IN_PROGRESS=blue / ON_HOLD=slate / CLOSED=green / ARCHIVED=bronze）
  const spineColor =
    status.label === "已归档" ? "#8A6B3E" : accent;

  return (
    <li
      className={cn("ll-spine-row", inTable ? "border-t border-border first:border-t-0" : "card")}
      style={{ "--ll-spine": spineColor } as React.CSSProperties}
    >
      <Link
        href={href}
        className={cn(
          "group block transition-colors",
          inTable ? "px-5 py-3 hover:bg-muted" : "rounded-lg px-4 py-3 hover:bg-muted"
        )}
      >
        <div
          className={
            showArchiveDateColumn
              ? MATTER_ROW_GRID_WITH_ARCHIVE
              : showIntakeDateColumn
                ? MATTER_ROW_GRID_WITH_INTAKE
                : MATTER_ROW_GRID
          }
        >
          {hasLeadingDateColumn ? (
            <DataCell label={showArchiveDateColumn ? "归档时间" : "收案时间"}>
              <span className="font-mono tabular-nums text-foreground/75">
                {formatDate(showArchiveDateColumn ? archivedAt : intakeDate)}
              </span>
            </DataCell>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden
                className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border px-1 text-[10.5px] font-medium leading-none"
                style={{
                  background: `${accent}14`,
                  borderColor: `${accent}66`,
                  color: accent
                }}
              >
                {categoryShort}
              </span>
              <div className="min-w-0">
                <span className="block min-w-0 truncate text-[13px] font-semibold leading-5 text-foreground">
                  {title || "（未命名）"}
                </span>
                {causeName ? (
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                    {causeName}
                  </span>
                ) : null}
                {showTitleMeta ? (
                  <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground tabular">
                    {showTitleFirmCaseNo && firmCaseNo ? firmCaseNo : formatDate(intakeDate)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {hasLeadingDateColumn ? (
            <>
              <DataCell label="客户">
                <OwnerCell name={clientName} fallback="未关联客户" />
              </DataCell>
              <DataCell label={detailColumnLabel}>
                <span
                  className={cn(
                    "block truncate text-[12px] text-muted-foreground",
                    procedureValueClassName ?? "font-mono tabular-nums"
                  )}
                >
                  {procedureLabel ?? procedureFallback}
                </span>
              </DataCell>
              {showArchiveDateColumn ? metaCell : null}
              {showArchiveDateColumn ? null : (
                <DataCell label="标的">
                  <span className="font-mono text-[12px] tabular-nums text-foreground/75">
                    {claimAmount != null ? formatCurrency(claimAmount, { compact: true }) : "—"}
                  </span>
                </DataCell>
              )}
            </>
          ) : (
            <>
              <DataCell label="委托方">
                <OwnerCell name={clientName} fallback="未关联客户" />
              </DataCell>

              <DataCell label={detailColumnLabel}>
                <span
                  className={cn(
                    "block truncate text-[12px] text-muted-foreground",
                    procedureValueClassName ?? "font-mono tabular-nums"
                  )}
                >
                  {procedureLabel ?? procedureFallback}
                </span>
              </DataCell>

              <DataCell label="程序">
                <span className="flex min-w-0 items-center gap-1.5">
                  {showProcedureDots ? <span className="ll-dot bg-primary" /> : null}
                  {showProcedureDots && proceduresCount > 1 ? <span className="ll-dot bg-primary/40" /> : null}
                  <span className="truncate text-[12px] text-muted-foreground">
                    {proceduresCount > 0 ? `${proceduresCount} 个程序` : "—"}
                  </span>
                </span>
              </DataCell>

              <DataCell label="主办">
                <OwnerCell name={ownerName} fallback="—" plain />
              </DataCell>

              <DataCell label="标的">
                <span className="block font-mono text-[12px] tabular-nums text-foreground/75">
                  {claimAmount != null ? formatCurrency(claimAmount, { compact: true }) : "—"}
                </span>
              </DataCell>

              {metaCell}
            </>
          )}

          <DataCell label="状态">
            <StatusChip label={status.label} dot={status.dot} />
          </DataCell>
        </div>
      </Link>
    </li>
  );
}

/** 墨案 03 效果图：人名列 = 圆形首字头像 + 姓名（plain 时仅姓名） */
function OwnerCell({ name, fallback, plain = false }: { name: string | null; fallback: string; plain?: boolean }) {
  const label = name ?? fallback;
  if (plain && !name) return <span className="text-[12px] text-muted-foreground/55">{fallback}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {!plain ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-primary">
          {label.charAt(0)}
        </span>
      ) : null}
      <span className="truncate text-[12.5px] text-muted-foreground">{label}</span>
    </span>
  );
}

function DataCell({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground lg:block", className)}>
      <span className="shrink-0 text-[11px] text-muted-foreground/60 lg:hidden">
        {label}：
      </span>
      {children}
    </div>
  );
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("zh-CN");
}

function formatDateTime(value: Date | null) {
  if (!value) return "暂无开庭";
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function StatusChip({ label, dot }: { label: string; dot: string }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[10.5px]"
      style={{
        background: `${dot}12`,
        borderColor: `${dot}55`,
        color: dot
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}

/* ============ 墨案 03 效果图：列表 DOM 原样移植（真 table + 案卷脊 + 阶段进度 + 期限胶囊） ============ */
const MOCKUP_STATUS_BADGE: Record<MatterRow["status"], string> = {
  PENDING_ACCEPTANCE: "b-amber",
  IN_PROGRESS: "b-blue",
  ON_HOLD: "b-slate",
  CLOSED: "b-green",
  ARCHIVED: "b-bronze"
};

export function MockupMattersTable({ items }: { items: MatterRow[] }) {
  if (items.length === 0) {
    return (
      <div className="ll-surface flex flex-col items-center gap-2 py-20 text-center">
        <div className="text-base text-muted-foreground">没有匹配的案件</div>
        <div className="text-xs text-muted-foreground/70">
          点击右上角 <span className="text-foreground/80">新建收案</span> 开始
        </div>
      </div>
    );
  }
  return (
    <div className="ll-surface overflow-hidden">
      <table className="table mtable">
        <thead>
          <tr>
            <th style={{ width: "26%" }}>案件 / 案由</th>
            <th style={{ width: "13%" }}>委托方</th>
            <th style={{ width: "15%" }}>案号</th>
            <th style={{ width: "12%" }}>程序 · 阶段</th>
            <th style={{ width: "10%" }}>主办 / 协办</th>
            <th style={{ width: "9%" }} className="th-num">标的额</th>
            <th style={{ width: "9%" }}>最近期限</th>
            <th style={{ width: "6%" }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <MockupMatterRow key={m.id} m={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MockupMatterRow({ m }: { m: MatterRow }) {
  const now = Date.now();
  const day = 86_400_000;
  const proc = m.procedures[0] ?? null;
  const stages = [...(proc?.stages ?? [])].sort((a, b) => a.order - b.order);
  const doneCount = stages.filter((s) => s.completedAt).length;
  const currentStage = stages.find((s) => !s.completedAt) ?? null;
  const nearest = (m.procedures.flatMap((p) => p.deadlines ?? []).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0]) ?? null;
  const days = nearest ? Math.ceil((nearest.dueAt.getTime() - now) / day) : null;
  const overdue = days != null && days < 0;
  const soon = days != null && days >= 0 && days <= 7;

  const procLabel = proc ? (PROC_TYPE_LABEL[proc.type as keyof typeof PROC_TYPE_LABEL] ?? proc.type) : null;
  const stageLabel = proc
    ? currentStage
      ? currentStage.name
      : stages.length > 0
        ? "全部环节完成"
        : "—"
    : "—";
  // 阶段进度条（效果图 stage-track：teal 实心=已完成占比）
  const segTotal = 5;
  const segDone = stages.length > 0 ? Math.max(doneCount > 0 ? 1 : 0, Math.round((doneCount / stages.length) * segTotal)) : 0;

  const spineColor =
    m.status === "ARCHIVED" ? "#8A6B3E"
    : m.status === "PENDING_ACCEPTANCE" ? "#96650B"
    : m.status === "CLOSED" ? "#1A7F45"
    : m.status === "ON_HOLD" ? "#98A3AD"
    : "#1E56C8";

  return (
    <tr className="group transition-colors hover:bg-muted/50">
      <td className="relative px-4 py-3 pl-[18px]">
        {/* 案卷脊（td 内绝对定位，规避 tr 伪元素错位） */}
        <span aria-hidden className="absolute left-0 top-[10px] bottom-[10px] w-[3px] rounded-r-[2px]" style={{ background: spineColor }} />
        <Link href={matterHref(m)} className="block min-w-0 no-underline">
          <span className="block truncate text-[13px] font-semibold leading-5 text-foreground">{m.title || "（未命名）"}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
            {m.cause?.name ?? m.causeFreeText ?? "—"}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] leading-4 text-muted-foreground/70 tabular">{m.internalCode}</span>
        </Link>
      </td>
      <td className="max-w-[10rem] truncate px-4 py-3 text-[12.5px] text-foreground/85">{m.primaryClient?.name ?? "未关联客户"}</td>
      <td className="px-4 py-3">
        <span className="block truncate font-mono text-[12px] text-muted-foreground tabular">{proc?.caseNumber ?? "—"}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <span className="whitespace-nowrap text-[12px] text-foreground/80">
            {procLabel ? `${procLabel} · ${stageLabel}` : "—"}
          </span>
          {stages.length > 0 ? (
            <div className="stage-track" aria-hidden>
              {Array.from({ length: segTotal }, (_, i) => (
                <i key={i} className={i < segDone ? "done" : undefined} />
              ))}
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        {m.owner ? (
          <span className="flex items-center gap-1.5">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-[9.5px] font-semibold text-primary">
              {m.owner.name.charAt(0)}
            </span>
            <span className="truncate text-[12.5px] text-foreground/85">{m.owner.name}</span>
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/55">—</span>
        )}
      </td>
      <td className="td-num money px-4 py-3">
        {m.claimAmount != null ? formatCurrency(m.claimAmount, { compact: true }) : "—"}
      </td>
      <td className="px-4 py-3">
        {days == null ? (
          <span className="text-[12px] text-muted-foreground/55">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className={`ladder ${overdue ? "l-red" : soon ? "l-amber" : "l-blue"}`} aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <i key={i} className={i < (overdue ? 4 : soon ? 3 : 2) ? "on" : undefined} />
              ))}
            </div>
            <span
              className="whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular"
              style={
                overdue
                  ? { color: "#B42318", background: "#FBECE9" }
                  : soon
                    ? { color: "#96650B", background: "#FAF0DB" }
                    : { color: "#68747F", background: "#E9EDEB" }
              }
              title={nearest.title}
            >
              {overdue ? `逾期 ${Math.abs(days)} 天` : days === 0 ? "今天" : `${days} 天`}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`badge ${MOCKUP_STATUS_BADGE[m.status]}`}>
          <span className="bdot" />
          {(m.archiveRecords?.length ?? 0) > 0 ? "归档中" : matterStatusLabel[m.status]}
        </span>
      </td>
    </tr>
  );
}
