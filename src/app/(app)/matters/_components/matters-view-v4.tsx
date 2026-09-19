"use client";

/**
 * 案件页壳（墨案 03 效果图 · 从零重写，替代旧 matters-view 的渲染路径）。
 * 布局 = 效果图：22px 页头 + 统计副文 + 导出/新建按钮 / 带计数的胶囊分段 /
 * 搜索 + 筛选胶囊 + 排序工具栏 / 档案架表格 / 分页栏。URL 为唯一筛选状态源。
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowDownUp, ChevronDown, Columns3, Download, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader, Pager, Segmented } from "@/components/patterns/moan";
import { FilterSelect } from "@/components/patterns/filter-select";
import type { MatterCategory } from "@prisma/client";
import { matterCategoryLabel } from "@/lib/enums";
import { MATTER_COLUMNS, MockupMattersTable, type MatterColumn, type MatterRow } from "./matters-table";
import { IntakesTable, type IntakeRow } from "./intakes-table";
import { IntakeWizard } from "@/app/(app)/intakes/_components/intake-wizard";
import { cn } from "@/lib/utils";
import { useTopbarAction } from "@/components/layout/topbar-action";

type Tab = "intake" | "active" | "archived" | "revision" | "all";
type SortBy = "hearing" | "intakeDate" | "claimAmount" | "archivedAt";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "办理中" },
  { key: "intake", label: "收案中" },
  { key: "revision", label: "收案待补正" },
  { key: "archived", label: "已归档" }
];

const CATEGORIES: (MatterCategory | "ALL")[] = ["ALL", "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "intakeDate", label: "按收案时间" },
  { value: "hearing", label: "按开庭时间" },
  { value: "claimAmount", label: "按标的金额" },
  { value: "archivedAt", label: "按归档时间" }
];


export function MattersViewV4({
  tab,
  matterData,
  intakeData,
  clientOptions,
  colleagues,
  tabCounts,
  readableTeams = [],
  initialFilters,
  autoOpenIntake,
  initialClientId
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
  initialClientId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [wizardOpen, setWizardOpen] = useState(Boolean(autoOpenIntake));
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  useTopbarAction({ label: "新建收案", onClick: () => setWizardOpen(true) }, []);

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
      url.searchParams.delete("clientId");
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
  const isIntakeTab = tab === "intake" || tab === "revision";
  const [columns, setColumns] = useState<MatterColumn[]>(() => MATTER_COLUMNS.map((c) => c.key));
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("ll:matters:columns") ?? "null");
      if (Array.isArray(saved)) setColumns(saved.filter((k) => MATTER_COLUMNS.some((c) => c.key === k)));
    } catch {
      /* 本地偏好不可用时使用默认列 */
    }
  }, []);
  function toggleColumn(key: MatterColumn) {
    setColumns((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      try {
        window.localStorage.setItem("ll:matters:columns", JSON.stringify(next));
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }
  const currentSort = f.sortBy ?? (tab === "archived" ? "archivedAt" : tab === "active" ? "hearing" : "intakeDate");
  const sortOptions = SORTS.filter((o) => (o.value === "archivedAt" ? tab === "archived" : o.value === "hearing" ? tab === "active" || tab === "all" : !(o.value === "claimAmount" && tab === "archived")));
  const scopeLabel: Record<string, string> = { all: "全部可见", mine: "我经办", team: "按团队" };

  return (
    <div className="mo-list">
      <PageHeader
        title="案件"
        sub={<>共 <b>{tabCounts?.all ?? total}</b> 件 · 当前范围「{TABS.find((t) => t.key === tab)?.label}」<b>{total}</b> 件 · 每页 {pageSize} 条</>}
        actions={
          <>
            {tab === "archived" ? (
              <Link href="/archive" className="btn btn-secondary btn-sm" title="归档号、归档日期、结案原因与卷宗目录">
                <Archive />
                归档台账
              </Link>
            ) : null}
            {!isIntakeTab ? (
              <a href={exportUrl} title="仅导出本人经办或原有管理权限范围内的案件；团队查看权不含导出" className="btn btn-secondary btn-sm">
                <Download />
                导出
              </a>
            ) : null}
          </>
        }
      />

      <Segmented
        className="mb-3"
        items={TABS.map((t) => ({ key: t.key, label: t.label, count: typeof tabCounts?.[t.key] === "number" ? tabCounts[t.key] : null }))}
        value={tab}
        onChange={(key) => go({ tab: key, page: 1 })}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="mo-toolbar-input" onSubmit={(e) => { e.preventDefault(); go({ search: searchInput, page: 1 }); }}>
          <Search aria-hidden />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="按名称、案号、当事人搜索" aria-label="搜索案件" />
        </form>
        <FilterSelect label="案件类别" value={f.category !== "ALL" ? f.category : undefined} options={CATEGORIES.filter((c) => c !== "ALL").map((c) => ({ value: c, label: matterCategoryLabel[c as MatterCategory] }))} onChange={(v) => go({ category: v ?? "ALL", page: 1 })} />
        {f.scope === "team" && readableTeams.length > 0 ? (
          <FilterSelect label="团队" value={f.teamId} allLabel="全部获权团队" options={readableTeams.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => go({ teamId: v ?? "", page: 1 })} />
        ) : null}
        <FilterSelect label="主办" value={f.ownerId} options={colleagues.map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => go({ ownerId: v ?? "", page: 1 })} />
        <FilterSelect label="范围" clearable={false} value={f.scope ?? "all"} options={Object.entries(scopeLabel).map(([value, label]) => ({ value, label }))} onChange={(v) => go({ scope: v ?? "all", teamId: "", page: 1 })} />
        {showStatus ? (
          <FilterSelect label="状态" value={f.status && f.status !== "ALL" ? f.status : undefined} options={[{ value: "active", label: "办理中" }, { value: "closed", label: "已结案" }, { value: "archived", label: "已归档" }]} onChange={(v) => go({ status: v ?? "ALL", page: 1 })} />
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn("mo-filter-btn", (f.from || f.to) && "on")}>
              收案日期
              {f.from || f.to ? <span className="fv font-mono">{f.from ?? "…"} ~ {f.to ?? "…"}</span> : <ChevronDown aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="space-y-2.5">
              <label className="block text-[12px] text-[var(--t-secondary)]">
                起
                <Input type="date" defaultValue={f.from ?? ""} onChange={(e) => go({ from: e.target.value, page: 1 })} className="mt-1" />
              </label>
              <label className="block text-[12px] text-[var(--t-secondary)]">
                止
                <Input type="date" defaultValue={f.to ?? ""} onChange={(e) => go({ to: e.target.value, page: 1 })} className="mt-1" />
              </label>
              {f.from || f.to ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ from: "", to: "", page: 1 })}>清除日期</button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          <FilterSelect
            label="排序："
            clearable={false}
            icon={<ArrowDownUp aria-hidden />}
            value={currentSort}
            options={sortOptions.map((o) => ({ value: o.value, label: o.label.replace("按", "") }))}
            onChange={(v) => go({ sortBy: v, page: 1 })}
          />
          <button type="button" className="mo-filter-btn" onClick={() => go({ sortDir: f.sortDir === "asc" ? "desc" : "asc", page: 1 })} title="切换升序 / 降序" aria-label="切换排序方向">
            {f.sortDir === "asc" ? "升序" : "降序"}
          </button>
          {!isIntakeTab ? (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="mo-filter-btn">
                  <Columns3 aria-hidden />
                  列设置
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-2">
                <div className="px-1.5 pb-1.5 text-[11px] text-[var(--t-muted)]">显示列（保存在本机）</div>
                {MATTER_COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-[12.5px] hover:bg-[var(--bg-hover)]">
                    <Checkbox checked={columns.includes(c.key)} onCheckedChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>

      <div className="card overflow-hidden">
        {isIntakeTab ? (
          <IntakesTable items={intakeData?.items ?? []} kind={tab === "revision" ? "revision" : "intake"} />
        ) : (
          <MockupMattersTable items={matterData?.items ?? []} columns={columns} />
        )}
        {total > 0 ? (
          <div className="border-t border-[var(--bd-hair)]">
            <Pager page={page} totalPages={totalPages} summary={<>第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条 · 共 {total} 件</>} onChange={(p) => go({ page: p })} />
          </div>
        ) : null}
      </div>

      <IntakeWizard open={wizardOpen} onOpenChange={closeWizard} clientOptions={clientOptions} colleagues={colleagues} initialClientId={autoOpenIntake ? initialClientId : undefined} />
    </div>
  );
}
