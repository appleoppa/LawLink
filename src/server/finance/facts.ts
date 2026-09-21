/** 统一财务事实读取。调用方传入已按当前人员财务权限限定的案件过滤器。 */
import { effectiveContractRows } from "@/lib/finance/contracts";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { commissionPositions } from "./ledger-corrections";
import { readLedger } from "./ledger-storage";
import { summarizeLedger,receivableBalance } from "@/lib/finance/ledger";
import type { MoneyKind } from "@/lib/finance/ledger-labels";
export async function readFinanceFacts(db:Prisma.TransactionClient,where:Prisma.MatterWhereInput) {
  const matters=await db.matter.findMany({where:{AND:[{deletedAt:null},where]},select:{id:true,internalCode:true,title:true,ownerId:true,owner:{select:{name:true}},primaryClientId:true,primaryClient:{select:{id:true,name:true}}}});
  const ledger=await readLedger(db,matters.map(m=>m.id));
  // 仅用于尚未切换运行模型的发布准备状态；不转换、回填或重算旧记录。
  if(!ledger.ready)return null;
  const byId=new Map(matters.map(m=>[m.id,m]));
  const ids=matters.map(m=>m.id);
  const dates=ids.length?await db.receivable.findMany({where:{matterId:{in:ids}},select:{id:true,createdAt:true}}):[];
  const created=new Map(dates.map(r=>[r.id,r.createdAt]));
  const sources=ids.length?await db.feeEntry.findMany({where:{matterId:{in:ids},type:"RECEIVED"},select:{id:true,payerOrPayee:true,method:true,note:true,invoiceNo:true}}):[];
  const bySource=new Map(sources.map(s=>[s.id,s]));
  const billingRows=ids.length?await db.$queryRaw<{id:string;matterId:string;moneyKind:MoneyKind;contractAmount:Prisma.Decimal;signedAt:Date|null;sourceBillingId:string|null;status:string;resultingAmount:Prisma.Decimal|null}[]>(Prisma.sql`SELECT id,"matterId","moneyKind"::text,"contractAmount","signedAt","sourceBillingId",status::text,"resultingAmount" FROM "Billing" WHERE "matterId" IN (${Prisma.join(ids)})`):[];
  const billings=effectiveContractRows(billingRows);
  const pending=ids.length?await db.$queryRaw<{amount:Prisma.Decimal;moneyKind:MoneyKind;occurredAt:Date}[]>(Prisma.sql`SELECT amount,"moneyKind"::text,"occurredAt" FROM "FeeEntry" WHERE type='RECEIVED' AND "confirmState"='PENDING' AND "matterId" IN (${Prisma.join(ids)})`):[];
  const receivables=ledger.receivables.filter(r=>r.status!=="CANCELLED").map(r=>({...r,createdAt:created.get(r.id)!,effectiveAmount:r.amount.plus(r.adjustmentAmount),outstanding:receivableBalance(r),matter:byId.get(r.matterId)!}));
  const payments=ledger.payments.map(p=>({...p,amount:p.amount.minus(p.refundedAmount),originalAmount:p.amount,matter:byId.get(p.matterId)!,...bySource.get(p.feeEntryId!),id:p.id}));
  const corrections=ids.length?await db.$queryRaw<{id:string;paymentId:string;type:string;amount:Prisma.Decimal;occurredAt:Date;reason:string;relatedDocNo:string;confirmedById:string}[]>(Prisma.sql`SELECT c.id,e."paymentId",c.type::text,e.delta AS amount,c."occurredAt",c.reason,c."relatedDocNo",c."confirmedById" FROM "FinanceCorrection" c JOIN "FinanceCorrectionEffect" e ON e."correctionId"=c.id WHERE c.status='CONFIRMED' AND e."effectKind"='PAYMENT_REFUND' AND c."matterId" IN (${Prisma.join(ids)}) ORDER BY c."occurredAt",c.id`):[];
  const refunds=corrections.map(c=>{const p=payments.find(p=>p.id===c.paymentId);if(!p)throw new Error("更正收款来源不存在");return {...p,id:c.id,paymentId:p.id,amount:c.amount,occurredAt:c.occurredAt,note:`${c.type==='REFUND'?'退款':'误录冲销'}：${c.reason}；凭据 ${c.relatedDocNo}`,correctionType:c.type,confirmedById:c.confirmedById};});
  const commissions=await commissionPositions(db,ids);
  const expenses=ids.length?await db.$queryRaw<{id:string;matterId:string;amount:Prisma.Decimal;reversed:Prisma.Decimal;occurredAt:Date}[]>(Prisma.sql`SELECT f.id,f."matterId",f.amount,f."occurredAt",COALESCE((SELECT SUM(delta) FROM "FinanceCorrectionEffect" e WHERE e."expenseEntryId"=f.id),0) AS reversed FROM "FeeEntry" f WHERE f.type='COST' AND f."matterId" IN (${Prisma.join(ids)})`):[];
  const lawyerAr=ledger.receivables.filter(r=>r.moneyKind==='LAWYER_FEE');
  const lawyerPayments=ledger.payments.filter(p=>p.moneyKind==='LAWYER_FEE');
  return {ready:true as const,matters,billings,receivables,payments,refunds,commissions,expenses,pending,invoices:ledger.invoices,summary:ledger.summary,lawyerSummary:summarizeLedger(lawyerAr,lawyerPayments)};
}
export function getFinanceFacts(where:Prisma.MatterWhereInput) {return prisma.$transaction(db=>readFinanceFacts(db,where),{isolationLevel:"RepeatableRead"});}
export type FinanceFacts=NonNullable<Awaited<ReturnType<typeof readFinanceFacts>>>;
export function periodReceipts(facts:Pick<FinanceFacts,"payments"|"refunds">,start:Date,end?:Date) {return [...facts.payments.map(p=>({...p,amount:p.originalAmount})),...facts.refunds.map(p=>({...p,amount:p.amount.negated()}))].filter(p=>p.moneyKind==='LAWYER_FEE'&&p.occurredAt>=start&&(!end||p.occurredAt<end)).sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime());}
/** 期间实收汇总（KPI 口径集中处）：净实收＝正向收款−退款冲正；「已确认 N 笔」只数正向收款，
 *  退款不计数——净额为负时界面须另行注明退款构成，否则「¥-10,000 · 已确认 1 笔」不可解（2026-09-21）。 */
export function periodReceiptSummary(rows:{amount:Prisma.Decimal}[]) {return {netReceived:sumAmounts(rows),confirmedCount:rows.filter(p=>p.amount.gt(0)).length,refundTotal:sumAmounts(rows.filter(p=>p.amount.lt(0)).map(p=>({amount:p.amount.negated()})))};}
export const sumAmounts=(rows:{amount:Prisma.Decimal}[])=>rows.reduce((s,r)=>s.plus(r.amount),new Prisma.Decimal(0)).toNumber();
export function shMonthStart(now=new Date(),offset=0) {const d=new Date(now.getTime()+8*3600000);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1)-8*3600000);}
export function shYearStart(now=new Date()) {const d=new Date(now.getTime()+8*3600000);return new Date(Date.UTC(d.getUTCFullYear(),0,1)-8*3600000);}
export function financeTrend(facts:FinanceFacts,months:number,now=new Date()) {
  return Array.from({length:months},(_,i)=>{const start=shMonthStart(now,i-months+1),end=shMonthStart(now,i-months+2);return {month:`${new Date(start.getTime()+8*3600000).getUTCMonth()+1}月`,received:sumAmounts(periodReceipts(facts,start,end)),receivable:sumAmounts(facts.receivables.filter(r=>r.moneyKind==='LAWYER_FEE'&&r.createdAt>=start&&r.createdAt<end).map(r=>({amount:r.effectiveAmount})))};});
}
