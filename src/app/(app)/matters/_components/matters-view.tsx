"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  X,
  Clock,
  CheckCircle2,
  Archive,
  AlertCircle,
  FolderOpen,
  Download,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import type { MatterCategory, ClientType, UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { matterCategoryLabel } from "@/lib/enums";
import { cn } from "@/lib/utils";
import { IntakeSheet } from "@/app/(app)/intakes/_components/intake-sheet";
import { MattersTable, type MatterRow } from "./matters-table";
import { IntakesTable, type IntakeRow } from "./intakes-table";

export type ClientOption = { id: string; name: string; type: ClientType };
export type ColleagueOption = { id: string; name: string; role: UserRole };

type Tab = "intake" | "active" | "archived" | "revision" | "all";
type SortBy = "hearing" | "intakeDate" | "claimAmount" | "archivedAt";
type SortDir = "asc" | "desc";

type Props = {
  tab: Tab;
  matterData?: { items: MatterRow[]; total: number; page: number; pageSize: number };
  intakeData?: { items: IntakeRow[]; total: number; page: number; pageSize: number };
  clientOptions: ClientOption[];
  colleagues: ColleagueOption[];
  initialFilters: {
    search: string;
    category: MatterCategory | "ALL";
    status?: string; // all tab 下 status 筛选
    from?: string; // 收案时间起
    to?: string; // 收案时间止
    sortBy?: SortBy;
    sortDir?: SortDir;
  };
  autoOpenIntake?: boolean;
};

const ALL_CATEGORIES: (MatterCategory | "ALL")[] = [
  "ALL",
  "CIVIL_COMMERCIAL",
  "LABOR_ARBITRATION",
  "COMMERCIAL_ARBITRATION",
  "CRIMINAL",
  "ADMINISTRATIVE",
  "NON_LITIGATION",
  "LEGAL_COUNSEL",
  "SPECIAL_PROJECT"
];

const TABS: { key: Tab; label: string; icon: typeof Clock }[] = [
  { key: "all", label: "全部案件", icon: FolderOpen },
  { key: "intake", label: "待审批", icon: Clock },
  { key: "active", label: "进行中", icon: CheckCircle2 },
  { key: "revision", label: "待补正", icon: AlertCircle },
  { key: "archived", label: "已归档", icon: Archive }
];

const ALL_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "全部状态" },
  { value: "active", label: "办理中" },
  { value: "closed", label: "已结案" },
  { value: "archived", label: "已归档" }
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "hearing", label: "按开庭时间" },
  { value: "intakeDate", label: "按收案时间" },
  { value: "claimAmount", label: "按标的金额" },
  { value: "archivedAt", label: "按归档时间" }
];

const SORT_DIR_OPTIONS: { value: SortDir; label: string }[] = [
  { value: "desc", label: "倒序" },
  { value: "asc", label: "正序" }
];

function defaultSortByForTab(tab: Tab): SortBy {
  if (tab === "active") return "hearing";
  if (tab === "archived") return "archivedAt";
  return "intakeDate";
}

function sortOptionsForTab(tab: Tab) {
  if (tab === "archived") {
    return SORT_OPTIONS.filter((option) => option.value === "archivedAt" || option.value === "intakeDate");
  }
  if (tab === "active" || tab === "all") {
    return SORT_OPTIONS.filter((option) => option.value !== "archivedAt");
  }
  return SORT_OPTIONS.filter((option) => option.value !== "hearing" && option.value !== "archivedAt");
}

function normalizeSortByForTab(tab: Tab, sortBy: SortBy): SortBy {
  if (sortBy === "hearing" && tab !== "active" && tab !== "all") {
    return defaultSortByForTab(tab);
  }
  if (sortBy === "archivedAt" && tab !== "archived") {
    return defaultSortByForTab(tab);
  }
  if (sortBy === "claimAmount" && tab === "archived") {
    return defaultSortByForTab(tab);
  }
  return sortBy;
}

export function MattersView({
  tab,
  matterData,
  intakeData,
  clientOptions,
  colleagues,
  initialFilters,
  autoOpenIntake
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(initialFilters.search);
  const [category, setCategory] = useState<MatterCategory | "ALL">(initialFilters.category);
  const [statusFilter, setStatusFilter] = useState<string>(initialFilters.status ?? "ALL");
  const [dateFrom, setDateFrom] = useState<string>(initialFilters.from ?? "");
  const [dateTo, setDateTo] = useState<string>(initialFilters.to ?? "");
  const [sortBy, setSortBy] = useState<SortBy>(initialFilters.sortBy ?? defaultSortByForTab(tab));
  const [sortDir, setSortDir] = useState<SortDir>(initialFilters.sortDir ?? "desc");
  const [sheetOpen, setSheetOpen] = useState(() => Boolean(autoOpenIntake));
  const currentDefaultSortBy = defaultSortByForTab(tab);
  const sortOptions = sortOptionsForTab(tab);
  const isIntakeStyle = tab === "intake" || tab === "revision";
  const isAll = tab === "all";
  const currentList = isIntakeStyle ? intakeData : matterData;
  const total = currentList?.total ?? 0;
  const currentPage = currentList?.page ?? 1;
  const pageSize = currentList?.pageSize ?? 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(total, currentPage * pageSize);

  useEffect(() => {
    setSearch(initialFilters.search);
    setCategory(initialFilters.category);
    setStatusFilter(initialFilters.status ?? "ALL");
    setDateFrom(initialFilters.from ?? "");
    setDateTo(initialFilters.to ?? "");
    setSortBy(initialFilters.sortBy ?? defaultSortByForTab(tab));
    setSortDir(initialFilters.sortDir ?? "desc");
  }, [
    tab,
    initialFilters.search,
    initialFilters.category,
    initialFilters.status,
    initialFilters.from,
    initialFilters.to,
    initialFilters.sortBy,
    initialFilters.sortDir
  ]);

  function intakeUrlWithoutNew() {
    const params = new URLSearchParams();
    if (tab !== "active") params.set("tab", tab);
    if (initialFilters.search) params.set("search", initialFilters.search);
    if (initialFilters.category !== "ALL") params.set("category", initialFilters.category);
    if (tab === "all" && initialFilters.status && initialFilters.status !== "ALL") {
      params.set("status", initialFilters.status);
    }
    if (initialFilters.from) params.set("from", initialFilters.from);
    if (initialFilters.to) params.set("to", initialFilters.to);
    if (initialFilters.sortBy && initialFilters.sortBy !== defaultSortByForTab(tab)) {
      params.set("sortBy", initialFilters.sortBy);
    }
    if (initialFilters.sortDir && initialFilters.sortDir !== "desc") {
      params.set("sortDir", initialFilters.sortDir);
    }
    return `/matters${params.toString() ? `?${params.toString()}` : ""}`;
  }

  // ?new=1 自动打开；关闭弹窗时再清 URL，避免 replace 打断打开状态。
  useEffect(() => {
    if (autoOpenIntake) {
      setSheetOpen(true);
    }
  }, [autoOpenIntake]);

  const buildUrl = useCallback(
    (override: {
      tab?: Tab;
      search?: string;
      category?: string;
      status?: string;
      from?: string;
      to?: string;
      sortBy?: SortBy;
      sortDir?: SortDir;
      page?: number;
    }) => {
      const params = new URLSearchParams();
      const t = override.tab ?? tab;
      const s = override.search ?? search;
      const c = override.category ?? category;
      const st = override.status ?? statusFilter;
      const f = override.from ?? dateFrom;
      const to_ = override.to ?? dateTo;
      const sb = normalizeSortByForTab(t, override.sortBy ?? sortBy);
      const sd = override.sortDir ?? sortDir;
      const p = override.page ?? currentPage;
      const defaultSortBy = defaultSortByForTab(t);
      if (t !== "active") params.set("tab", t);
      if (s) params.set("search", s);
      if (c && c !== "ALL") params.set("category", c);
      if (t === "all" && st && st !== "ALL") params.set("status", st);
      if (f) params.set("from", f);
      if (to_) params.set("to", to_);
      if (sb !== defaultSortBy) params.set("sortBy", sb);
      if (sd !== "desc") params.set("sortDir", sd);
      if (p > 1) params.set("page", String(p));
      return `/matters${params.toString() ? `?${params.toString()}` : ""}`;
    },
    [tab, search, category, statusFilter, dateFrom, dateTo, sortBy, sortDir, currentPage]
  );

  const buildExportUrl = useCallback(() => {
    const href = buildUrl({});
    const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    params.set("tab", tab);
    params.delete("page");
    return `/api/matters/export?${params.toString()}`;
  }, [buildUrl, tab]);

  function switchTab(next: Tab) {
    const nextSortBy = defaultSortByForTab(next);
    setSortBy(nextSortBy);
    setSortDir("desc");
    startTransition(() => router.replace(buildUrl({ tab: next, sortBy: nextSortBy, sortDir: "desc", page: 1 })));
  }

  function applyFilters() {
    startTransition(() => router.replace(buildUrl({ page: 1 })));
  }

  function clearFilters() {
    setSearch("");
    setCategory("ALL");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setSortBy(currentDefaultSortBy);
    setSortDir("desc");
    startTransition(() =>
      router.replace(`/matters${tab !== "active" ? `?tab=${tab}` : ""}`)
    );
  }

  function handleSheetOpenChange(nextOpen: boolean) {
    setSheetOpen(nextOpen);
    if (!nextOpen && autoOpenIntake) {
      router.replace(intakeUrlWithoutNew(), { scroll: false });
    }
  }

  const hasFilters =
    search ||
    category !== "ALL" ||
    (isAll && statusFilter !== "ALL") ||
    dateFrom ||
    dateTo ||
    sortBy !== currentDefaultSortBy ||
    sortDir !== "desc";

  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h1 className="ll-page-title">案件</h1>
          <p className="ll-page-sub">
              <span className="text-foreground/80">
                {TABS.find((t) => t.key === tab)?.label}
              </span>
              <span className="mx-2 text-muted-foreground/50">·</span>
              共 <span className="font-mono tabular text-foreground">{total}</span> 件
            </p>
        </div>
        <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="gap-1.5 px-3">
              <a href={buildExportUrl()}>
                <Download className="h-4 w-4" strokeWidth={2} />
                导出
              </a>
            </Button>
            <Button onClick={() => setSheetOpen(true)} className="gap-1.5 px-4">
              <Plus className="h-4 w-4" strokeWidth={2} />
              新建收案
            </Button>
        </div>
      </header>

      <div className="ll-segmented w-fit max-w-full overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={cn(
                "ll-seg shrink-0",
                active && "ll-seg-active text-primary"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 搜索 */}
      <div className="ll-surface px-3 py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
          className="relative flex min-w-0 items-center gap-2"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.8}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索案件名称 / 客户"
              className="h-[34px] rounded-md border-input bg-background pl-9 text-[13px] shadow-[var(--shadow-inset-deep)]"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-[34px] gap-1 px-3">
            <Search className="h-3.5 w-3.5" />
            搜索
          </Button>
        </form>
      </div>

      {/* 筛选 / 排序 */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/70 px-2 py-2">
        <CompactSelect
          label="类型"
          value={category}
          onValueChange={(v) => {
            const next = v as MatterCategory | "ALL";
            setCategory(next);
            startTransition(() => router.replace(buildUrl({ category: next, page: 1 })));
          }}
          className="w-[8.5rem]"
        >
          {ALL_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {c === "ALL" ? "全部类型" : matterCategoryLabel[c as MatterCategory]}
            </SelectItem>
          ))}
        </CompactSelect>

        {isAll && (
          <CompactSelect
            label="状态"
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              startTransition(() => router.replace(buildUrl({ status: v, page: 1 })));
            }}
            className="w-[7.5rem]"
          >
            {ALL_STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </CompactSelect>
        )}

        <div className="flex h-8 items-center gap-1 rounded-full border border-input bg-card px-2 shadow-sm">
          <span className="text-[10px] text-muted-foreground">收案</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            onBlur={applyFilters}
            className="h-7 w-[7.25rem] border-0 bg-transparent px-0 text-[11px] shadow-none focus-visible:ring-0"
            title="收案时间起"
          />
          <span className="text-[11px] text-muted-foreground">至</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            onBlur={applyFilters}
            className="h-7 w-[7.25rem] border-0 bg-transparent px-0 text-[11px] shadow-none focus-visible:ring-0"
            title="收案时间止"
          />
        </div>

        <span className="mx-1 h-5 w-px bg-border" />
        <CompactSelect
          label="排序"
          value={sortBy}
          onValueChange={(v) => {
            const next = v as SortBy;
            setSortBy(next);
            startTransition(() => router.replace(buildUrl({ sortBy: next, page: 1 })));
          }}
          className="w-36"
        >
          {sortOptions.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </CompactSelect>
        <CompactSelect
          label="方向"
          value={sortDir}
          onValueChange={(v) => {
            const next = v as SortDir;
            setSortDir(next);
            startTransition(() => router.replace(buildUrl({ sortDir: next, page: 1 })));
          }}
          className="w-[6.5rem]"
        >
          {SORT_DIR_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </CompactSelect>

        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="h-8 gap-1 px-2 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            清除
          </Button>
        )}
      </div>

      {isIntakeStyle ? (
        <IntakesTable items={intakeData?.items ?? []} kind={tab as "intake" | "revision"} />
      ) : (
        <MattersTable
          items={matterData?.items ?? []}
          metaColumn={tab === "archived" ? "firmCaseNo" : "hearing"}
          showIntakeDateColumn={tab === "all"}
          showArchiveDateColumn={tab === "archived"}
        />
      )}

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        total={total}
        pageStart={pageStart}
        pageEnd={pageEnd}
        buildUrl={(page) => buildUrl({ page })}
      />

      <IntakeSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        clientOptions={clientOptions}
        colleagues={colleagues}
      />
    </div>
  );
}

function CompactSelect({
  label,
  value,
  onValueChange,
  className,
  children
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={cn(
          "h-8 gap-1 rounded-full border border-input bg-card px-2 text-[12px] shadow-sm focus:ring-0",
          className
        )}
      >
        <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  pageStart,
  pageEnd,
  buildUrl
}: {
  page: number;
  totalPages: number;
  total: number;
  pageStart: number;
  pageEnd: number;
  buildUrl: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div>
        第 <span className="font-mono text-foreground">{page}</span> /{" "}
        <span className="font-mono text-foreground">{totalPages}</span> 页
        <span className="mx-2 text-muted-foreground/50">·</span>
        本页 <span className="font-mono text-foreground">{pageStart}-{pageEnd}</span> 件，共{" "}
        <span className="font-mono text-foreground">{total}</span> 件
      </div>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 px-2.5">
            <a href={buildUrl(prevPage)}>
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5" disabled>
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </Button>
        )}
        {page < totalPages ? (
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 px-2.5">
            <a href={buildUrl(nextPage)}>
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5" disabled>
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
