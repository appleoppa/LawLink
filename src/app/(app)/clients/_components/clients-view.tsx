"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { Client, ClientType, Contact } from "@prisma/client";
import { PageHeader, Pager, Segmented } from "@/components/patterns/moan";
import { ClientSheet } from "./client-sheet";
import { ClientsTable } from "./clients-table";
import { useTopbarAction } from "@/components/layout/topbar-action";

const TYPE_TABS: { key: ClientType | "ALL"; label: string }[] = [
  { key: "ALL", label: "全部客户" },
  { key: "COMPANY", label: "公司" },
  { key: "ORGANIZATION", label: "其他组织" },
  { key: "INDIVIDUAL", label: "自然人" }
];

type ClientRow = Client & {
  contacts: Contact[];
  _count: { matters: number; intakes: number };
};

type Props = {
  initialData: {
    items: ClientRow[];
    total: number;
    page: number;
    pageSize: number;
  };
  initialFilters: {
    search: string;
    type: ClientType | "ALL";
  };
};

export function ClientsView({ initialData, initialFilters }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(initialFilters.search);
  const [type, setType] = useState<ClientType | "ALL">(initialFilters.type);

  const [sheetOpen, setSheetOpen] = useState(false);
  useTopbarAction({ label: "新建客户", onClick: () => handleNew() }, []);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);

  const updateUrl = useCallback(
    (next: { search?: string; type?: string }) => {
      const params = new URLSearchParams();
      const s = next.search ?? search;
      const t = next.type ?? type;
      if (s) params.set("search", s);
      if (t && t !== "ALL") params.set("type", t);
      startTransition(() => {
        router.replace(`/clients${params.toString() ? `?${params.toString()}` : ""}`);
      });
    },
    [router, search, type]
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateUrl({ search });
  }

  function clearFilters() {
    setSearch("");
    setType("ALL");
    startTransition(() => router.replace("/clients"));
  }

  function handleNew() {
    setEditingClient(null);
    setSheetOpen(true);
  }

  function handleEdit(client: ClientRow) {
    setEditingClient(client);
    setSheetOpen(true);
  }

  const totalPages = Math.max(1, Math.ceil(initialData.total / initialData.pageSize));
  const hrefFor = (page: number) => {
    const params = new URLSearchParams();
    if (initialFilters.search) params.set("search", initialFilters.search);
    if (initialFilters.type !== "ALL") params.set("type", initialFilters.type);
    if (page > 1) params.set("page", String(page));
    return `/clients${params.toString() ? `?${params.toString()}` : ""}`;
  };
  const from = initialData.total === 0 ? 0 : (initialData.page - 1) * initialData.pageSize + 1;
  const to = Math.min(initialData.total, initialData.page * initialData.pageSize);

  return (
    <div className="mo-list">
      <PageHeader
        title="客户"
        sub={<>共 <span className="font-mono">{initialData.total}</span> 位客户 · 证件与电话默认打码，明文查看逐次审计</>}
      />

      <Segmented
        className="mb-3"
        items={TYPE_TABS}
        value={type}
        onChange={(key) => {
          setType(key);
          updateUrl({ type: key });
        }}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="mo-toolbar-input" onSubmit={handleSearchSubmit}>
          <Search aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => updateUrl({ search })} placeholder="搜索客户名称 / 证件号 / 电话 / 邮箱" aria-label="搜索客户" />
        </form>
        {search || type !== "ALL" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <X />
            清除筛选
          </button>
        ) : null}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <ClientsTable items={initialData.items} onEdit={handleEdit} />
        {initialData.total > 0 ? (
          <div className="border-t border-[var(--bd-hair)]">
            <Pager page={initialData.page} totalPages={totalPages} hrefFor={hrefFor} summary={<>第 {from}–{to} 条，共 {initialData.total} 条</>} />
          </div>
        ) : null}
      </div>

      <ClientSheet open={sheetOpen} onOpenChange={setSheetOpen} editingClient={editingClient} />
    </div>
  );
}
