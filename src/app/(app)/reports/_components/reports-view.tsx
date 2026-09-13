"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  Wallet,
  Briefcase,
  Archive,
  CheckCircle2,
  Download,
  BarChart3,
  CircleAlert,
  Send,
  Loader2,
  Printer
} from "lucide-react";
import { matterCategoryLabel, matterCategoryColor } from "@/lib/enums";
import type { ReportData } from "@/server/reports/queries";
import type {
  CycleStats,
  ReviewIssueAnalysis
} from "@/server/reports/analytics";
import { pushWeeklyReportToAll } from "@/server/reports/push-weekly";
import { triggerArchiveOverdueScanNow } from "@/server/cron/manual-triggers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PeriodKey = "month" | "quarter" | "year" | "lastYear" | "custom";

const PERIOD_LABEL: Record<Exclude<PeriodKey, "custom">, string> = {
  month: "本月",
  quarter: "本季",
  year: "本年",
  lastYear: "上年"
};

export function ReportsView({
  periodKey,
  periodLabel,
  customStart,
  customEnd,
  resolveError,
  data,
  cycle,
  reviewAnalysis,
  presetLabels
}: {
  periodKey: PeriodKey;
  periodLabel: string;
  customStart?: string;
  customEnd?: string;
  resolveError?: string;
  data: ReportData;
  cycle: CycleStats[];
  reviewAnalysis: ReviewIssueAnalysis;
  presetLabels: Record<Exclude<PeriodKey, "custom">, string>;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [customOpen, setCustomOpen] = useState(periodKey === "custom");
  const [start, setStart] = useState(customStart ?? "");
  const [end, setEnd] = useState(customEnd ?? "");
  const [pushing, startPushing] = useTransition();
  const [scanning, startScanning] = useTransition();

  function handleScanOverdue() {
    if (!confirm("立刻扫描已结案超过 30 天未归档的案件，给主办律师发预警通知？")) return;
    startScanning(async () => {
      try {
        const r = await triggerArchiveOverdueScanNow();
        toast.success(
          `归档逾期扫描完成：${r.scanned} 候选 / ${r.notified} 通知 / ${r.suppressed} 抑制`
        );
      } catch (err) {
        toast.error("扫描失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handlePushWeekly() {
    if (!confirm("立刻给所有主任律师和律师推送本周报告？每人收到一条通知。")) return;
    startPushing(async () => {
      try {
        const res = await pushWeeklyReportToAll();
        if (res.failed.length === 0) {
          toast.success(`已推送本周报告（${res.weekLabel}），共 ${res.succeeded} 人`);
        } else {
          toast.warning(
            `部分成功：${res.succeeded} 成功，${res.failed.length} 失败`,
            { description: res.failed.map((f) => f.error).slice(0, 3).join("；") }
          );
        }
      } catch (err) {
        toast.error("推送失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function switchPreset(k: Exclude<PeriodKey, "custom">) {
    const next = new URLSearchParams(sp.toString());
    next.set("period", k);
    next.delete("start");
    next.delete("end");
    router.push(`/reports?${next.toString()}`);
    setCustomOpen(false);
  }

  function applyCustom() {
    if (!start || !end) return;
    const next = new URLSearchParams();
    next.set("period", "custom");
    next.set("start", start);
    next.set("end", end);
    router.push(`/reports?${next.toString()}`);
  }

  const maxCat = data.byCategory.reduce((m, c) => Math.max(m, c.count), 0);

  const exportHref = (() => {
    const q = new URLSearchParams();
    q.set("period", periodKey);
    if (periodKey === "custom" && customStart && customEnd) {
      q.set("start", customStart);
      q.set("end", customEnd);
    }
    return `/api/reports/export?${q.toString()}`;
  })();

  return (
    <div className="space-y-5">
      <header className="ll-page-head">
        <div>
          <h1 className="ll-page-title flex items-center gap-2">
            <BarChart3 className="h-[22px] w-[22px] text-primary" strokeWidth={1.8} />
            律所报表
          </h1>
          <p className="ll-page-sub">
            统计期：<span className="text-foreground">{periodLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 ll-no-print">
          <div className="ll-segmented">
            {(["month", "quarter", "year", "lastYear"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => switchPreset(k)}
                className={cn(
                  "ll-seg shrink-0",
                  periodKey === k ? "ll-seg-active text-primary" : "text-muted-foreground hover:text-foreground"
                )}
                title={presetLabels[k]}
              >
                {PERIOD_LABEL[k]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              className={cn(
                "ll-seg shrink-0",
                periodKey === "custom" ? "ll-seg-active text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              自定义
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleScanOverdue}
            disabled={scanning}
            className="gap-1.5"
            title="扫描已结超过 30 天未归档的案件"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            扫归档逾期
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePushWeekly}
            disabled={pushing}
            className="gap-1.5"
            title="给所有律师推送本周报告通知"
          >
            {pushing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            推送周报
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="gap-1.5"
            title="Cmd/Ctrl+P 同样可触发，可以「另存为 PDF」"
          >
            <Printer className="h-3.5 w-3.5" />
            打印 / PDF
          </Button>
          <Link href={exportHref} prefetch={false}>
            <Button size="sm" className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              导出 xlsx
            </Button>
          </Link>
        </div>
      </header>

      {customOpen && (
        <div className="ll-no-print ll-surface flex flex-wrap items-end gap-2 p-3 text-xs">
          <div>
            <label className="text-muted-foreground">起始（含）</label>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-0.5 h-8 w-36 text-[12px]"
            />
          </div>
          <span className="pb-2 text-muted-foreground">~</span>
          <div>
            <label className="text-muted-foreground">结束（含）</label>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-0.5 h-8 w-36 text-[12px]"
            />
          </div>
          <Button size="sm" onClick={applyCustom} disabled={!start || !end}>
            应用
          </Button>
          <span className="ml-2 text-[10px] text-muted-foreground">最大跨度 5 年</span>
        </div>
      )}

      {resolveError && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--amber-line)] bg-[var(--amber-bg)] p-3 text-xs text-[var(--amber)]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{resolveError}</span>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Briefcase} label="本期新收" value={data.kpis.newIntake} color="#1E56C8" />
        <Kpi icon={Wallet} label="在办中" value={data.kpis.inProgress} color="#96650B" />
        <Kpi icon={CheckCircle2} label="本期已结" value={data.kpis.closed} color="#1A7F45" />
        <Kpi
          icon={Archive}
          label="本期已归档"
          value={data.kpis.archived}
          color="#6C3FC5"
          hint={data.kpis.closed > 0 ? `归档率 ${Math.round(data.kpis.archiveRate * 100)}%` : ""}
        />
      </div>

      {/* 类别分布 */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 text-sm font-medium">本期新收 · 类别分布</h3>
        {data.byCategory.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期暂无新收案件</p>
        ) : (
          <ul className="space-y-2">
            {data.byCategory.map((c) => {
              const pct = maxCat > 0 ? (c.count / maxCat) * 100 : 0;
              const color = matterCategoryColor[c.category];
              return (
                <li key={c.category} className="flex items-center gap-3 text-xs">
                  <span className="w-16 shrink-0 text-foreground/80">
                    {matterCategoryLabel[c.category]}
                  </span>
                  <div className="flex-1">
                    <div
                      className="h-4 rounded"
                      style={{
                        width: `${pct}%`,
                        minWidth: c.count > 0 ? 8 : 0,
                        backgroundColor: `${color}99`
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 font-mono text-right text-foreground">
                    {c.count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* 客户来源渠道分布（P0-1 第三步） */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">客户来源渠道 · 存量</h3>
          {data.byClientSource.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无客户数据</p>
          ) : (
            <ul className="space-y-2">
              {data.byClientSource.slice(0, 8).map((s) => {
                const max = data.byClientSource[0].count || 1;
                const pct = (s.count / max) * 100;
                return (
                  <li key={s.source} className="flex items-center gap-3 text-xs">
                    <span className="w-20 shrink-0 truncate text-foreground/80" title={s.source}>
                      {s.source}
                    </span>
                    <div className="flex-1">
                      <div className="h-4 rounded" style={{ width: `${pct}%`, minWidth: 8, backgroundColor: "#007B7F99" }} />
                    </div>
                    <span className="w-16 shrink-0 font-mono text-right text-foreground" title={`${s.count} 位客户 · 关联 ${s.intakeCount} 件案件`}>
                      {s.count} / {s.intakeCount}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">客户数 / 关联案件数 · 未记录来源的客户可在客户档案中补录</p>
        </section>

        {/* 律师产出 */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">律师产出 · 本期</h3>
          {data.byLawyer.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">本期无产出数据</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal">律师</th>
                    <th className="px-2 py-1.5 text-right font-normal">新收</th>
                    <th className="px-2 py-1.5 text-right font-normal">已结</th>
                    <th className="px-2 py-1.5 text-right font-normal">收款（元）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byLawyer.map((r) => (
                    <tr key={r.userId}>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{r.ownedCount}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{r.closedCount}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.receivedAmount.toLocaleString("zh-CN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 客户应收 */}
        <section className="ll-surface p-4">
          <h3 className="mb-3 text-sm font-medium">客户应收 · 本期</h3>
          {data.byClientReceivable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">本期无应收数据</p>
          ) : (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal">客户</th>
                    <th className="px-2 py-1.5 text-right font-normal">应收</th>
                    <th className="px-2 py-1.5 text-right font-normal">已收</th>
                    <th className="px-2 py-1.5 text-right font-normal">余额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byClientReceivable.map((r) => (
                    <tr key={r.clientId}>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {r.receivable.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[var(--green)]">
                        {r.received.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono",
                          r.balance > 0 ? "text-[var(--red)]" : "text-muted-foreground"
                        )}
                      >
                        {r.balance.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 办案周期分析 */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 text-sm font-medium">办案周期 · 本期已结案件（收案 → 结案）</h3>
        {cycle.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期无已结案件</p>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">类别</th>
                  <th className="px-2 py-1.5 text-right font-normal">样本数</th>
                  <th className="px-2 py-1.5 text-right font-normal">均值（天）</th>
                  <th className="px-2 py-1.5 text-right font-normal">中位数（天）</th>
                  <th className="px-2 py-1.5 text-right font-normal">最快（天）</th>
                  <th className="px-2 py-1.5 text-right font-normal">最慢（天）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cycle.map((r) => (
                  <tr key={r.category}>
                    <td className="px-2 py-1.5">{matterCategoryLabel[r.category]}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.count}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.avgDays}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.medianDays}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--green)]">{r.minDays}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--red)]">{r.maxDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* AI 审查 top issues */}
      <section className="ll-surface p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
          AI 审查 · 本期高频问题
          <span className="text-[10px] font-normal text-muted-foreground">
            （{reviewAnalysis.recordCount} 次审查 / {reviewAnalysis.documentCount} 份文档 /{" "}
            {reviewAnalysis.totalItems} 条问题）
          </span>
        </h3>
        {reviewAnalysis.totalItems === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">本期没有 AI 审查记录</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <SevTotalChip sev="HIGH" n={reviewAnalysis.bySeverity.HIGH} />
              <SevTotalChip sev="MEDIUM" n={reviewAnalysis.bySeverity.MEDIUM} />
              <SevTotalChip sev="LOW" n={reviewAnalysis.bySeverity.LOW} />
            </div>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal">问题标题</th>
                    <th className="px-2 py-1.5 text-left font-normal w-20">类型</th>
                    <th className="px-2 py-1.5 text-right font-normal w-16">次数</th>
                    <th className="px-2 py-1.5 text-right font-normal w-32">高/中/低</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reviewAnalysis.topIssues.map((iss) => (
                    <tr key={iss.title}>
                      <td className="px-2 py-1.5">{iss.title}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{TYPE_CN[iss.type]}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{iss.occurrences}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px]">
                        <span className="text-[var(--red)]">{iss.severityCounts.HIGH}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-[var(--amber)]">{iss.severityCounts.MEDIUM}</span>
                        <span className="mx-0.5 text-muted-foreground">/</span>
                        <span className="text-[var(--t-muted)]">{iss.severityCounts.LOW}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const TYPE_CN = {
  MISSING: "缺失",
  RISK: "风险",
  ISSUE: "问题",
  SUGGESTION: "建议"
} as const;

function SevTotalChip({ sev, n }: { sev: "HIGH" | "MEDIUM" | "LOW"; n: number }) {
  const meta = {
    HIGH: { label: "高严重", cls: "border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]" },
    MEDIUM: { label: "中严重", cls: "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]" },
    LOW: { label: "低严重", cls: "border-[var(--bd-subtle)] bg-[var(--bg-hover)] text-[var(--t-muted)]" }
  }[sev];
  return (
    <div className={cn("rounded border px-3 py-2 text-xs", meta.cls)}>
      <div className="text-[10px] opacity-80">{meta.label}</div>
      <div className="mt-0.5 font-mono text-lg">{n}</div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  color,
  hint
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </div>
      <div className="mt-1 font-mono text-2xl tabular text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
