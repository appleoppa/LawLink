/** 内部事务服务：入口传入已认证 userId，仍在事务内重新鉴权。 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { allocationInput, paymentBalance, receivableBalance, type AllocateLedgerInput, type LedgerPayment, type LedgerReceivable } from "@/lib/finance/ledger";
import { assertLedgerWrite } from "./ledger-access";
import { requireFinanceLedger } from "./ledger-storage";
import { auditTx } from "@/server/audit";
import { ActionError } from "@/lib/action-error";

const total = (values: Prisma.Decimal[]) => values.reduce((s, n) => s.plus(n), new Prisma.Decimal(0));
export async function lockPayment(db: Prisma.TransactionClient, id: string) {
  const [payment] = await db.$queryRaw<LedgerPayment[]>`SELECT * FROM "Payment" WHERE id=${id} FOR UPDATE`;
  if (!payment) throw new ActionError("实收不存在");
  return payment;
}
export async function assertPaymentSource(db: Prisma.TransactionClient, payment: LedgerPayment) {
  const [source] = await db.$queryRaw<{ matterId: string; type: string; confirmState: string; amount: Prisma.Decimal; moneyKind: string }[]>`
    SELECT "matterId",type::text,"confirmState"::text,amount,"moneyKind"::text FROM "FeeEntry" WHERE id=${payment.feeEntryId}`;
  if (!source || source.matterId !== payment.matterId || source.type !== "RECEIVED" || source.confirmState !== "CONFIRMED" || !source.amount.eq(payment.amount) || source.moneyKind !== payment.moneyKind) throw new ActionError("实收与已确认来源流水不一致，不能分配");
}
export async function assertAllocationTotals(db: Prisma.TransactionClient, payment: LedgerPayment) {
  const rows = await db.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT amount-"reversedAmount" AS amount FROM "Allocation" WHERE "paymentId"=${payment.id}`;
  if (!total(rows.map(r => r.amount)).eq(payment.allocatedAmount)) throw new ActionError("实收核销明细与余额不符，请先核对");
}

export async function allocateLedgerTx(db: Prisma.TransactionClient, userId: string, input: AllocateLedgerInput) {
  const data = allocationInput.parse(input);
  await requireFinanceLedger(db);
  // 所有本模块写入先取共同授权锁，再按来源/目标顺序锁定；避免反序死锁。
  const target = await db.payment.findUnique({ where: { id: data.paymentId }, select: { matterId: true } });
  if (!target) throw new ActionError("实收不存在");
  await assertLedgerWrite(db, userId, target.matterId, "finance.write");
  const payment = await lockPayment(db, data.paymentId);
  if (payment.revision !== data.revision) throw new ActionError("此笔实收已变化或请求已处理，请刷新后重试");
  await assertPaymentSource(db, payment);
  await assertAllocationTotals(db, payment);
  const items = [...data.items].sort((a, b) => a.targetId.localeCompare(b.targetId));
  const amount = total(items.map(i => new Prisma.Decimal(i.amount)));
  if (data.kind === "RECEIVABLE") {
    if (amount.gt(paymentBalance(payment))) throw new ActionError("分配合计超过实收未核销余额");
    for (const item of items) {
      const [ar] = await db.$queryRaw<LedgerReceivable[]>`SELECT * FROM "Receivable" WHERE id=${item.targetId} FOR UPDATE`;
      if (!ar || ar.matterId !== payment.matterId) throw new ActionError("应收与实收不属于同一案件");
      if (ar.moneyKind !== payment.moneyKind) throw new ActionError("应收与实收须款项性质相同");
      if (ar.status === "CANCELLED") throw new ActionError("应收已作废");
      const [linked] = await db.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(amount-"reversedAmount"),0) AS amount FROM "Allocation" WHERE "receivableId"=${ar.id}`;
      if (!linked.amount.eq(ar.settledAmount)) throw new ActionError("应收核销明细与余额不符，请先核对");
      const value = new Prisma.Decimal(item.amount);
      if (value.gt(receivableBalance(ar))) throw new ActionError("分配金额超过应收剩余余额");
      await db.$executeRaw`
        INSERT INTO "Allocation" (id,"paymentId","receivableId",amount,"allocatedById")
        VALUES (${randomUUID()},${payment.id},${ar.id},${value},${userId})
        ON CONFLICT ("paymentId","receivableId") DO UPDATE SET amount="Allocation".amount+EXCLUDED.amount`;
      await db.$executeRaw`UPDATE "Receivable" SET "settledAmount"="settledAmount"+${value},
        status=CASE WHEN "settledAmount"+${value}=amount+"adjustmentAmount" THEN 'SETTLED'::"ReceivableStatus" ELSE 'OPEN'::"ReceivableStatus" END,
        revision=revision+1,"updatedAt"=NOW() WHERE id=${ar.id}`;
    }
    await db.$executeRaw`UPDATE "Payment" SET "allocatedAmount"="allocatedAmount"+${amount},
      status=CASE WHEN "allocatedAmount"+${amount}=amount-"refundedAmount" THEN 'FULLY_ALLOCATED'::"PaymentStatus" ELSE 'PARTIAL'::"PaymentStatus" END,
      revision=revision+1,"updatedAt"=NOW() WHERE id=${payment.id}`;
  } else {
    // 发票是律师服务费票据；代收款/性质不明款不能据此变成律师费收入。
    if (payment.moneyKind !== "LAWYER_FEE") throw new ActionError("目前票款关联仅支持律师费实收");
    const [linked] = await db.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(amount-"reversedAmount"),0) AS amount FROM "InvoicePaymentAllocation" WHERE "paymentId"=${payment.id}`;
    if (amount.gt(payment.amount.minus(payment.refundedAmount).minus(linked.amount))) throw new ActionError("分配合计超过实收可关联票据余额");
    for (const item of items) {
      const [invoice] = await db.$queryRaw<{ id: string; matterId: string | null; amount: Prisma.Decimal; status: string }[]>`SELECT id,"matterId",amount,status FROM "InvoiceRequest" WHERE id=${item.targetId} FOR UPDATE`;
      if (!invoice || invoice.matterId !== payment.matterId) throw new ActionError("发票与实收不属于同一案件");
      if (invoice.status !== "ISSUED") throw new ActionError("只有已开具发票可以关联实收");
      const [used] = await db.$queryRaw<{ amount: Prisma.Decimal }[]>`SELECT COALESCE(SUM(amount-"reversedAmount"),0) AS amount FROM "InvoicePaymentAllocation" WHERE "invoiceId"=${invoice.id}`;
      const [ready]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."InvoiceAdjustment"') IS NOT NULL AS ready`;
      const [adjusted]=ready?.ready?await db.$queryRaw<{amount:Prisma.Decimal}[]>`SELECT COALESCE(SUM(amount),0) AS amount FROM "InvoiceAdjustment" WHERE "invoiceId"=${invoice.id}`:[{amount:new Prisma.Decimal(0)}];
      const value = new Prisma.Decimal(item.amount);
      if (value.gt(invoice.amount.minus(adjusted.amount).minus(used.amount))) throw new ActionError("分配金额超过发票未关联金额");
      await db.$executeRaw`INSERT INTO "InvoicePaymentAllocation" (id,"matterId","invoiceId","paymentId",amount,"recordedById","updatedAt")
        VALUES (${randomUUID()},${payment.matterId},${invoice.id},${payment.id},${value},${userId},NOW())
        ON CONFLICT ("invoiceId","paymentId") DO UPDATE SET amount="InvoicePaymentAllocation".amount+EXCLUDED.amount,revision="InvoicePaymentAllocation".revision+1,"updatedAt"=NOW()`;
    }
    await db.$executeRaw`UPDATE "Payment" SET revision=revision+1,"updatedAt"=NOW() WHERE id=${payment.id}`;
  }
  await auditTx(db, { userId, action: data.kind === "RECEIVABLE" ? "FINANCE_ALLOCATION" : "FINANCE_INVOICE_ALLOCATION", targetType: "Payment", targetId: payment.id, detail: { matterId: payment.matterId, previousRevision: data.revision, items: data.items } });
  return { matterId: payment.matterId };
}
