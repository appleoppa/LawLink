"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import type { MatterCategory, ProcedureType } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  recommendCause,
  type CauseRecommendation
} from "@/server/ai/recommend-cause";
import { cn } from "@/lib/utils";

type Tab = "preset" | "free";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: MatterCategory;
  procedureType?: ProcedureType | null;
  /** 用现有字段 tab 的预填内容（父组件按场景拼好） */
  contextHints?: string;
  onSelect: (causeId: string, causeName: string) => void;
};

const confidenceStyle = {
  HIGH: { label: "高置信", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  MEDIUM: { label: "中置信", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  LOW: { label: "低置信", cls: "bg-slate-50 text-slate-600 border-slate-200" }
} as const;

export function CauseAiManualDialog({
  open,
  onOpenChange,
  category,
  procedureType,
  contextHints,
  onSelect
}: Props) {
  const hasHints = !!contextHints?.trim();
  const [tab, setTab] = useState<Tab>(hasHints ? "preset" : "free");
  const [situation, setSituation] = useState(hasHints ? (contextHints ?? "") : "");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CauseRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 打开/重开时重置
  useEffect(() => {
    if (!open) return;
    const initTab: Tab = hasHints ? "preset" : "free";
    setTab(initTab);
    setSituation(initTab === "preset" ? (contextHints ?? "") : "");
    setCandidates([]);
    setError(null);
    setLoading(false);
  }, [open, contextHints, hasHints]);

  function switchTab(t: Tab) {
    if (t === tab) return;
    setTab(t);
    setSituation(t === "preset" ? (contextHints ?? "") : "");
    setCandidates([]);
    setError(null);
  }

  async function runRecommend() {
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const list = await recommendCause({ category, procedureType, situation });
      setCandidates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 推荐失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" />
            AI 案由推荐
          </DialogTitle>
          <DialogDescription className="text-xs">
            描述案情后 AI 推荐 3 个候选案由，请人工核对后选用
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {/* Tab 切换（仅有 hints 时显示） */}
          {hasHints && (
            <div className="flex rounded-md border border-border bg-card p-0.5">
              <TabBtn active={tab === "preset"} onClick={() => switchTab("preset")}>
                用现有字段
              </TabBtn>
              <TabBtn active={tab === "free"} onClick={() => switchTab("free")}>
                自由输入
              </TabBtn>
            </div>
          )}

          <Textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder={
              tab === "preset"
                ? "已根据案件字段填入，可修改后再推荐"
                : "描述案情：当事人是谁、做了什么、争议焦点、诉求"
            }
            rows={6}
            className="resize-none"
          />

          <Button
            type="button"
            onClick={runRecommend}
            disabled={loading || situation.trim().length < 5}
            className="w-full gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {candidates.length > 0 ? "重新推荐" : "AI 推荐"}
          </Button>

          {/* 结果区 */}
          {error && (
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}
          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((c) => {
                const conf = confidenceStyle[c.confidence];
                const path = [c.cause.l1Name, c.cause.l2Name].filter(Boolean).join(" / ");
                return (
                  <button
                    key={c.cause.id}
                    type="button"
                    onClick={() => {
                      onSelect(c.cause.id, c.cause.name);
                      onOpenChange(false);
                    }}
                    className="flex w-full flex-col items-start gap-1 rounded-sm border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-input hover:bg-muted hover:text-foreground"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium">{c.cause.name}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none",
                          conf.cls
                        )}
                      >
                        {conf.label}
                      </span>
                    </div>
                    {path && (
                      <span className="text-[11px] text-muted-foreground">{path}</span>
                    )}
                    {c.reason && (
                      <span className="text-xs text-foreground/70">{c.reason}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-2.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-3.5 w-3.5" />
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-2 py-1 text-xs transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
