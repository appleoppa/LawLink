"use client";

/**
 * 文档文本层维护卡（P0-2 存量回填入口）。每次处理一批（50 条），
 * 剩余数提示继续点击；结果就地展示。
 */
import { useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { backfillDocumentTextLayers } from "@/server/documents/admin-text-backfill";

type Stats = { pending: number; ready: number; failed: number; skip: number; total: number };
type RunResult = { scanned: number; ready: number; skipped: number; failed: number; remaining: number };

export function TextBackfillCard({ initialStats }: { initialStats: Stats }) {
  const [pending, startTransition] = useTransition();
  const [stats, setStats] = useState(initialStats);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await backfillDocumentTextLayers();
        setLastRun(result);
        setStats(s => ({
          ...s,
          pending: result.remaining,
          ready: s.ready + result.ready,
          failed: s.failed + result.failed,
          skip: s.skip + result.skipped
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "执行失败");
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-primary" />
            文档文本层维护
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            为上传时未抽取文本的存量文档（PDF / Word / 纯文本）补建全文检索基础。
            每次处理一批（50 条）；扫描件标记为跳过，等待通用识别能力（P1）。
          </div>
          <div className="mt-1.5 text-[12px] text-muted-foreground">
            总数 {stats.total} · 已有文本 {stats.ready} · 待处理 {stats.pending} · 跳过 {stats.skip} · 失败 {stats.failed}
          </div>
        </div>
        <button
          onClick={run}
          disabled={pending || stats.pending === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {stats.pending > 0 ? "回填一批" : "无待处理"}
        </button>
      </div>
      {lastRun && (
        <div className="mt-2 text-[12px] text-muted-foreground">
          上次执行：扫描 {lastRun.scanned} · 成功 {lastRun.ready} · 跳过 {lastRun.skipped} · 失败 {lastRun.failed}
          {lastRun.remaining > 0 ? ` · 剩余 ${lastRun.remaining} 条可继续` : " · 已全部处理"}
        </div>
      )}
      {error && <div className="mt-2 text-[12.5px] text-destructive">{error}</div>}
    </div>
  );
}
