"use client";
import { useState } from "react";
import Link from "next/link";
import { Receipt, Clock, CheckCircle2, XCircle, Download, FileText, FileCheck2 } from "lucide-react";
import type { InvoiceRequestStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { invoiceRequestStatusLabel, invoiceRequestStatusColor } from "@/lib/enums";
import { formatCurrency, cn } from "@/lib/utils";
import { approvalHref } from "@/lib/approvals/workspace";
import type { InvoiceRequestRow } from "./finance-view";
import { matterHref } from "@/lib/matters/route";
import { shMonthDayTime } from "@/lib/ui/sh-time";

const STATUS_TABS: { key: InvoiceRequestStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "待处理" },
  { key: "ISSUED", label: "已开具" },
  { key: "REJECTED", label: "已驳回" },
  { key: "ALL", label: "全部" }
];

const INVOICE_TYPE_LABEL = {
  PLAIN: "普通发票",
  SPECIAL: "增值税专用发票"
} as const;

const INVOICE_ITEM_LABEL = {
  LAWYER_FEE: "律师服务费",
  CONSULTING_FEE: "法律咨询费",
  AGENCY_FEE: "代理费",
  OTHER: "其他法律服务"
} as const;

export function InvoiceManagementSection({
  requests,
  canApprove
}: {
  requests: InvoiceRequestRow[];
  canApprove: boolean;
}) {
  const [filter, setFilter] = useState<InvoiceRequestStatus | "ALL">("PENDING");

  const filtered = requests.filter((r) => filter === "ALL" || r.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {STATUS_TABS.map((t) => {
          const count =
            t.key === "ALL"
              ? requests.length
              : requests.filter((r) => r.status === t.key).length;
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-popover/50 hover:text-foreground"
              )}
            >
              {t.label}
              <span className="font-mono text-[10px] tabular opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <section className="rounded-xl border border-border bg-muted/30">
        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Receipt className="mx-auto mb-2 h-5 w-5 opacity-50" />
            没有匹配的开票申请
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => {
              const color = invoiceRequestStatusColor[r.status];
              const Icon =
                r.status === "PENDING"
                  ? Clock
                  : r.status === "ISSUED" || r.status === "APPROVED"
                    ? CheckCircle2
                    : XCircle;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-popover/30"
                >
                  <span
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium"
                    style={{ borderColor: `${color}50`, color }}
                  >
                    <Icon className="h-3 w-3" />
                    {invoiceRequestStatusLabel[r.status]}
                  </span>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base tabular font-semibold text-foreground">
                        {formatCurrency(Number(r.amount))}
                      </span>
                      {r.title && (
                        <span className="text-sm text-muted-foreground">· {r.title}</span>
                      )}
                    </div>
                    {r.matter ? (
                      <Link
                        href={matterHref(r.matter)}
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                      >
                        <span className="font-mono">{r.matter.internalCode}</span>
                        <span>·</span>
                        <span className="truncate">{r.matter.title}</span>
                      </Link>
                    ) : (
                      <div className="mt-0.5 text-xs text-[var(--amber)]" title={r.noMatterReason ?? ""}>
                        无关联案件{r.noMatterReason ? ` · ${r.noMatterReason}` : ""}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      申请：{r.requestedBy.name} ·{" "}
                      {shMonthDayTime(r.requestedAt)}
                      {r.requestNote && <> · 备注：{r.requestNote}</>}
                    </div>
                    {/* v0.42 开票信息（专票六要素供财务直接开票） */}
                    {(r.buyerName || r.invoiceType) && (
                      <div className="mt-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        <div>
                          <span className="text-foreground/70">
                            {r.invoiceType ? INVOICE_TYPE_LABEL[r.invoiceType] : "发票"}
                          </span>
                          {r.invoiceItem && <> · 名目：{INVOICE_ITEM_LABEL[r.invoiceItem]}</>}
                          {r.buyerName && <> · 抬头：{r.buyerName}</>}
                          {r.buyerTaxNo && (
                            <> · 税号：<span className="font-mono">{r.buyerTaxNo}</span></>
                          )}
                        </div>
                        {r.invoiceType === "SPECIAL" &&
                          (r.buyerBank ||
                            r.buyerBankAccount ||
                            r.buyerAddress ||
                            r.buyerPhone) && (
                            <div className="mt-0.5">
                              {r.buyerAddress && <>地址：{r.buyerAddress}　</>}
                              {r.buyerPhone && <>电话：{r.buyerPhone}　</>}
                              {r.buyerBank && <>开户行：{r.buyerBank}　</>}
                              {r.buyerBankAccount && (
                                <>账号：<span className="font-mono">{r.buyerBankAccount}</span></>
                              )}
                            </div>
                          )}
                      </div>
                    )}
                    {r.evidenceDocs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.evidenceDocs.map((doc) => (
                          <a
                            key={doc.id}
                            href={`/api/documents/${doc.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-64 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="truncate">{doc.name}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {r.processNote && (
                      <div className="mt-1 text-[11px] text-destructive/80">
                        财务备注：{r.processNote}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.contractScan && (
                      <a
                        href={`/api/documents/${r.contractScan.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <FileCheck2 className="h-3 w-3" />
                        历史合同
                      </a>
                    )}
                    {r.invoiceFile && (
                      <a
                        href={`/api/documents/${r.invoiceFile.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-[11px] text-primary"
                      >
                        <Download className="h-3 w-3" />
                        电子发票
                      </a>
                    )}
                    <Button size="sm" variant="outline" asChild><Link href={approvalHref("INVOICE_APPROVE", r.id)}>{canApprove && r.status === "PENDING" ? "前往审批工作台" : canApprove && r.status === "APPROVED" ? "前往开票回填" : "查看审批记录"}</Link></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>


    </div>
  );
}
