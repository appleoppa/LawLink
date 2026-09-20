/** 待确认更正、逐项执行及实际分成结算；调用方必须使用 Serializable 事务。 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { correctionInput, correctionDecision, settlementInput, commissionPosition, commissionReversal, type CorrectionInput, type SettlementInput } from "@/lib/finance/corrections";
import { type LedgerPayment, type LedgerReceivable } from "@/lib/finance/ledger";
import { assertLedgerWrite } from "./ledger-access";
import { requireFinanceLedger } from "./ledger-storage";
import { assertPaymentSource, assertAllocationTotals } from "./ledger-mutations";
import { auditTx } from "@/server/audit";

const civilDay = (d: Date) => Math.floor((d.getTime() + 8 * 3600000) / 86400000);
const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const sum = (rows: { amount: string | Prisma.Decimal }[]) => rows.reduce((s, r) => s.plus(r.amount), D(0));
type Link = { id: string; paymentId: string; receivableId: string; amount: Prisma.Decimal; reversedAmount: Prisma.Decimal };
type InvoiceLink = { id: string; paymentId: string; invoiceId: string; amount: Prisma.Decimal; reversedAmount: Prisma.Decimal };
type Commission = { id: string; parentFeeEntryId: string; amount: Prisma.Decimal; commissionBaseSnapshot: Prisma.Decimal | null; revision: number; adjustment: Prisma.Decimal };
type Effect = { kind: "EXPENSE_REVERSAL" | "PAYMENT_REFUND" | "RECEIVABLE_ADJUSTMENT" | "ALLOCATION_REVERSAL" | "INVOICE_ALLOCATION_REVERSAL" | "COMMISSION_ADJUSTMENT"; column: "expenseEntryId" | "paymentId" | "receivableId" | "allocationId" | "invoiceAllocationId" | "commissionEntryId"; id: string; delta: Prisma.Decimal };

export async function correctionPlan(db: Prisma.TransactionClient, matterId: string, data: z.output<typeof correctionInput>) {
  if (data.targetKind === "EXPENSE") {
    const [entry]=await db.$queryRaw<{id:string;type:string;matterId:string;amount:Prisma.Decimal;revision:number;occurredAt:Date}[]>`SELECT * FROM "FeeEntry" WHERE id=${data.targetId} FOR UPDATE`;
    if(!entry || entry.matterId!==matterId || entry.type!=="COST" || entry.revision!==data.revision)throw new Error("原支出不存在或已变化");
    const [prior]=await db.$queryRaw<{amount:Prisma.Decimal}[]>`SELECT COALESCE(SUM(delta),0) AS amount FROM "FinanceCorrectionEffect" WHERE "expenseEntryId"=${entry.id}`;
    if(!D(data.amount).eq(entry.amount.minus(prior.amount)) || prior.amount.gt(0))throw new Error("支出冲销须为原支出全部金额且只能一次");
    if(civilDay(data.occurredAt)<civilDay(entry.occurredAt))throw new Error("冲销日期不能早于原支出");
    return {snapshot:createHash("sha256").update(JSON.stringify(entry)).digest("hex"),effects:[{kind:"EXPENSE_REVERSAL",column:"expenseEntryId",id:entry.id,delta:D(data.amount)}] as Effect[],arReversed:new Map<string,Prisma.Decimal>(),arAdjusted:new Map<string,Prisma.Decimal>(),paymentReversed:new Map<string,Prisma.Decimal>(),touchedPayments:new Set<string>()};
  }
  // 同案件固定次序读取并锁定；所有新财务写入均先取得共同授权锁。
  const payments = await db.$queryRaw<LedgerPayment[]>`SELECT * FROM "Payment" WHERE "matterId"=${matterId} ORDER BY id FOR UPDATE`;
  const ars = await db.$queryRaw<LedgerReceivable[]>`SELECT * FROM "Receivable" WHERE "matterId"=${matterId} ORDER BY id FOR UPDATE`;
  const links = await db.$queryRaw<Link[]>`SELECT a.* FROM "Allocation" a JOIN "Payment" p ON p.id=a."paymentId" WHERE p."matterId"=${matterId} ORDER BY a.id FOR UPDATE OF a`;
  const invoices = await db.$queryRaw<InvoiceLink[]>`SELECT * FROM "InvoicePaymentAllocation" WHERE "matterId"=${matterId} ORDER BY id FOR UPDATE`;
  const commissions = await db.$queryRaw<Commission[]>`SELECT f.*, COALESCE((SELECT SUM(delta) FROM "FinanceCorrectionEffect" e WHERE e."commissionEntryId"=f.id),0) AS adjustment FROM "FeeEntry" f WHERE f."matterId"=${matterId} AND f.type='COMMISSION' ORDER BY f.id FOR UPDATE OF f`;
  const snapshot = createHash("sha256").update(JSON.stringify({ payments, ars, links, invoices, commissions })).digest("hex");
  const pmap = new Map(payments.map(p => [p.id, p])), amap = new Map(ars.map(a => [a.id, a]));
  const root = data.type === "DISCOUNT" ? amap.get(data.targetId) : pmap.get(data.targetId);
  if (!root || root.revision !== data.revision) throw new Error("目标账务已变化，请刷新后重新申请");
  const amount = D(data.amount), effects: Effect[] = [];
  const arReversed = new Map<string, Prisma.Decimal>(), paymentReversed = new Map<string, Prisma.Decimal>();
  const arAdjusted = new Map<string, Prisma.Decimal>();
  const add = (map: Map<string, Prisma.Decimal>, id: string, value: Prisma.Decimal) => map.set(id, (map.get(id) ?? D(0)).plus(value));
  if (sum(data.allocationReversals).gt(amount) || sum(data.invoiceReversals).gt(amount)) throw new Error("撤回关联合计不能超过本次更正金额");
  for (const item of data.allocationReversals) {
    const link = links.find(l => l.id === item.targetId), value = D(item.amount);
    if (!link || (data.type === "DISCOUNT" ? link.receivableId !== root.id : link.paymentId !== root.id)) throw new Error("核销关系不属于本次更正对象");
    if (value.gt(link.amount.minus(link.reversedAmount))) throw new Error("撤回金额超过有效核销");
    add(arReversed, link.receivableId, value); add(paymentReversed, link.paymentId, value);
    effects.push({ kind: "ALLOCATION_REVERSAL", column: "allocationId", id: link.id, delta: value });
  }
  for (const item of data.invoiceReversals) {
    const link = invoices.find(l => l.id === item.targetId), value = D(item.amount);
    if (!link || link.paymentId !== root.id) throw new Error("票款关系不属于本次更正实收");
    if (value.gt(link.amount.minus(link.reversedAmount))) throw new Error("撤回金额超过有效票款关联");
    effects.push({ kind: "INVOICE_ALLOCATION_REVERSAL", column: "invoiceAllocationId", id: link.id, delta: value });
  }
  if (data.type === "DISCOUNT") arAdjusted.set(root.id, amount.negated());
  else {
    const payment = pmap.get(root.id)!;
    if (civilDay(data.occurredAt) < civilDay(payment.occurredAt)) throw new Error("更正发生日期不能早于原收款");
    const net = payment.amount.minus(payment.refundedAmount);
    if (amount.gt(net)) throw new Error("更正金额超过原收款剩余净额");
    if (data.type === "REVERSAL" && !amount.eq(net)) throw new Error("误录冲销须冲销原收款全部剩余净额");
    if (payment.allocatedAmount.minus(paymentReversed.get(payment.id) ?? 0).gt(net.minus(amount))) throw new Error("请明确撤回足额核销，再处理退款或冲销");
    const invoiceTotal = sum(invoices.filter(l => l.paymentId === payment.id).map(l => ({ amount: l.amount.minus(l.reversedAmount) })));
    if (invoiceTotal.minus(sum(data.invoiceReversals)).gt(net.minus(amount))) throw new Error("请明确撤回足额票款关联，再处理退款或冲销");
    if (data.debtTreatment === "WAIVE_DEBT") {
      if (!sum(data.waivers).eq(amount)) throw new Error("免除应收合计必须等于退款金额");
      for (const item of data.waivers) {
        // 默认按原核销对应关系免除（2026-09-20 A 批）：被免的应收必须曾由本笔实收核销且
        // 有效核销额足以覆盖；「退 A 款免 B 债」须作为明确、独立的更正决定另行处理。
        const covered = sum(links.filter(l => l.receivableId === item.targetId && l.paymentId === root.id).map(l => ({ amount: l.amount.minus(l.reversedAmount) })));
        if (D(item.amount).gt(covered)) throw new Error("免除应收须对应本笔实收的原核销关系；跨应收减免请作为独立更正决定另行处理");
        arAdjusted.set(item.targetId, D(item.amount).negated());
      }
    }
    effects.push({ kind: "PAYMENT_REFUND", column: "paymentId", id: payment.id, delta: amount });
    for (const commission of commissions.filter(c => c.parentFeeEntryId === payment.feeEntryId)) {
      if (!commission.commissionBaseSnapshot?.eq(payment.amount)) throw new Error("原分成基数与收款不一致");
      const delta = commissionReversal(commission.amount, commission.commissionBaseSnapshot, payment.refundedAmount.plus(amount), commission.adjustment.negated());
      if (delta.lt(0)) throw new Error("原分成调整明细不一致");
      if (delta.gt(0)) effects.push({ kind: "COMMISSION_ADJUSTMENT", column: "commissionEntryId", id: commission.id, delta: delta.negated() });
    }
  }
  const touchedPayments = new Set([...paymentReversed.keys(), ...(data.type !== "DISCOUNT" ? [root.id] : [])]);
  for (const id of touchedPayments) {
    const p = pmap.get(id); if (!p || p.moneyKind !== root.moneyKind) throw new Error("关联收款不存在或款项性质不同");
    await assertPaymentSource(db, p); await assertAllocationTotals(db, p);
  }
  for (const id of new Set([...arReversed.keys(), ...arAdjusted.keys()])) {
    const ar = amap.get(id);
    if (!ar || ar.moneyKind !== root.moneyKind || ar.status === "CANCELLED") throw new Error("应收须为本案有效且同类款项");
    const linked = sum(links.filter(l => l.receivableId === id).map(l => ({ amount: l.amount.minus(l.reversedAmount) })));
    if (!linked.eq(ar.settledAmount)) throw new Error("应收核销明细与余额不符");
    const effective = ar.amount.plus(ar.adjustmentAmount).plus(arAdjusted.get(id) ?? 0), settled = ar.settledAmount.minus(arReversed.get(id) ?? 0);
    if (effective.lt(0) || settled.lt(0) || settled.gt(effective)) throw new Error("减免超过有效应收，或尚需解除已核销金额");
  }
  for (const [id, delta] of arAdjusted) effects.push({ kind: "RECEIVABLE_ADJUSTMENT", column: "receivableId", id, delta });
  return { snapshot, effects, arReversed, arAdjusted, paymentReversed, touchedPayments };
}

export async function submitCorrectionTx(db: Prisma.TransactionClient, userId: string, input: CorrectionInput) {
  const data = correctionInput.parse(input); await requireFinanceLedger(db);
  const target = data.targetKind === "EXPENSE" ? await db.feeEntry.findUnique({where:{id:data.targetId},select:{matterId:true}}) : data.type === "DISCOUNT" ? await db.receivable.findUnique({ where: { id: data.targetId }, select: { matterId: true } }) : await db.payment.findUnique({ where: { id: data.targetId }, select: { matterId: true } });
  if (!target) throw new Error("原账务对象不存在");
  await assertLedgerWrite(db, userId, target.matterId, "finance.write");
  const plan = await correctionPlan(db, target.matterId, data), id = randomUUID();
  const ar = data.type === "DISCOUNT", expense = data.targetKind === "EXPENSE";
  await db.$executeRaw`INSERT INTO "FinanceCorrection" (id,"matterId","targetType","targetId",type,amount,reason,"relatedDocNo","createdById","paymentId","receivableId","feeEntryId","requestPayload","occurredAt") VALUES
    (${id},${target.matterId},${expense ? "FeeEntry" : ar ? "Receivable" : "Payment"},${data.targetId},${data.type}::"FinanceCorrectionType",${D(data.amount)},${data.reason},${data.voucherReference},${userId},${ar || expense ? null : data.targetId},${ar ? data.targetId : null},${expense ? data.targetId : null},${JSON.stringify({ input: data, snapshot: plan.snapshot })}::jsonb,${data.occurredAt})`;
  await auditTx(db, { userId, action: "FINANCE_CORRECTION_SUBMIT", targetType: "FinanceCorrection", targetId: id, detail: { matterId: target.matterId, ...JSON.parse(JSON.stringify(data)) } });
  return { id, matterId: target.matterId };
}

export async function decideCorrectionTx(db: Prisma.TransactionClient, userId: string, input: z.input<typeof correctionDecision>) {
  const data = correctionDecision.parse(input); await requireFinanceLedger(db);
  const [target] = await db.$queryRaw<{ matterId: string }[]>`SELECT "matterId" FROM "FinanceCorrection" WHERE id=${data.id}`;
  if (!target) throw new Error("更正申请不存在");
  await assertLedgerWrite(db, userId, target.matterId, data.decision === "CANCELLED" ? "finance.write" : "finance.correct");
  const [row] = await db.$queryRaw<{ id: string; matterId: string; revision: number; status: string; createdById: string; requestPayload: { input: CorrectionInput; snapshot: string } }[]>`SELECT * FROM "FinanceCorrection" WHERE id=${data.id} FOR UPDATE`;
  if (row.status !== "PENDING" || row.revision !== data.revision) throw new Error("更正申请已处理或发生变化");
  if (data.decision === "CANCELLED" && row.createdById !== userId) throw new Error("只有申请人可以撤销更正");
  if (data.decision === "CONFIRMED") {
    const request = correctionInput.parse(row.requestPayload.input), plan = await correctionPlan(db, row.matterId, request);
    if (plan.snapshot !== row.requestPayload.snapshot) throw new Error("申请后账务已变化，请退回后重新申请");
    await applyCorrectionPlan(db,row.id,plan,request.type!=="DISCOUNT" && request.targetKind!=="EXPENSE" ? {id:request.targetId,amount:D(request.amount)} : undefined);
  }
  await db.$executeRaw`UPDATE "FinanceCorrection" SET status=${data.decision}::"FinanceCorrectionStatus",revision=revision+1,"resolutionNote"=${data.note},"confirmedById"=${data.decision === "CONFIRMED" ? userId : null},"confirmedAt"=${data.decision === "CONFIRMED" ? new Date() : null} WHERE id=${row.id}`;
  await auditTx(db, { userId, action: `FINANCE_CORRECTION_${data.decision}`, targetType: "FinanceCorrection", targetId: row.id, detail: { matterId: row.matterId, previousRevision: data.revision, note: data.note } });
  return { matterId: row.matterId };
}

export async function applyCorrectionPlan(db:Prisma.TransactionClient,correctionId:string,plan:Awaited<ReturnType<typeof correctionPlan>>,refundTarget?:{id:string;amount:Prisma.Decimal}) {
    for (const effect of plan.effects) {
      // column 来自服务内封闭枚举，不接受用户提供的 SQL 标识符。
      await db.$executeRaw(Prisma.sql`INSERT INTO "FinanceCorrectionEffect" (id,"correctionId","effectKind",delta,${Prisma.raw(`"${effect.column}"`)}) VALUES (${randomUUID()},${correctionId},${effect.kind}::"FinanceEffectKind",${effect.delta},${effect.id})`);
      if (effect.kind === "ALLOCATION_REVERSAL") await db.$executeRaw`UPDATE "Allocation" SET "reversedAmount"="reversedAmount"+${effect.delta} WHERE id=${effect.id}`;
      if (effect.kind === "INVOICE_ALLOCATION_REVERSAL") await db.$executeRaw`UPDATE "InvoicePaymentAllocation" SET "reversedAmount"="reversedAmount"+${effect.delta},revision=revision+1,"updatedAt"=NOW() WHERE id=${effect.id}`;
      if (effect.kind === "COMMISSION_ADJUSTMENT" || effect.kind === "EXPENSE_REVERSAL") await db.$executeRaw`UPDATE "FeeEntry" SET revision=revision+1,"updatedAt"=NOW() WHERE id=${effect.id}`;
    }
    for (const id of new Set([...plan.arReversed.keys(), ...plan.arAdjusted.keys()])) {
      const reversal = plan.arReversed.get(id) ?? D(0), adjustment = plan.arAdjusted.get(id) ?? D(0);
      await db.$executeRaw`UPDATE "Receivable" SET "settledAmount"="settledAmount"-${reversal},"adjustmentAmount"="adjustmentAmount"+${adjustment},status=CASE WHEN "settledAmount"-${reversal}=amount+"adjustmentAmount"+${adjustment} THEN 'SETTLED'::"ReceivableStatus" ELSE 'OPEN'::"ReceivableStatus" END,revision=revision+1,"updatedAt"=NOW() WHERE id=${id}`;
    }
    for (const id of plan.touchedPayments) {
      const reversal = plan.paymentReversed.get(id) ?? D(0), refund = refundTarget?.id === id ? refundTarget.amount : D(0);
      await db.$executeRaw`UPDATE "Payment" SET "allocatedAmount"="allocatedAmount"-${reversal},"refundedAmount"="refundedAmount"+${refund},status=CASE WHEN "allocatedAmount"-${reversal}=0 THEN 'UNALLOCATED'::"PaymentStatus" WHEN "allocatedAmount"-${reversal}=amount-"refundedAmount"-${refund} THEN 'FULLY_ALLOCATED'::"PaymentStatus" ELSE 'PARTIAL'::"PaymentStatus" END,revision=revision+1,"updatedAt"=NOW() WHERE id=${id}`;
    }
}

export async function commissionPositions(db: Prisma.TransactionClient, matterIds: string[]) {
  if (!matterIds.length) return [];
  const rows = await db.$queryRaw<{ id: string; matterId: string; beneficiaryUserId: string | null; name: string | null; revision: number; amount: Prisma.Decimal; adjustment: Prisma.Decimal; paid: Prisma.Decimal; recovered: Prisma.Decimal; occurredAt: Date }[]>(Prisma.sql`
    SELECT f.id,f."matterId",f."beneficiaryUserId",u.name,f.revision,f.amount,f."occurredAt",
      COALESCE((SELECT SUM(delta) FROM "FinanceCorrectionEffect" e WHERE e."commissionEntryId"=f.id),0) AS adjustment,
      COALESCE((SELECT SUM(amount) FROM "CommissionSettlement" s WHERE s."commissionEntryId"=f.id AND s.kind='PAID' AND s."voidedAt" IS NULL),0) AS paid,
      COALESCE((SELECT SUM(amount) FROM "CommissionSettlement" s WHERE s."commissionEntryId"=f.id AND s.kind='RECOVERED' AND s."voidedAt" IS NULL),0) AS recovered
    FROM "FeeEntry" f LEFT JOIN "User" u ON u.id=f."beneficiaryUserId" WHERE f.type='COMMISSION' AND f."matterId" IN (${Prisma.join(matterIds)}) ORDER BY f."occurredAt",f.id`);
  return rows.map(r => ({ ...r, ...commissionPosition(r.amount, r.adjustment, r.paid, r.recovered) }));
}
export async function settleCommissionTx(db: Prisma.TransactionClient, userId: string, input: SettlementInput) {
  const data = settlementInput.parse(input); await requireFinanceLedger(db);
  const target = await db.feeEntry.findUnique({ where: { id: data.commissionEntryId }, select: { matterId: true } });
  if (!target) throw new Error("分成计提不存在");
  await assertLedgerWrite(db, userId, target.matterId, "finance.settle");
  await db.$queryRaw`SELECT id FROM "FeeEntry" WHERE id=${data.commissionEntryId} FOR UPDATE`;
  const position = (await commissionPositions(db, [target.matterId])).find(p => p.id === data.commissionEntryId);
  if (!position || position.revision !== data.revision) throw new Error("分成账务已变化，请刷新");
  if (civilDay(data.occurredAt) < civilDay(position.occurredAt)) throw new Error("支付日期不能早于分成计提");
  const amount = D(data.amount);
  // 扣回上限取 recoverable（= max(0, netPaid − accrued)）：退款已把有效计提压到已支付净额之下时，
  // 超额扣回会让 payable 重新大于 0，形成「多扣的钱又变成待支付」的错账回路（2026-09-20 A 批 P2-1）。
  if (amount.gt(data.kind === "PAID" ? position.payable : position.recoverable)) throw new Error(data.kind === "PAID" ? "支付超过当前待支付金额" : "扣回超过当前待扣回金额");
  if (data.kind === "RECOVERED") {
    const [latest] = await db.$queryRaw<{ date: Date | null }[]>`SELECT MAX("occurredAt") AS date FROM "CommissionSettlement" WHERE "commissionEntryId"=${position.id} AND "voidedAt" IS NULL`;
    if (latest.date && civilDay(data.occurredAt) < civilDay(latest.date)) throw new Error("扣回日期不能早于已有支付或扣回");
  }
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO "CommissionSettlement" (id,"commissionEntryId",kind,amount,"occurredAt","recordedById","voucherReference",note) VALUES (${id},${position.id},${data.kind}::"CommissionSettlementKind",${amount},${data.occurredAt},${userId},${data.voucherReference},${data.note})`;
  await db.$executeRaw`UPDATE "FeeEntry" SET revision=revision+1,"updatedAt"=NOW() WHERE id=${position.id}`;
  await auditTx(db, { userId, action: `COMMISSION_${data.kind}`, targetType: "CommissionSettlement", targetId: id, detail: { matterId: position.matterId, commissionEntryId: position.id, previousRevision: data.revision, amount: data.amount, voucherReference: data.voucherReference } });
  return { id, matterId: position.matterId };
}
