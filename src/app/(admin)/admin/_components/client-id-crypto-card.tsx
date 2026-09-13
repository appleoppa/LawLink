"use client";

/**
 * 证件号加密迁移卡（P1 §三 存量回填入口，管理后台概览页）。
 */
import { useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { backfillClientIdEncryption } from "@/server/clients/backfill-crypto";

type Stats = { pending: number; sealed: number; total: number };
type RunResult = { scanned: number; sealed: number; skippedDuplicate: number; remaining: number };

export function ClientIdCryptoCard({ initialStats }: { initialStats: Stats }) {
  const [pending, startTransition] = useTransition();
  const [stats, setStats] = useState(initialStats);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-primary" />
            证件号加密迁移
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            将存量客户证件号转为加密存储并建立盲索引（等值查重不受影响）。重复主体的行会跳过并计数，请走客户合并流程处理。
          </div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">
            客户总数 {stats.total} · 已加密 {stats.sealed} · 待迁移 {stats.pending}
          </div>
        </div>
        <button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const r = await backfillClientIdEncryption();
                setLastRun(r);
                setStats(s => ({ ...s, pending: r.remaining, sealed: s.sealed + r.sealed }));
              } catch (e) {
                setError(e instanceof Error ? e.message : "执行失败");
              }
            });
          }}
          disabled={pending || stats.pending === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {stats.pending > 0 ? "迁移一批（50）" : "无待迁移"}
        </button>
      </div>
      {lastRun && (
        <div className="mt-2 text-[12px] text-muted-foreground">
          上次执行：扫描 {lastRun.scanned} · 加密 {lastRun.sealed}
          {lastRun.skippedDuplicate > 0 ? ` · 跳过重复 ${lastRun.skippedDuplicate}（待合并）` : ""}
          {lastRun.remaining > 0 ? ` · 剩余 ${lastRun.remaining} 可继续` : " · 已全部处理"}
        </div>
      )}
      {error && <div className="mt-2 text-[12.5px] text-destructive">{error}</div>}
    </div>
  );
}
