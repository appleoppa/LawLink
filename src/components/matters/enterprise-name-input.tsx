"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchEnterpriseCandidates, getEnterpriseDetail, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";
import { actionErrorMessage } from "@/lib/action-error";

export type EnterprisePick = { name: string; creditCode: string; legalRep?: string | null; address?: string | null };

/**
 * 受控的单位名称输入：输入时防抖匹配元典企业，选中后回填名称、信用代码，
 * 再取详情补法定代表人与注册地址。未配置元典时静默，退化为普通输入框。
 */
export function EnterpriseNameInput({
  value,
  onChange,
  onPick,
  className,
  placeholder = "单位名称（输入自动匹配企业信息）"
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (pick: EnterprisePick) => void;
  className?: string;
  placeholder?: string;
}) {
  const [candidates, setCandidates] = useState<EnterpriseSearchItem[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [filling, startFill] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function schedule(next: string) {
    if (timer.current) clearTimeout(timer.current);
    const q = next.trim();
    if (q.length < 2) {
      setCandidates(null);
      return;
    }
    timer.current = setTimeout(() => {
      startSearch(async () => {
        try {
          const r = await searchEnterpriseCandidates(q);
          setCandidates(r.configured && r.items.length > 0 ? r.items : null);
        } catch {
          setCandidates(null);
        }
      });
    }, 400);
  }

  function pick(item: EnterpriseSearchItem) {
    setCandidates(null);
    onPick({ name: item.name, creditCode: item.creditCode });
    startFill(async () => {
      try {
        const r = await getEnterpriseDetail(item.id);
        if (r.configured && r.info) {
          onPick({ name: item.name, creditCode: item.creditCode, legalRep: r.info.legalRep, address: r.info.address });
          toast.success(`已回填：${item.name}`);
        }
      } catch (err) {
        toast.warning("法定代表人 / 地址自动填充失败，可手动补充", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <Popover open={!!candidates && candidates.length > 0} onOpenChange={(o) => { if (!o) setCandidates(null); }}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={value}
            placeholder={placeholder}
            className={className}
            onChange={(e) => {
              onChange(e.target.value);
              schedule(e.target.value);
            }}
          />
          {searching || filling ? <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[var(--t-muted)]" /> : null}
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" portalled={false} className="w-80 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="mb-1 flex items-center gap-1 px-1 text-[10.5px] text-[var(--t-muted)]">
          <Search className="h-3 w-3" />
          企业信息匹配，点击回填信用代码、法定代表人与地址
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {candidates?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c)} className="w-full rounded-[7px] border border-[var(--bd-hair)] px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]">
                <div className="font-medium">{c.name}</div>
                <div className="font-mono text-[10.5px] text-[var(--t-muted)]">{c.creditCode}</div>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
