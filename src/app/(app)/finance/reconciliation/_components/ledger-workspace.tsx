"use client";
import {InvoiceAdjustments} from "./invoice-adjustments";
import { ContractWorkspace } from "./contract-workspace";
import { CorrectionWorkspace } from "./correction-workspace";
import { RegistrationWorkspace } from "./registration-workspace";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioChips } from "@/components/ui/radio-chips";
import { MetricCard, Segmented } from "@/components/patterns/moan";
import { formatDate } from "@/lib/utils";
import { moneyKindLabels, dueLabels } from "@/lib/finance/ledger-labels";
import { allocateLedger, type getFinanceLedger } from "@/server/finance/ledger-actions";
import { actionErrorMessage } from "@/lib/action-error";
type Data = Awaited<ReturnType<typeof getFinanceLedger>>;
const yuan = (amount: string) => `¥${Number(amount).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

// 2026-09-21 布局收敛（用户反馈页面过长）：原九个区块单列堆叠改为四个页签分区
// （与 /finance 同款 Segmented 视觉），列表默认折叠为少量行、按需展开——
// 待办与登记动作在默认页签，长表不再把操作区推出首屏。
type Tab = "overview" | "ledger" | "invoices" | "contracts";
const TABLE_LIMIT = 8;
const LIST_LIMIT = 6;

/** 表尾「展开全部 / 收起」——行数超限时折叠展示 */
function ShowMoreFooter({ colSpan, total, expanded, onToggle }: { colSpan: number; total: number; expanded: boolean; onToggle: () => void }) {
  if (total <= 0) return null;
  return <tr><td colSpan={colSpan} className="p-2 text-center">
    <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
      {expanded ? "收起" : `展开全部 ${total} 条`}
    </button>
  </td></tr>;
}

export function LedgerWorkspace({ data, canWrite, canConfirm, canCorrect, canSettle, selectedMatterId }: { data: Data; canWrite: boolean; canConfirm:boolean; canCorrect:boolean; canSettle:boolean; selectedMatterId?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [showAllReceivables, setShowAllReceivables] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [payment, setPayment] = useState<Data["payments"][number] | null>(null);
  const [kind, setKind] = useState<"RECEIVABLE" | "INVOICE">("RECEIVABLE");
  const [amounts, setAmounts] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const matters = new Map(data.matters.map(m => [m.id,m]));
  const matterName = (id: string) => `${matters.get(id)?.internalCode ?? ""} · ${matters.get(id)?.title ?? "案件"}`;
  // 归档案件默认只读；本案指定的财务收尾人（tailWritable）仍可分配收款/关联票款
  const writable = (id: string) => data.ready && (matters.get(id)?.status !== "ARCHIVED" || matters.get(id)?.tailWritable === true);
  const startAllocation = (value: Data["payments"][number]) => { setPayment(value); setKind("RECEIVABLE"); setAmounts({}); };
  const targets = !payment ? [] : kind === "RECEIVABLE"
    ? data.receivables.filter(r => r.matterId === payment.matterId && r.moneyKind === payment.moneyKind && r.status !== "CANCELLED" && Number(r.outstanding)>0).map(r => ({id:r.id,title:r.title,remaining:r.outstanding,dueAt:r.dueDate?new Date(r.dueDate).getTime():Number.MAX_SAFE_INTEGER})).sort((a,b)=>a.dueAt-b.dueAt)
    : data.invoices.filter(i => i.matterId === payment.matterId && Number(i.outstanding)>0).map(i => ({id:i.id,title:`发票 ${i.invoiceNo ?? "未填写号码"}`,remaining:i.outstanding}));
  async function submitAllocation(event: React.FormEvent) {
    event.preventDefault(); if (!payment) return; setBusy(true);
    try {
      const result = await allocateLedger({ paymentId: payment.id, revision: payment.revision, kind, items: targets.filter(t => amounts[t.id]?.trim()).map(t => ({targetId:t.id,amount:amounts[t.id]})) });
      if(!result.ok)throw new Error(result.message);
      toast.success(kind === "RECEIVABLE" ? "已分配收款" : "已关联票款"); setPayment(null); router.refresh();
    } catch(e) { toast.error(e instanceof Error ? actionErrorMessage(e) : "分配失败"); } finally { setBusy(false); }
  }
  if (!data.ready) return <p className="rounded-xl border bg-card p-5 text-sm">应收与收款分配尚未启用，请待财务流程更新完成后使用。</p>;

  const openReceivables = data.receivables.filter(r => r.status !== "CANCELLED" && Number(r.outstanding) > 0);
  const unallocatedPayments = data.payments.filter(p => Number(p.unallocated) > 0);
  const receivableRows = showAllReceivables ? data.receivables : data.receivables.slice(0, TABLE_LIMIT);
  const paymentRows = showAllPayments ? data.payments : data.payments.slice(0, TABLE_LIMIT);
  const invoiceRows = showAllInvoices ? data.invoices : data.invoices.slice(0, LIST_LIMIT);

  return <>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Label htmlFor="ledger-matter">案件范围</Label>
      <select id="ledger-matter" className="rounded-md border bg-background p-2" value={selectedMatterId ?? ""} onChange={e => router.push(e.target.value ? `/finance/reconciliation?matterId=${encodeURIComponent(e.target.value)}` : "/finance/reconciliation")}>
        <option value="">全部可见案件</option>{data.matters.map(m => <option key={m.id} value={m.id}>{m.internalCode} · {m.title}</option>)}
      </select>
      {selectedMatterId ? <Link className="text-primary underline" href={`/matters/${selectedMatterId}`}>返回案件</Link> : null}
    </div>

    <div className="fin-tabs">
      <Segmented<Tab>
        items={[
          { key: "overview", label: "总览与登记", count: data.pending.length || null },
          { key: "ledger", label: "应收与收款", count: openReceivables.length || null },
          { key: "invoices", label: "发票关联" },
          { key: "contracts", label: "合同与更正" }
        ]}
        value={tab}
        onChange={setTab}
      />
    </div>

    {tab === "overview" ? <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="应收余额" value={yuan(data.summary.outstanding)} sub="应收及已确认调整 − 有效核销" />
        <MetricCard label="净收款" value={yuan(data.summary.netReceived)} sub="已确认收款 − 已确认退款" />
        <MetricCard label="律师费实收" value={yuan(data.summary.lawyerFeeReceived)} sub={`代收款另计 ${yuan(data.summary.clientFundsReceived)}`} />
        <MetricCard label="未分配收款" value={yuan(data.summary.unallocated)} sub="尚未核销应收；票款单独关联" />
      </div>
      <RegistrationWorkspace data={data} canWrite={canWrite} canConfirm={canConfirm} selectedMatterId={selectedMatterId} />
    </> : null}

    {tab === "ledger" ? <>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 font-semibold">应收计划与余额</h2>
        <p className="mb-3 text-xs text-muted-foreground">未结清 {openReceivables.length} 项 · 共 {data.receivables.length} 条{data.receivables.length > TABLE_LIMIT && !showAllReceivables ? ` · 当前显示前 ${TABLE_LIMIT} 条` : ""}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">案件 / 应收</th><th>款项性质</th><th>原额 / 调整</th><th>待收</th><th>到期情况</th></tr></thead><tbody>
          {receivableRows.map(r => <tr key={r.id} className="border-b"><td className="p-2"><div>{r.title}</div><div className="text-xs text-muted-foreground">{matterName(r.matterId)}</div></td><td>{moneyKindLabels[r.moneyKind]}</td><td>{yuan(r.amount)} / {yuan(r.adjustmentAmount)}</td><td>{yuan(r.outstanding)}</td><td>{r.status === "CANCELLED" ? "已作废" : r.status === "SETTLED" ? "已结清" : dueLabels[r.dueBucket]}{r.dueDate ? <div className="text-xs">到期日 {formatDate(r.dueDate)}</div> : null}{r.dueCondition ? <div className="text-xs">{r.dueCondition}</div> : null}</td></tr>)}
          {!data.receivables.length ? <tr><td colSpan={5} className="p-5 text-muted-foreground">暂无应收计划</td></tr> : null}
          <ShowMoreFooter colSpan={5} total={data.receivables.length} expanded={showAllReceivables} onToggle={() => setShowAllReceivables(!showAllReceivables)} />
        </tbody></table></div>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 font-semibold">实收与分配</h2>
        <p className="mb-3 text-xs text-muted-foreground">未核销 {unallocatedPayments.length} 笔 · 共 {data.payments.length} 条{data.payments.length > TABLE_LIMIT && !showAllPayments ? ` · 当前显示前 ${TABLE_LIMIT} 条` : ""}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">案件 / 日期</th><th>款项性质</th><th>原始收款 / 退款</th><th>未核销</th><th>操作</th></tr></thead><tbody>
          {paymentRows.map(p => <tr key={p.id} className="border-b"><td className="p-2">{matterName(p.matterId)}<div className="text-xs text-muted-foreground">{formatDate(p.occurredAt)}</div></td><td>{moneyKindLabels[p.moneyKind]}</td><td>{yuan(p.amount)} / {yuan(p.refundedAmount)}</td><td>{yuan(p.unallocated)}</td><td>{canWrite && writable(p.matterId) ? <button className="btn btn-secondary btn-sm" onClick={() => startAllocation(p)}>分配收款</button> : "仅查看"}</td></tr>)}
          {!data.payments.length ? <tr><td colSpan={5} className="p-5 text-muted-foreground">暂无实收记录；待确认款不列入此表</td></tr> : null}
          <ShowMoreFooter colSpan={5} total={data.payments.length} expanded={showAllPayments} onToggle={() => setShowAllPayments(!showAllPayments)} />
        </tbody></table></div>
      </section>
    </> : null}

    {tab === "invoices" ? <>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">发票金额关联</h2>
        <p className="mb-3 text-xs text-muted-foreground">这里仅按已建立的金额关系计算；未关联金额不直接等于客户欠款。共 {data.invoices.length} 张{data.invoices.length > LIST_LIMIT && !showAllInvoices ? ` · 当前显示前 ${LIST_LIMIT} 张` : ""}</p>
        <ul className="divide-y">{invoiceRows.map(i => <li key={i.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{matterName(i.matterId!)} · {i.invoiceNo ?? "未填写发票号"}</span><span>有效票面 {yuan(i.amount)} · 已关联 {yuan(i.linked)} · 未关联 {yuan(i.outstanding)}</span></li>)}{!data.invoices.length ? <li className="py-3 text-sm text-muted-foreground">暂无已开具发票</li> : null}</ul>
        {data.invoices.length > LIST_LIMIT ? (
          <div className="pt-2 text-center">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllInvoices(!showAllInvoices)}>
              {showAllInvoices ? "收起" : `展开全部 ${data.invoices.length} 张`}
            </button>
          </div>
        ) : null}
      </section>
      <InvoiceAdjustments data={data} canCorrect={canCorrect}/>
    </> : null}

    {tab === "contracts" ? <>
      <ContractWorkspace data={data} canWrite={canWrite} canCorrect={canCorrect} />
      <CorrectionWorkspace data={data} canWrite={canWrite} canCorrect={canCorrect} canSettle={canSettle} />
    </> : null}

    <Dialog open={Boolean(payment)} onOpenChange={open => { if (!open && !busy) setPayment(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>分配收款</DialogTitle><DialogDescription>同一笔款可核销应收，也可关联发票；两个维度独立计算可用余额。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitAllocation}>
      <RadioChips items={[{value:"RECEIVABLE",label:"核销应收"},...(payment?.moneyKind === "LAWYER_FEE" ? [{value:"INVOICE",label:"关联发票"}] : [])]} value={kind} onChange={v => {setKind(v as typeof kind);setAmounts({});}} />
      {targets.length ? <>
        {/* M-3a（D 批）：生成分配建议→预览→确认——按最早到期自动填满（同案同性质），未分配余额保持可见 */}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => {
          let left = Number(payment!.unallocated);
          const next: Record<string,string> = {};
          for (const t of targets) {
            const take = Math.min(left, Number(t.remaining));
            if (take > 0) { next[t.id] = take.toFixed(2); left = Math.round((left - take) * 100) / 100; }
          }
          setAmounts(next);
          toast.info(left > 0 ? `已按到期顺序填满，剩余 ¥${left.toFixed(2)} 未分配（无更多未结清应收）` : "已按最早到期顺序填满本次收款");
        }}>按最早到期自动填满</button>
        {targets.map(t => <div key={t.id}><Label htmlFor={`amount-${t.id}`}>{t.title} · 剩余 {yuan(t.remaining)}</Label><Input id={`amount-${t.id}`} inputMode="decimal" placeholder="本次分配金额；不分配可留空" value={amounts[t.id] ?? ""} onChange={e => setAmounts({...amounts,[t.id]:e.target.value})} /></div>)}
      </> : <p className="text-sm text-muted-foreground">暂无同案同类款项的未结清应收或发票。</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !targets.length}>{busy ? "保存中…" : "确认分配"}</button>
    </form></DialogContent></Dialog>
  </>;
}
