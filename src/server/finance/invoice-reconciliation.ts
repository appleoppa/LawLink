"use server";

import { getFinanceFacts } from "./facts";
import type { InvoiceReconciliation } from "@/lib/finance/invoice-reconciliation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { matterFinanceVisibilityFilter } from "@/lib/permissions";
import { reconcileInvoiceReceipts } from "@/lib/finance/invoice-reconciliation";
import { Prisma } from "@prisma/client";

/** 财务授权范围内的完整快照，不使用流水页截断数据或审批授权代替财务授权。 */
export async function getInvoiceReconciliation() {
  const session = await requireSession("finance.read");
  const matter = { deletedAt: null, ...matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) };
  const facts=await getFinanceFacts(matter);
  if(facts)return facts.invoices.map((i):InvoiceReconciliation=>({id:i.id,status:i.linked.eq(i.amount)?"SETTLED":i.linked.gt(0)?"PARTIAL":"UNPAID",received:i.linked.toNumber(),outstanding:i.amount.minus(i.linked).toNumber(),reason:null}));
  return prisma.$transaction(async (tx) => {
    const [invoices, entries, payments, receivables] = await Promise.all([
      tx.invoiceRequest.findMany({ where: { status: "ISSUED", matter }, select: { id: true, matterId: true, invoiceNo: true, amount: true } }),
      tx.feeEntry.findMany({ where: { matter, type: { in: ["RECEIVED", "REFUND"] } }, select: { id: true, matterId: true, type: true, invoiceNo: true, amount: true, confirmState: true } }),
      tx.payment.findMany({ where: { matter }, select: { id: true, matterId: true } }),
      tx.receivable.findMany({ where: { matter }, select: { id: true, matterId: true } })
    ]);
    const targets = new Map([...entries, ...payments, ...receivables].map((r) => [r.id, r.matterId]));
    const corrections = await tx.financeCorrection.findMany({
      where: { OR: [
        { targetType: "FeeEntry", targetId: { in: entries.map((r) => r.id) } },
        { targetType: "Payment", targetId: { in: payments.map((r) => r.id) } },
        { targetType: "Receivable", targetId: { in: receivables.map((r) => r.id) } }
      ] }, select: { targetId: true }
    });
    const uncertain = new Set(entries.filter((r) => r.type === "REFUND").map((r) => r.matterId));
    for (const correction of corrections) {
      const id = targets.get(correction.targetId);
      if (id) uncertain.add(id);
    }
    return reconcileInvoiceReceipts(invoices, entries.filter((r) => r.type === "RECEIVED"), uncertain);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
