"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import type { Client, ClientType, Contact } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ClientSheet } from "./client-sheet";
import { ClientsTable } from "./clients-table";

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

  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h1 className="ll-page-title">客户</h1>
          <p className="ll-page-sub">
              共 <span className="font-mono tabular text-foreground">{initialData.total}</span> 位客户
            </p>
        </div>
          <Button onClick={handleNew} className="gap-1.5 px-4">
            <Plus className="h-4 w-4" strokeWidth={2} />
            新建客户
          </Button>
      </header>

      <div className="ll-surface flex flex-wrap items-center gap-2 px-3 py-2">
        <form onSubmit={handleSearchSubmit} className="relative min-w-0 sm:min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => updateUrl({ search })}
            placeholder="搜索客户名称 / 身份证号 / 电话 / 邮箱"
            className="h-[34px] border-input bg-background pl-9 shadow-[var(--shadow-inset-deep)]"
          />
        </form>

        <Select
          value={type}
          onValueChange={(v) => {
            const next = v as ClientType | "ALL";
            setType(next);
            updateUrl({ type: next });
          }}
        >
          <SelectTrigger
            className="h-[34px] w-36 rounded-full border-input bg-card"
          >
            <SelectValue placeholder="客户类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部类型</SelectItem>
            <SelectItem value="INDIVIDUAL">自然人</SelectItem>
            <SelectItem value="COMPANY">公司</SelectItem>
            <SelectItem value="ORGANIZATION">其他组织</SelectItem>
          </SelectContent>
        </Select>

        {(search || type !== "ALL") && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3.5 w-3.5" />
            清除筛选
          </Button>
        )}
      </div>

      {/* 列表 */}
      <ClientsTable items={initialData.items} onEdit={handleEdit} />

      {/* 抽屉 */}
      <ClientSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editingClient={editingClient}
      />
    </div>
  );
}
