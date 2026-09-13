"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { globalSearch, type GlobalSearchResult } from "@/server/search/actions";
import {
  FolderOpen,
  Users,
  FileText,
  Inbox,
} from "lucide-react";

const groupConfig = [
  { key: "matters" as const, label: "案件", icon: FolderOpen },
  { key: "clients" as const, label: "客户", icon: Users },
  { key: "intakes" as const, label: "收案", icon: Inbox },
  { key: "documents" as const, label: "材料", icon: FileText },
];

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Cmd+K / Ctrl+K 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  // 防抖搜索
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await globalSearch(query);
        setResults(r);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((href: string) => {
    if (!href) return;
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }, [router, onOpenChange]);

  const hasResults = results && (
    results.matters.length + results.clients.length + results.intakes.length + results.documents.length > 0
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="搜索案件、客户、材料..."
        value={query}
        onValueChange={setQuery}
        className="ll-command-input"
      />
      <CommandList>
        {query && !loading && !hasResults && (
          <CommandEmpty>未找到相关结果</CommandEmpty>
        )}
        {results && groupConfig.map(({ key, label, icon: Icon }) => {
          const items = results[key];
          if (!items.length) return null;
          return (
            <CommandGroup
              key={key}
              heading={`${label} · ${items.length}`}
              className="[&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.07em] [&_[cmdk-group-heading]]:text-muted-foreground/75"
            >
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.title} ${item.subtitle ?? ""}`}
                  onSelect={() => handleSelect(item.href)}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item.title}</div>
                    {item.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {results && results.documentsFailedCount > 0 && (
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            另有 {results.documentsFailedCount} 份材料识别失败未纳入全文检索——失败状态可在管理后台「文档文本层维护」查看并重试
          </div>
        )}
        {results && hasResults && (
          <div className="border-t border-border px-3 py-2 text-[10.5px] text-muted-foreground/70">
            正文命中按对应材料的读取授权过滤；无权查看的材料不会出现在结果中
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
