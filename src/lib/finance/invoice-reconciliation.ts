import { Prisma } from "@prisma/client";

type Invoice = { id: string; matterId: string | null; invoiceNo: string | null; amount: Prisma.Decimal | number | string };
type Receipt = { matterId: string; invoiceNo: string | null; amount: Prisma.Decimal | number | string; confirmState: string };
export type InvoiceReconciliation = {
  id: string;
  status: "UNPAID" | "PARTIAL" | "REVIEW" | "SETTLED";
  received: number;
  outstanding: number | null;
  reason: string | null;
};

/** 旧数据仅按同案唯一票号核对；不把号码匹配当作正式金额关联。 */
export function reconcileInvoiceReceipts(invoices: Invoice[], receipts: Receipt[], uncertainMatterIds: ReadonlySet<string>): InvoiceReconciliation[] {
  const key = (matterId: string, invoiceNo: string) => JSON.stringify([matterId, invoiceNo.trim()]);
  const counts = new Map<string, number>();
  const sums = new Map<string, Prisma.Decimal>();
  const uncertain = new Set(uncertainMatterIds);
  for (const invoice of invoices) {
    if (!invoice.matterId || !invoice.invoiceNo?.trim()) continue;
    const k = key(invoice.matterId, invoice.invoiceNo);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const receipt of receipts) {
    if (receipt.confirmState !== "CONFIRMED") continue;
    const amount = new Prisma.Decimal(receipt.amount);
    if (!receipt.invoiceNo?.trim() || amount.lte(0)) {
      uncertain.add(receipt.matterId);
      continue;
    }
    const k = key(receipt.matterId, receipt.invoiceNo);
    sums.set(k, (sums.get(k) ?? new Prisma.Decimal(0)).plus(amount));
  }
  return invoices.map((invoice) => {
    const k = invoice.matterId && invoice.invoiceNo?.trim() ? key(invoice.matterId, invoice.invoiceNo) : null;
    const amount = new Prisma.Decimal(invoice.amount);
    const received = k ? sums.get(k) ?? new Prisma.Decimal(0) : new Prisma.Decimal(0);
    const reason = !k ? "未关联案件或未填写发票号"
      : counts.get(k)! > 1 ? "本案有重复发票号，无法确定款项归属"
      : uncertain.has(invoice.matterId!) ? "本案有退款、更正或未明确票号的收款，需核对"
      : amount.lte(0) || received.gt(amount) ? "票款金额异常，需核对"
      : received.eq(amount) ? "票号金额相符，尚待建立正式金额关联"
      : null;
    return {
      id: invoice.id,
      status: reason ? "REVIEW" : received.gt(0) ? "PARTIAL" : "UNPAID",
      received: received.toNumber(),
      outstanding: reason ? null : amount.minus(received).toNumber(),
      reason
    };
  });
}
