"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  Coins,
  TrendingUp,
  Percent,
  Receipt,
  FileText
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";

const feeTypeLabel = {
  RECEIVABLE: "应收",
  RECEIVED: "实收",
  REFUND: "退款",
  COST: "成本",
  COMMISSION: "分成"
} as const;

/* 墨案 08：流水类型色（绿=实收终态 / 琥珀=应收待回 / 红=冲正更正记录 / 石板=支出 / 紫=分成） */
const feeTypeColor: Record<keyof typeof feeTypeLabel, string> = {
  RECEIVABLE: "#96650B",
  RECEIVED: "#1A7F45",
  REFUND: "#B42318",
  COST: "#4A5560",
  COMMISSION: "#6C3FC5"
};

type Entry = {
  id: string;
  type: keyof typeof feeTypeLabel;
  amount: number;
  occurredAt: Date;
  payerOrPayee: string | null;
  note: string | null;
  matter: { id: string; internalCode: string; title: string };
  beneficiaryUser: { id: string; name: string } | null;
  recordedBy: { id: string; name: string };
};

import type { InvoiceRequestStatus } from "@prisma/client";
import { InvoiceManagementSection } from "./invoice-management";
import { InvoiceCreateDialog } from "./invoice-create-dialog";
import { matterHref } from "@/lib/matters/route";

export type InvoiceRequestRow = {
  id: string;
  amount: number;
  title: string | null;
  status: InvoiceRequestStatus;
  requestNote: string | null;
  requestedAt: Date;
  processedAt: Date | null;
  processNote: string | null;
  invoiceNo: string | null;
  issuedAt: Date | null;
  // v0.42 开票类型 + 抬头 + 专票六要素（来自 InvoiceRequest 标量字段）
  invoiceType: "PLAIN" | "SPECIAL" | null;
  invoiceItem: "LAWYER_FEE" | "CONSULTING_FEE" | "AGENCY_FEE" | "OTHER" | null;
  buyerName: string | null;
  buyerTaxNo: string | null;
  buyerAddress: string | null;
  buyerPhone: string | null;
  buyerBank: string | null;
  buyerBankAccount: string | null;
  // v0.43 项5：matter 可空（无关联案件开票）
  matter: { id: string; internalCode: string; title: string } | null;
  noMatterReason: string | null;
  requestedBy: { id: string; name: string };
  processedBy: { id: string; name: string } | null;
  evidenceDocs: {
    id: string;
    name: string;
    size: number | null;
    mimeType: string | null;
    createdAt: Date;
  }[];
  contractScan: { id: string; name: string } | null;
  invoiceFile: { id: string; name: string } | null;
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

const TYPE_FILTERS: ("ALL" | keyof typeof feeTypeLabel)[] = [
  "ALL",
  "RECEIVED",
  "RECEIVABLE",
  "COST",
  "COMMISSION",
  "REFUND"
];

export function FinanceView({
  entries,
  monthly,
  stats,
  invoiceRequests,
  canApproveInvoice
}: Props) {
  const [typeFilter, setTypeFilter] = useState<"ALL" | keyof typeof feeTypeLabel>("ALL");
  const [tab, setTab] = useState<"overview" | "invoices">("overview");
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);

  const filtered = entries.filter((e) => typeFilter === "ALL" || e.type === typeFilter);

  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h1 className="ll-page-title">财务</h1>
          <p className="ll-page-sub">
              可见范围内的收付流水 + 开票申请 ·{" "}
              <Link href="/matters" className="text-primary hover:underline">
                合同/流水/分成在各案件详情录入
              </Link>
            </p>
        </div>
          <Button size="sm" className="w-fit gap-1.5" onClick={() => setInvoiceCreateOpen(true)}>
            <Receipt className="h-3.5 w-3.5" />
            申请开票
          </Button>
      </header>

      <div className="ll-segmented w-fit">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>
          <Wallet className="h-3.5 w-3.5" strokeWidth={1.8} />
          总览
        </TabBtn>
        <TabBtn active={tab === "invoices"} onClick={() => setTab("invoices")}>
          <Receipt className="h-3.5 w-3.5" strokeWidth={1.8} />
          开票管理
          {stats.pendingInvoiceCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {stats.pendingInvoiceCount}
            </span>
          )}
        </TabBtn>
      </div>

      {tab === "invoices" ? (
        <div className="space-y-3">
          <InvoiceManagementSection
            requests={invoiceRequests}
            canApprove={canApproveInvoice}
          />
        </div>
      ) : (
        <>
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard
          label="本月实收"
          value={stats.monthlyReceived}
          icon={<Coins className="h-3.5 w-3.5" />}
          color="#1A7F45"
        />
        <StatCard
          label="本月待回款"
          value={Math.max(0, stats.monthlyReceivable - stats.monthlyReceived)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          color={stats.monthlyReceivable > stats.monthlyReceived ? "#B42318" : "#96650B"}
          accent={stats.monthlyReceivable > stats.monthlyReceived}
        />
        <StatCard
          label="本月已开票"
          value={stats.monthlyIssued}
          icon={<FileText className="h-3.5 w-3.5" />}
          color="#1E56C8"
        />
        <StatCard
          label="本月回款率"
          value={stats.monthlyReceivable > 0 ? Math.round((stats.monthlyReceived / stats.monthlyReceivable) * 100) : 0}
          icon={<Receipt className="h-3.5 w-3.5" />}
          color="#007B7F"
          suffix="%"
          progress={stats.monthlyReceivable > 0 ? (stats.monthlyReceived / stats.monthlyReceivable) * 100 : 0}
        />
        <StatCard
          label="本年实收"
          value={stats.yearlyReceived}
          icon={<Receipt className="h-3.5 w-3.5" />}
          color="#1E56C8"
        />
        {/* v1.0: 分成降级——从未产生分成时不展示个人分成卡 */}
        {(stats.personalMonthly > 0 || stats.personalYearly > 0) && (
          <>
            <StatCard
              label="我的本月分成"
              value={stats.personalMonthly}
              icon={<Percent className="h-3.5 w-3.5" />}
              color="#6C3FC5"
            />
            <StatCard
              label="我的本年分成"
              value={stats.personalYearly}
              icon={<Percent className="h-3.5 w-3.5" />}
              color="#6C3FC5"
            />
          </>
        )}
      </div>

      {/* 月度趋势图 */}
      <section className="ll-surface">
        <header className="ll-panel-head">
          <h2 className="ll-panel-title">近 6 个月趋势</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: "#1E56C8", boxShadow: "0 0 8px #1E56C8" }}
              />
              实收
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: "#007B7F", boxShadow: "0 0 8px #007B7F" }}
              />
              应收
            </span>
          </div>
        </header>
        <div className="p-3" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthly} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="finance-received" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1E56C8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1E56C8" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="finance-receivable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#007B7F" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#007B7F" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={50}
                tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  fontSize: 12
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Area
                type="monotone"
                dataKey="receivable"
                name="应收"
                stroke="#007B7F"
                strokeWidth={1.5}
                fill="url(#finance-receivable)"
              />
              <Area
                type="monotone"
                dataKey="received"
                name="实收"
                stroke="#1E56C8"
                strokeWidth={2}
                fill="url(#finance-received)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 流水 */}
      <section className="ll-surface overflow-hidden">
        <header className="ll-panel-head">
          <h2 className="ll-panel-title">
            收付流水{" "}
            <span className="text-muted-foreground">({filtered.length})</span>
          </h2>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
          >
            <SelectTrigger className="h-8 w-32 rounded-full bg-card text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "ALL" ? "全部" : feeTypeLabel[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">没有匹配的记录</p>
        ) : (
          /* 墨案 08 效果图：收付流水 = 真实表格（表头 + 案卷脊行 + 等宽金额） */
          <div className="overflow-x-auto">
            <table className="table max-h-[640px]">
              <thead>
                <tr>
                  <th style={{ width: "9%" }}>日期</th>
                  <th style={{ width: "26%" }}>案件 / 事项</th>
                  <th style={{ width: "9%" }}>类型</th>
                  <th style={{ width: "12%" }} className="th-num">金额</th>
                  <th style={{ width: "14%" }}>归属 / 分成</th>
                  <th style={{ width: "12%" }}>备注</th>
                  <th style={{ width: "10%" }}>经手</th>
                  <th style={{ width: "8%" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const color = feeTypeColor[e.type];
                  const isReceived = e.type === "RECEIVED";
                  const isRefund = e.type === "REFUND";
                  return (
                    <tr key={e.id} className="group">
                      <td className="relative px-4 py-2.5 pl-[18px] font-mono text-[12px] text-muted-foreground tabular">
                        <span aria-hidden className="absolute left-0 top-[9px] bottom-[9px] w-[3px] rounded-r-[2px]" style={{ background: color }} />
                        {formatDate(new Date(e.occurredAt))}
                      </td>
                      <td className="max-w-[16rem] px-4 py-2.5">
                        <Link href={matterHref(e.matter)} className="block min-w-0 no-underline hover:text-primary">
                          <span className="block truncate text-[12.75px] font-medium text-foreground">{e.matter.title}</span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground tabular">{e.matter.internalCode}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex h-5 items-center rounded-full border px-2 text-[10.5px] font-medium"
                          style={{ borderColor: `${color}50`, background: `${color}12`, color }}
                        >
                          {feeTypeLabel[e.type]}
                        </span>
                        {isRefund && (
                          <span className="badge b-red mt-1" style={{ height: 18, fontSize: 10 }}>冲正</span>
                        )}
                      </td>
                      <td className="td-num money px-4 py-2.5 font-semibold" style={{ color: isReceived ? "#1A7F45" : isRefund ? "#B42318" : undefined }}>
                        {isReceived ? "+" : isRefund ? "−" : ""}
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="max-w-[10rem] truncate px-4 py-2.5 text-[12px] text-muted-foreground">
                        {e.beneficiaryUser ? `→ ${e.beneficiaryUser.name}` : "所内"}
                      </td>
                      <td className="max-w-[10rem] truncate px-4 py-2.5 text-[11.5px] text-muted-foreground">
                        {e.note || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{e.recordedBy.name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge ${isReceived ? "b-green" : isRefund ? "b-red" : "b-slate"}`}>
                          <span className="bdot" />
                          {isRefund ? "已冲正" : "已确认"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      )}
      <InvoiceCreateDialog
        open={invoiceCreateOpen}
        onOpenChange={setInvoiceCreateOpen}
        canCreateUnlinkedInvoice={canApproveInvoice}
      />
    </div>
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
      className={"ll-seg " + (active ? "ll-seg-active text-primary" : "")}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  accent,
  progress,
  suffix
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  /** 墨案 08：风险强调卡（红描边 + 浅红渐变底） */
  accent?: boolean;
  /** 0-100 进度条（回款率类指标） */
  progress?: number;
  /** 非金额后缀（如 %） */
  suffix?: string;
}) {
  return (
    <div
      className="ll-surface relative overflow-hidden px-4 py-3.5"
      style={accent ? { borderColor: "#F0C6BF", background: "linear-gradient(180deg, #FFFFFF 55%, #FBECE9 165%)" } : undefined}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="ll-stat mt-3 text-[22px] leading-none" style={{ color: accent ? "#B42318" : undefined }}>
        {suffix ? `${value}%` : formatCurrency(value, { compact: true })}
      </div>
      {typeof progress === "number" && (
        <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}
