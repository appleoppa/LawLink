/** 候选结构的唯一接入层；结构就绪后直接读取新记录，不转换旧账。 */
import { Prisma } from "@prisma/client";
import { summarizeLedger, type LedgerReceivable, type LedgerPayment, type LedgerInvoice } from "@/lib/finance/ledger";
import { ActionError } from "@/lib/action-error";

export async function financeLedgerReady(db: Prisma.TransactionClient) {
  const [row] = await db.$queryRaw<{ ready: boolean }[]>`
    SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN
      ('BillingProcedureScope','BillingAttachment','InvoicePaymentAllocation','FinanceCorrectionEffect','CommissionSettlement')) = 5
    AND (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN
      ('Receivable_balance_check','Payment_balance_check','InvoicePaymentAllocation_balance_check',
       'Billing_amendment_source_check','Receivable_due_state_check','Allocation_balance_check','FinanceCorrection_subject_check','FinanceCorrection_confirmation_check','FinanceCorrectionEffect_target_check','CommissionSettlement_record_check')) = 10
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Payment' AND column_name='moneyKind' AND is_nullable='NO' AND column_default IS NULL)
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Payment' AND column_name='reviewState')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='FinanceCorrection' AND column_name='requestPayload' AND is_nullable='NO')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Billing' AND column_name='draftTerms')
    AS ready`;
  return row?.ready === true;
}
export async function requireFinanceLedger(db: Prisma.TransactionClient) {
  if (!await financeLedgerReady(db)) throw new ActionError("应收与收款分配尚未启用，请由管理员完成已批准的财务升级后再操作");
}

export async function readLedger(db: Prisma.TransactionClient, matterIds: string[]) {
  const ready = await financeLedgerReady(db);
  if (!ready || matterIds.length === 0) return { ready, receivables: [] as LedgerReceivable[], payments: [] as LedgerPayment[], invoices: [] as LedgerInvoice[], summary: summarizeLedger([], []) };
  const ids = Prisma.join(matterIds);
  const receivables = await db.$queryRaw<LedgerReceivable[]>(Prisma.sql`
    SELECT id, "matterId", title, amount, "settledAmount", status::text, "dueDate", "billingId", "moneyKind"::text, revision,
      "adjustmentAmount", "dueState"::text, "dueCondition", "conditionSatisfiedAt"
    FROM "Receivable" WHERE "matterId" IN (${ids}) ORDER BY "createdAt", id`);
  const rawPayments = await db.$queryRaw<Omit<LedgerPayment, "sourceValid">[]>(Prisma.sql`
    SELECT id, "matterId", amount, "allocatedAmount", "feeEntryId", "occurredAt", "moneyKind"::text, revision,
      "refundedAmount"
    FROM "Payment" WHERE "matterId" IN (${ids}) ORDER BY "occurredAt", id`);
  const entries = await db.$queryRaw<{ id: string; matterId: string; amount: Prisma.Decimal; confirmState: string; moneyKind: string }[]>(Prisma.sql`
    SELECT id,"matterId",amount,"confirmState"::text,"moneyKind"::text FROM "FeeEntry" WHERE "matterId" IN (${ids}) AND type='RECEIVED'`);
  const sources = new Map(entries.map(e => [e.id, e]));
  const payments: LedgerPayment[] = rawPayments.map(p => {
    const entry = p.feeEntryId ? sources.get(p.feeEntryId) : undefined;
    return { ...p, sourceValid: Boolean(entry && entry.matterId === p.matterId && entry.confirmState === "CONFIRMED" && entry.amount.eq(p.amount) && entry.moneyKind === p.moneyKind) };
  });
  const [adjustments]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."InvoiceAdjustment"') IS NOT NULL AS ready`;
  const invoiceAmount=adjustments?.ready?Prisma.sql`i.amount-COALESCE((SELECT SUM(j.amount) FROM "InvoiceAdjustment" j WHERE j."invoiceId"=i.id),0)`:Prisma.sql`i.amount`;
  const invoices = await db.$queryRaw<LedgerInvoice[]>(Prisma.sql`
    SELECT i.id, i."matterId", i."invoiceNo", ${invoiceAmount} AS amount,
      COALESCE((SELECT SUM(a.amount-a."reversedAmount") FROM "InvoicePaymentAllocation" a WHERE a."invoiceId"=i.id),0) AS linked
    FROM "InvoiceRequest" i WHERE i."matterId" IN (${ids}) AND i.status='ISSUED' ORDER BY i."createdAt", i.id`);
  return { ready, receivables, payments, invoices, summary: summarizeLedger(receivables, payments) };
}
