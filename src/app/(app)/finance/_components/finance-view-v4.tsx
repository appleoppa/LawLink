"use client";

/**
 * 财务页壳（墨案 08 效果图 · 从零重写，替代旧 finance-view 的渲染路径）。
 * 布局 = 效果图：22px 页头+副文 / KPI 四卡（待回款红卡+回款率进度条）/ 胶囊分段 /
 * 趋势图+开票进度 / 收付流水真表格（案卷脊+金额看色+冲正徽）。
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Coins, TrendingUp, FileText, Receipt, Download } from "lucide-react";
import type { InvoiceRequestRow } from "./finance-view";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { InvoiceManagementSection } from "./invoice-management";
import { InvoiceCreateDialog } from "./invoice-create-dialog";
import { formatCurrency, cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";

type Entry = {
  id: string;
  type: "RECEIVABLE" | "RECEIVED" | "REFUND" | "COST" | "COMMISSION";
  amount: number;
  occurredAt: Date;
  payerOrPayee: string | null;
  note: string | null;
  matter: { id: string; internalCode: string; title: string };
  beneficiaryUser: { id: string; name: string } | null;
  recordedBy: { id: string; name: string };
};

type Props = {
  entries: Entry[];
  monthly: { month: string; received: number; receivable: number }[];
  stats: {
    monthlyReceived: number;
    monthlyReceivable: number;
    yearlyReceived: number;
    personalMonthly: number;
    personalYearly: number;
    monthlyIssued: number;
    pendingInvoiceCount: number;
  };
  invoiceRequests: InvoiceRequestRow[];
  canApproveInvoice: boolean;
};

const TYPE_LABEL: Record<Entry["type"], string> = {
  RECEIVABLE: "应收", RECEIVED: "实收", REFUND: "冲正", COST: "支出", COMMISSION: "分成"
};
const TYPE_COLOR: Record<Entry["type"], string> = {
  RECEIVABLE: "#96650B", RECEIVED: "#1A7F45", REFUND: "#B42318", COST: "#4A5560", COMMISSION: "#6C3FC5"
};

const pillCls = "inline-flex h-[32px] items-center gap-1.5 rounded-full border border-[#CFD7D3] bg-card px-3.5 text-[12.5px] text-muted-foreground shadow-[0_1px_2px_rgba(12,25,39,0.05)] transition-colors hover:border-input hover:bg-muted [&>select]:bg-transparent [&>select]:text-[12.5px] [&>select]:text-foreground [&>select]:outline-none";

export function FinanceViewV4({ entries, monthly, stats, invoiceRequests, canApproveInvoice }: Props) {
  const [tab, setTab] = useState<"overview" | "invoices">("overview");
  const [typeFilter, setTypeFilter] = useState<"ALL" | Entry["type"]>("ALL");
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);

  const filtered = useMemo(() => typeFilter === "ALL" ? entries : entries.filter(e => e.type === typeFilter), [entries, typeFilter]);
  const pendingAmount = Math.max(0, stats.monthlyReceivable - stats.monthlyReceived);
  const receivableRate = stats.monthlyReceivable > 0 ? Math.round((stats.monthlyReceived / stats.monthlyReceivable) * 100) : 0;

  const kpis = [
    { label: "本月实收", value: formatCurrency(stats.monthlyReceived, { compact: true }), icon: Coins, bg: "#E7F3EA", color: "#1A7F45" },
    { label: "本月待回款", value: formatCurrency(pendingAmount, { compact: true }), icon: TrendingUp, bg: stats.monthlyReceivable > stats.monthlyReceived ? "#FBECE9" : "#FAF0DB", color: pendingAmount > 0 ? "#B42318" : "#96650B", accent: stats.monthlyReceivable > stats.monthlyReceived },
    { label: "本月已开票", value: formatCurrency(stats.monthlyIssued, { compact: true }), icon: FileText, bg: "#E9EEFA", color: "#1E56C8" },
    { label: "本月回款率", value: `${receivableRate}%`, icon: Receipt, bg: "#E4F1F0", color: "#007B7F", progress: receivableRate }
  ];

  return (
    <div className="space-y-3.5 pb-8">
      {/* 页头（效果图 08） */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">财务</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {new Date().getFullYear()} 年 {new Date().getMonth() + 1} 月 · 数据截至 {new Date().toLocaleDateString("zh-CN")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/finance/export" className="btn btn-secondary btn-sm"><Download className="h-3.5 w-3.5" />导出流水</a>
        </div>
      </div>

      {/* KPI 四卡（效果图 08：待回款红卡 + 回款率进度条） */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(12,25,39,0.05)]"
              style={k.accent ? { borderColor: "#F0C6BF", background: "linear-gradient(180deg,#FFFFFF 55%,#FBECE9 165%)" } : { borderColor: "#E8ECEA" }}>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: k.bg, color: k.color }}><Icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
                <span className="text-[11.5px] text-muted-foreground">{k.label}</span>
              </div>
              <div className="mt-2.5 font-mono text-[24px] font-semibold leading-none tabular" style={{ color: k.accent ? "#B42318" : "var(--foreground)" }}>{k.value}</div>
              {typeof k.progress === "number" && (
                <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, k.progress)}%`, background: k.color }} /></div>
              )}
            </div>
          );
        })}
      </div>

      {/* 分段（效果图 08） */}
      <div className="inline-flex gap-0.5 rounded-[10px] bg-[#E9EDEB] p-[3px]">
        {[{ k: "overview", l: "收付流水" }, { k: "invoices", l: `开票管理${stats.pendingInvoiceCount > 0 ? ` ${stats.pendingInvoiceCount}` : ""}` }].map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k as "overview" | "invoices")}
            className={cn("inline-flex h-[30px] items-center rounded-[7px] px-3.5 text-[12.5px] transition-colors", tab === t.k ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(12,25,39,0.08)]" : "text-muted-foreground hover:text-foreground")}>{t.l}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          {/* 趋势图（效果图 08） */}
          <RevenueChart data={monthly} />

          {/* 收付流水表（效果图 08：案卷脊 + 金额看色 + 冲正徽） */}
          <div className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-[3px] rounded-full bg-primary" />
                <h2 className="text-[13px] font-semibold">收付流水<span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{filtered.length}</span></h2>
              </div>
              <label className={pillCls}>类型
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as "ALL" | Entry["type"])}>
                  <option value="ALL">全部</option>
                  {(Object.keys(TYPE_LABEL) as Entry["type"][]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </label>
            </div>
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">没有匹配的记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr>
                    <th style={{ width: "9%" }}>日期</th><th style={{ width: "26%" }}>案件 / 事项</th><th style={{ width: "9%" }}>类型</th>
                    <th style={{ width: "12%" }} className="th-num">金额</th><th style={{ width: "13%" }}>归属 / 分成</th>
                    <th style={{ width: "13%" }}>备注</th><th style={{ width: "10%" }}>经手</th><th style={{ width: "8%" }}>状态</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(e => {
                      const color = TYPE_COLOR[e.type];
                      return (
                        <tr key={e.id} className="transition-colors hover:bg-muted/50">
                          <td className="relative px-4 py-2.5 pl-[18px] font-mono text-[12px] text-muted-foreground tabular">
                            <span aria-hidden className="absolute left-0 top-[9px] bottom-[9px] w-[3px] rounded-r-[2px]" style={{ background: color }} />
                            {new Date(e.occurredAt).toLocaleDateString("zh-CN")}
                          </td>
                          <td className="max-w-[16rem] px-4 py-2.5">
                            <Link href={matterHref(e.matter)} className="block min-w-0 no-underline hover:text-primary">
                              <span className="block truncate text-[12.75px] font-medium text-foreground">{e.matter.title}</span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground tabular">{e.matter.internalCode}</span>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex h-5 items-center rounded-full border px-2 text-[10.5px] font-medium" style={{ borderColor: `${color}50`, background: `${color}12`, color }}>{TYPE_LABEL[e.type]}</span>
                            {e.type === "REFUND" && <span className="badge b-red mt-1" style={{ height: 18, fontSize: 10 }}>冲正</span>}
                          </td>
                          <td className="td-num px-4 py-2.5 font-mono text-[13px] font-semibold tabular" style={{ color: e.type === "RECEIVED" ? "#1A7F45" : e.type === "REFUND" ? "#B42318" : undefined }}>
                            {e.type === "RECEIVED" ? "+" : e.type === "REFUND" ? "−" : ""}{formatCurrency(e.amount)}
                          </td>
                          <td className="max-w-[10rem] truncate px-4 py-2.5 text-[12px] text-muted-foreground">{e.beneficiaryUser ? `→ ${e.beneficiaryUser.name}` : "所内"}</td>
                          <td className="max-w-[10rem] truncate px-4 py-2.5 text-[11.5px] text-muted-foreground">{e.note || "—"}</td>
                          <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{e.recordedBy.name}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn("badge", e.type === "RECEIVED" ? "b-green" : e.type === "REFUND" ? "b-red" : "b-slate")}><span className="bdot" />{e.type === "REFUND" ? "已冲正" : "已确认"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-[#E8ECEA] bg-muted/40 px-4 py-2.5 text-[11.5px] text-muted-foreground">已确认记录受保护：删除需走关联更正流程并留痕</p>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setInvoiceCreateOpen(true)} className="btn btn-primary btn-sm">新建开票申请</button>
          </div>
          <InvoiceManagementSection requests={invoiceRequests} canApprove={canApproveInvoice} />
        </>
      )}

      <InvoiceCreateDialog open={invoiceCreateOpen} onOpenChange={setInvoiceCreateOpen} canCreateUnlinkedInvoice={canApproveInvoice} />
    </div>
  );
}
