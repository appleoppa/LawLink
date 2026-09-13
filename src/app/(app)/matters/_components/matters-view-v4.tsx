"use client";

/**
 * 案件页壳（墨案 03 效果图 · 从零重写，替代旧 matters-view 的渲染路径）。
 * 布局 = 效果图：22px 页头 + 统计副文 + 导出/新建按钮 / 带计数的胶囊分段 /
 * 搜索 + 筛选胶囊 + 排序工具栏 / 档案架表格 / 分页栏。URL 为唯一筛选状态源。
 */
import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { MatterCategory } from "@prisma/client";
import { matterCategoryLabel } from "@/lib/enums";
import { MockupMattersTable, type MatterRow } from "./matters-table";
import { IntakesTable, type IntakeRow } from "./intakes-table";
import { IntakeWizard } from "@/app/(app)/intakes/_components/intake-wizard";
import { cn } from "@/lib/utils";

type Tab = "intake" | "active" | "archived" | "revision" | "all";
type SortBy = "hearing" | "intakeDate" | "claimAmount" | "archivedAt";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "intake", label: "待审批" },
  { key: "revision", label: "待补正" },
  { key: "archived", label: "已归档" }
];

const CATEGORIES: (MatterCategory | "ALL")[] = ["ALL", "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "intakeDate", label: "按收案时间" },
  { value: "hearing", label: "按开庭时间" },
  { value: "claimAmount", label: "按标的金额" },
  { value: "archivedAt", label: "按归档时间" }
];

const pillCls = "inline-flex h-[32px] items-center gap-1.5 rounded-full border border-[#CFD7D3] bg-card px-3 text-[12.5px] text-muted-foreground shadow-[0_1px_2px_rgba(12,25,39,0.05)] transition-colors hover:border-input hover:bg-muted [&>select]:max-w-[9rem] [&>select]:truncate [&>select]:bg-transparent [&>select]:text-[12.5px] [&>select]:text-foreground [&>select]:outline-none";

export function MattersViewV4({
  tab,
  matterData,
  intakeData,
  clientOptions,
  colleagues,
  tabCounts,
  readableTeams = [],
  initialFilters,
  autoOpenIntake
}: {
  tab: Tab;
  matterData?: { items: MatterRow[]; total: number; page: number; pageSize: number };
  intakeData?: { items: IntakeRow[]; total: number; page: number; pageSize: number };
  clientOptions: { id: string; name: string; type: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION" }[];
  colleagues: { id: string; name: string; role?: string; isTeammate?: boolean }[];
  tabCounts?: Partial<Record<Tab, number>>;
  readableTeams?: { id: string; name: string }[];
  initialFilters: {
    scope?: "all" | "mine" | "team";
    teamId?: string;
    ownerId?: string;
    search: string;
    category: MatterCategory | "ALL";
    status?: string;
    from?: string;
    to?: string;
    sortBy?: SortBy;
    sortDir?: "asc" | "desc";
  };
  autoOpenIntake?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [wizardOpen, setWizardOpen] = useState(Boolean(autoOpenIntake));
  const [searchInput, setSearchInput] = useState(initialFilters.search);

  const f = initialFilters;
  const data = tab === "intake" || tab === "revision" ? intakeData : matterData;
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const buildUrl = useCallback((o: Partial<Record<string, string | number | undefined>> & { page?: number }) => {
    const p = new URLSearchParams();
    const t = (o.tab as Tab) ?? tab;
    if (t !== "active") p.set("tab", t);
    if (((o.scope as string) ?? f.scope ?? "all") !== "all") p.set("scope", String((o.scope as string) ?? f.scope));
    if ((o.teamId as string) ?? f.teamId) p.set("teamId", String((o.teamId as string) ?? f.teamId));
    if ((o.ownerId as string) ?? f.ownerId) p.set("ownerId", String((o.ownerId as string) ?? f.ownerId));
    const search = o.search !== undefined ? String(o.search) : searchInput;
    if (search) p.set("search", search);
    const cat = o.category !== undefined ? String(o.category) : f.category;
    if (cat && cat !== "ALL") p.set("category", cat);
    const st = o.status !== undefined ? String(o.status) : f.status;
    if (st && st !== "ALL" && t === "all") p.set("status", st);
    const from = o.from !== undefined ? String(o.from) : f.from;
    const to = o.to !== undefined ? String(o.to) : f.to;
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const sb = (o.sortBy as SortBy) ?? f.sortBy ?? (t === "archived" ? "archivedAt" : t === "active" ? "hearing" : "intakeDate");
    p.set("sortBy", sb);
    p.set("sortDir", (o.sortDir as "asc" | "desc") ?? f.sortDir ?? "desc");
    const pg = o.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const qs = p.toString();
    return `/matters${qs ? `?${qs}` : ""}`;
  }, [tab, f, searchInput]);

  function go(o: Parameters<typeof buildUrl>[0]) {
    startTransition(() => router.replace(buildUrl(o)));
  }

  function closeWizard(open: boolean) {
    setWizardOpen(open);
    if (!open && autoOpenIntake) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState(null, "", url.toString());
    }
  }

  const exportUrl = (() => {
    const p = new URLSearchParams();
    if (tab !== "active") p.set("tab", tab);
    if ((f.scope ?? "all") !== "all") p.set("scope", f.scope!);
    if (f.teamId) p.set("teamId", f.teamId);
    if (f.ownerId) p.set("ownerId", f.ownerId);
    if (f.search) p.set("search", f.search);
    if (f.category && f.category !== "ALL") p.set("category", f.category);
    return `/api/matters/export?${p.toString()}`;
  })();

  const showStatus = tab === "all";

  return (
    <div className="space-y-3.5 pb-8">
      {/* 页头（效果图 03） */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">案件</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            共 <span className="font-mono font-semibold text-foreground">{total}</span> 件 · 当前范围「{TABS.find(t => t.key === tab)?.label}」 · 每页 {pageSize} 条
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportUrl} title="仅导出本人经办或原有管理权限范围内的案件；团队查看权不含导出" className="btn btn-secondary btn-sm">
            <Download className="h-3.5 w-3.5" />导出
          </a>
          <button type="button" onClick={() => setWizardOpen(true)} className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" />新建收案
          </button>
        </div>
      </div>

      {/* 分段（带计数，效果图 03 segmented） */}
      <div className="inline-flex gap-0.5 rounded-[10px] bg-[#E9EDEB] p-[3px]">
        {TABS.map(t => {
          const active = t.key === tab;
          return (
            <button key={t.key} type="button" onClick={() => go({ tab: t.key, page: 1 })}
              className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-[7px] px-3.5 text-[12.5px] transition-colors", active ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(12,25,39,0.08)]" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
              {typeof tabCounts?.[t.key] === "number" && <span className="font-mono text-[11px] tabular opacity-60">{tabCounts[t.key]}</span>}
            </button>
          );
        })}
      </div>

      {/* 工具栏（搜索 + 筛选胶囊 + 排序，效果图 03 ListToolbar） */}
      <div className="flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={e => { e.preventDefault(); go({ search: searchInput, page: 1 }); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="按名称、客户、编号搜索" className="h-[32px] w-[240px] rounded-full border border-[#CFD7D3] bg-card pl-9 pr-3 text-[12.5px] shadow-[0_1px_2px_rgba(12,25,39,0.05)] outline-none placeholder:text-[#98A3AD] focus:border-[#007B7F] focus:shadow-[0_0_0_3px_rgba(0,123,127,0.12)]" />
        </form>
        <label className={pillCls}>类别
          <select value={f.category} onChange={e => go({ category: e.target.value, page: 1 })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c === "ALL" ? "全部" : matterCategoryLabel[c]}</option>)}
          </select>
        </label>
        <label className={pillCls}>范围
          <select value={f.scope ?? "all"} onChange={e => go({ scope: e.target.value, teamId: "", page: 1 })}>
            <option value="all">全部可见</option><option value="mine">我经办</option><option value="team">按团队</option>
          </select>
        </label>
        {f.scope === "team" && readableTeams.length > 0 && (
          <label className={pillCls}>团队
            <select value={f.teamId ?? "ALL"} onChange={e => go({ teamId: e.target.value === "ALL" ? "" : e.target.value, page: 1 })}>
              <option value="ALL">全部团队</option>
              {readableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className={pillCls}>主办
          <select value={f.ownerId ?? "ALL"} onChange={e => go({ ownerId: e.target.value === "ALL" ? "" : e.target.value, page: 1 })}>
            <option value="ALL">全部</option>
            {colleagues.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        {showStatus && (
          <label className={pillCls}>状态
            <select value={f.status ?? "ALL"} onChange={e => go({ status: e.target.value, page: 1 })}>
              <option value="ALL">全部状态</option><option value="active">办理中</option><option value="closed">已结案</option><option value="archived">已归档</option>
            </select>
          </label>
        )}
        <label className={cn(pillCls, "ml-auto")}>排序
          <select value={f.sortBy ?? (tab === "archived" ? "archivedAt" : "intakeDate")} onChange={e => go({ sortBy: e.target.value, page: 1 })}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* 数据区：案件档案架 / 收案表 */}
      {tab === "intake" || tab === "revision" ? (
        <IntakesTable items={intakeData?.items ?? []} kind={tab === "revision" ? "revision" : "intake"} />
      ) : (
        <MockupMattersTable items={matterData?.items ?? []} />
      )}

      {/* 分页栏（效果图 03 pager） */}
      {total > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[#E8ECEA] bg-card px-4 py-2.5 shadow-[0_1px_2px_rgba(12,25,39,0.05)]">
          <span className="text-[11.5px] text-muted-foreground">第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条 · 共 {total} 件</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
              return <button key={p} type="button" onClick={() => go({ page: p })} className={cn("h-7 min-w-7 rounded-md px-1.5 font-mono text-[12px] tabular", p === page ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(12,25,39,0.08)] ring-1 ring-[#DDE3E0]" : "text-muted-foreground hover:bg-muted")}>{p}</button>;
            })}
            <button type="button" disabled={page >= totalPages} onClick={() => go({ page: page + 1 })} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <IntakeWizard open={wizardOpen} onOpenChange={closeWizard} clientOptions={clientOptions} colleagues={colleagues} />
    </div>
  );
}
