"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  searchMattersForLink,
  addMatterLink,
  removeMatterLink
} from "@/server/matters/actions";
import { matterHref } from "@/lib/matters/route";
import { actionErrorMessage } from "@/lib/action-error";

type MatterRef = { id: string; internalCode: string | null; firmCaseNo?: string | null; title: string; relation?: string | null };

const RELATION_OPTIONS = [
  { value: "RELATED_CASE", label: "一般关联" },
  { value: "REMAND", label: "发回重审" },
  { value: "DERIVED_ENFORCEMENT", label: "衍生执行" },
  { value: "RELATED_CONTRACT", label: "关联合同" },
  { value: "REFERENCE_ONLY", label: "仅供参考" }
] as const;
const RELATION_LABEL: Record<string, string> = Object.fromEntries(
  RELATION_OPTIONS.map(o => [o.value, o.label])
);

export function RelatedMattersField({
  matterId,
  related,
  canManage
}: {
  matterId: string;
  related: MatterRef[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MatterRef[]>([]);
  const [searching, startSearch] = useTransition();
  const [pending, startMutate] = useTransition();
  const [relation, setRelation] = useState<string>("RELATED_CASE");

  function runSearch(q: string) {
    setQuery(q);
    startSearch(async () => {
      try {
        setResults(await searchMattersForLink(matterId, q));
      } catch {
        setResults([]);
      }
    });
  }

  function onOpenChange(o: boolean) {
    if (!canManage) return;
    setOpen(o);
    if (o) runSearch("");
  }

  function add(id: string) {
    if (!canManage) return;
    startMutate(async () => {
      try {
        await addMatterLink(matterId, id, relation as "RELATED_CASE");
        toast.success("已关联");
        setOpen(false);
        setQuery("");
        router.refresh();
      } catch (err) {
        toast.error("关联失败", { description: actionErrorMessage(err) });
      }
    });
  }

  function remove(id: string) {
    if (!canManage) return;
    startMutate(async () => {
      try {
        await removeMatterLink(matterId, id);
        router.refresh();
      } catch (err) {
        toast.error("解除失败", { description: actionErrorMessage(err) });
      }
    });
  }

  const addButton = canManage ? (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="关联案件"
          title="关联案件"
          className="h-5 w-5 rounded-sm p-0 text-muted-foreground"
        >
          <Plus className="h-2.5 w-2.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="relative mb-1.5">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="搜索案件名称 / 所内案号"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {RELATION_OPTIONS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => setRelation(o.value)}
              className={`rounded-full border px-2 py-0.5 text-[10.5px] transition-colors ${
                relation === o.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {searching ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">无可关联的案件</p>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => add(m.id)}
                disabled={pending}
                className="flex w-full flex-col rounded-sm border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:border-input hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {m.firmCaseNo ? (
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {m.firmCaseNo}
                  </span>
                ) : null}
                <span className="truncate">{m.title}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  return (
    <div className="flex flex-col items-start gap-1">
      {related.map((m, index) => (
        <span
          key={m.id}
          className="group flex min-w-0 max-w-full items-center gap-1 text-[12px]"
        >
          <Link
            href={matterHref(m)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
            title={m.firmCaseNo ? `${m.firmCaseNo} ${m.title}` : m.title}
          >
            <span className="max-w-[260px] truncate">{m.title}</span>
          </Link>
          {m.relation && m.relation !== "RELATED_CASE" && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[9.5px] text-muted-foreground">
              {RELATION_LABEL[m.relation] ?? m.relation}
            </span>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => remove(m.id)}
              disabled={pending}
              className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              title="解除关联"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {index === related.length - 1 && addButton}
        </span>
      ))}

      {related.length === 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          暂无关联
          {addButton}
        </span>
      )}
    </div>
  );
}
