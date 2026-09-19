"use client";

import { useState } from "react";
import { Wallet, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { InvoiceRequestSheet } from "./invoice-request-sheet";
import type { FinancePayload, UserOption } from "./matter-detail-tabs";

/**
 * v0.12 重构：财务面板瘦身
 * - 删除：合同板块 / 分成方案 / 快捷录入 / 收付流水（5 类）
 * - 保留：律师费到账列表（仅 RECEIVED 类型）+ 顶部小计 + 申请开票按钮
 * - 数据主要由后台财务人员录入，案件页只读
 */
export function FinancePanel({
  matterId,
  finance,
  canRequestInvoice,
  compact = false,
  hideStats = false
}: {
  matterId: string;
  finance: FinancePayload;
  userOptions: UserOption[];
  canRequestInvoice: boolean;
  compact?: boolean;
  /** 上方已有收费概览时隐藏指标网格 */
  hideStats?: boolean;
}) {
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const received = finance.entries
    .filter((e) => e.type === "RECEIVED")
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const { stats } = finance;
  const outstanding = Math.max(stats.receivable - stats.received, 0);

  const cards: { label: string; value: number; tone: StatTone; className?: string }[] = [
    // 非紧凑 6 列：有分成卡时合同额占 2 列、无分成时占 3 列，保证整行填满不留空格
    { label: "合同约定律师费", value: stats.contractAmount, tone: "neutral", className: compact || stats.commission <= 0 ? "col-span-3" : "col-span-3 sm:col-span-2" },
    { label: "已收", value: stats.received, tone: "emerald" },
    { label: "待收", value: outstanding, tone: "amber" },
    { label: "支出", value: stats.cost, tone: "red" },
    // v1.0: 分成降级——没配分成方案的案件不展示该卡（独立律师无此概念）
    ...(stats.commission > 0
      ? [{ label: "分成", value: stats.commission, tone: "neutral" as StatTone }]
      : [])
  ];

  return (
    <section className="card">
      <header className={compact ? "border-b border-border px-3 py-2" : "border-b border-[var(--bd-hair)] px-4 py-3"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="panel-title">
            <Wallet className="h-3.5 w-3.5 text-primary" />
            财务费用
          </span>
          {canRequestInvoice && (
            <Button
              size="sm"
              onClick={() => setInvoiceOpen(true)}
              className="h-6 gap-0.5 px-2 text-[11px]"
            >
              <Receipt className="h-2.5 w-2.5" />
              申请开票
            </Button>
          )}
        </div>
      </header>

      {/* 紧凑指标卡（对照案件云"财务概览"指标看板） */}
      {!hideStats ? (
      <div
        className={
          compact
            ? "grid grid-cols-3 gap-px border-b border-border bg-border"
            : "grid grid-cols-3 gap-px border-b border-border bg-border sm:grid-cols-6"
        }
      >
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            tone={c.tone}
            className={c.className}
            compact={compact}
          />
        ))}
      </div>
      ) : null}

      {received.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          暂无到账记录
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {received.map((e) => (
            <li
              key={e.id}
              className={
                compact
                  ? "flex items-center gap-2 px-3 py-2 text-[12px]"
                  : "flex items-center gap-3 px-4 py-2 text-[12.5px]"
              }
            >
              <span className={cn("shrink-0 font-mono tabular text-[14px] font-medium", e.confirmState === "PENDING" ? "text-[var(--amber)]" : "text-[var(--green)]")}>
                {formatCurrency(Number(e.amount))}
              </span>
              {e.confirmState === "PENDING" ? (
                <span className="badge b-amber shrink-0" title="已登记，等待财务确认到账后才计入已收">待确认</span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {e.payerOrPayee && <span>{e.payerOrPayee}</span>}
                {e.method && (
                  <span className="ml-2 text-[10.5px]">· {e.method}</span>
                )}
                {e.invoiceNo && (
                  <span className="ml-2 font-mono text-[10.5px]">
                    · 发票 {e.invoiceNo}
                  </span>
                )}
                {e.note && <span className="ml-2 text-[10.5px]">· {e.note}</span>}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular text-muted-foreground">
                {formatDate(new Date(e.occurredAt))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canRequestInvoice && (
        <InvoiceRequestSheet
          open={invoiceOpen}
          onOpenChange={setInvoiceOpen}
          matterId={matterId}
        />
      )}
    </section>
  );
}

type StatTone = "emerald" | "neutral" | "amber" | "red";

function StatCard({
  label,
  value,
  tone,
  className,
  compact
}: {
  label: string;
  value: number;
  tone: StatTone;
  className?: string;
  compact?: boolean;
}) {
  const cls =
    tone === "emerald"
      ? "text-[var(--green)]"
      : tone === "amber"
        ? "text-[var(--amber)]"
        : tone === "red"
          ? "text-[var(--red)]"
          : "text-foreground";
  return (
    <div className={`bg-card px-3 text-center ${compact ? "py-2" : "py-2.5"} ${className ?? ""}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-mono leading-none tabular ${compact ? "text-[13px]" : "text-[15px]"} ${cls}`}>
        {formatCurrency(value, { compact: true })}
      </div>
    </div>
  );
}
