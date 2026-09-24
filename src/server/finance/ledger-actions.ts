"use server";
import {adjustInvoiceTx,invoiceAdjustmentInput,invoiceAdjustmentReady} from "@/server/invoices/adjustments";
import { scopeFor } from "@/lib/roles/catalog";
import { z } from "zod";
import { actionErrorMessage } from "@/lib/action-error";
import { bindContractScopeTx,draftAmendmentTx,activateAmendmentTx,cancelAmendmentTx } from "./ledger-contracts";
import type { ContractTermsInput } from "@/lib/finance/contracts";
import { commissionPositions, submitCorrectionTx, decideCorrectionTx, settleCommissionTx } from "./ledger-corrections";
import { type CorrectionInput, type SettlementInput, correctionDecision } from "@/lib/finance/corrections";
import type { MoneyKind } from "@/lib/finance/ledger-labels";
import { registerExpenseTx, registerBillingTx, signBillingTx, registerReceiptTx, confirmReceiptTx, rejectReceiptTx, confirmDueConditionTx } from "./ledger-registration";
import { billingSignInput, conditionInput, type BillingRegistration, type ReceiptRegistration } from "@/lib/finance/registration";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { matterAssociationFilter, matterFinanceVisibilityFilter } from "@/lib/permissions";
import { readLedger } from "./ledger-storage";
import { allocateLedgerTx } from "./ledger-mutations";
import { closureReady } from "@/server/archive/closure";
import { dueBucket, paymentBalance, receivableBalance, type AllocateLedgerInput } from "@/lib/finance/ledger";
import { ActionError } from "@/lib/action-error";

export async function getFinanceLedger(matterId?: string) {
  const session = await requireSession("finance.read");
  return prisma.$transaction(async db => {
    const matters = await db.matter.findMany({ where: { AND: [{ deletedAt: null }, matterFinanceVisibilityFilter(session.user.id,session.user.role,session.user.rolePermissions), ...(matterId ? [{ id: matterId }] : [])] }, select: { id: true, internalCode: true, title: true, status: true }, orderBy: { internalCode: "asc" } });
    if (matterId && matters.length === 0) throw new ActionError("案件不存在或无权查看财务");
    const data = await readLedger(db, matters.map(m => m.id));
    const ids=matters.map(m=>m.id);
    const pending = data.ready && ids.length ? await db.$queryRaw<{id:string;matterId:string;amount:Prisma.Decimal;moneyKind:MoneyKind;occurredAt:Date;recordedById:string;name:string;payerOrPayee:string|null;note:string|null}[]>(Prisma.sql`
      SELECT f.id,f."matterId",f.amount,f."moneyKind"::text,f."occurredAt",f."recordedById",f."payerOrPayee",f.note,u.name FROM "FeeEntry" f JOIN "User" u ON u.id=f."recordedById" WHERE f.type='RECEIVED' AND f."confirmState"='PENDING' AND f."matterId" IN (${Prisma.join(ids)}) ORDER BY f."createdAt"`) : [];
    const billings = data.ready && ids.length ? await db.$queryRaw<{id:string;matterId:string;title:string;contractAmount:Prisma.Decimal;moneyKind:MoneyKind;status:string;signedAt:Date|null;revision:number;sourceBillingId:string|null;amendmentType:string|null;resultingAmount:Prisma.Decimal|null;previousAmount:Prisma.Decimal|null;effectiveAt:Date|null;endsAt:Date|null;draftTerms:ContractTermsInput|null;completedWork:string|null;handoverWork:string|null;terminationReason:string|null}[]>(Prisma.sql`
      SELECT id,"matterId",title,"contractAmount","moneyKind"::text,status::text,"signedAt",revision,"sourceBillingId","amendmentType"::text,"resultingAmount","previousAmount","effectiveAt","endsAt","draftTerms","completedWork","handoverWork","terminationReason" FROM "Billing" WHERE "matterId" IN (${Prisma.join(ids)}) ORDER BY "createdAt"`) : [];
    const corrections = data.ready && ids.length ? await db.$queryRaw<{ id:string;matterId:string;targetId:string;type:string;status:string;amount:Prisma.Decimal;reason:string;relatedDocNo:string;occurredAt:Date;createdById:string;revision:number;resolutionNote:string|null;requestPayload:{input:CorrectionInput;kind?:string};sourceBillingId:string|null;name:string }[]>(Prisma.sql`SELECT c.*,u.name FROM "FinanceCorrection" c JOIN "User" u ON u.id=c."createdById" WHERE c."matterId" IN (${Prisma.join(ids)}) ORDER BY c."createdAt" DESC`) : [];
    const allocations = data.ready && ids.length ? await db.$queryRaw<{id:string;paymentId:string;receivableId:string;amount:Prisma.Decimal}[]>(Prisma.sql`SELECT a.id,a."paymentId",a."receivableId",a.amount-a."reversedAmount" AS amount FROM "Allocation" a JOIN "Payment" p ON p.id=a."paymentId" WHERE p."matterId" IN (${Prisma.join(ids)}) ORDER BY a.id`) : [];
    const invoiceLinks = data.ready && ids.length ? await db.$queryRaw<{id:string;paymentId:string;invoiceId:string;amount:Prisma.Decimal}[]>(Prisma.sql`SELECT id,"paymentId","invoiceId",amount-"reversedAmount" AS amount FROM "InvoicePaymentAllocation" WHERE "matterId" IN (${Prisma.join(ids)}) ORDER BY id`) : [];
    const commissions = data.ready ? await commissionPositions(db,ids) : [];
    const settlements = data.ready && ids.length ? await db.$queryRaw<{id:string;commissionEntryId:string;kind:string;amount:Prisma.Decimal;occurredAt:Date;voucherReference:string;name:string}[]>(Prisma.sql`SELECT s.id,s."commissionEntryId",s.kind::text,s.amount,s."occurredAt",s."voucherReference",u.name FROM "CommissionSettlement" s JOIN "FeeEntry" f ON f.id=s."commissionEntryId" JOIN "User" u ON u.id=s."recordedById" WHERE f."matterId" IN (${Prisma.join(ids)}) AND s."voidedAt" IS NULL ORDER BY s."createdAt" DESC`) : [];
    const documents = data.ready && (session.user.role!=="CUSTOM"||scopeFor(session.user,"documents.read")) ? await db.document.findMany({where:{matterId:{in:ids},deletedAt:null,matter: matterAssociationFilter(session.user.id)},select:{id:true,matterId:true,name:true},orderBy:{name:"asc"}}) : [];
    const contractDocuments=data.ready&&ids.length?await db.$queryRaw<{billingId:string;id:string;name:string}[]>(Prisma.sql`SELECT a."billingId",d.id,d.name FROM "BillingAttachment" a JOIN "Document" d ON d.id=a."documentId" JOIN "Billing" b ON b.id=a."billingId" WHERE b."matterId" IN (${Prisma.join(ids)}) AND d."deletedAt" IS NULL`):[];
    const procedures = data.ready ? await db.matterProcedure.findMany({where:{matterId:{in:ids}},select:{id:true,matterId:true,customLabel:true,type:true,engagement:true}}) : [];    const scopes = data.ready && ids.length ? await db.$queryRaw<{billingId:string;procedureId:string;state:"COVERED"|"SUPPLEMENT_REQUIRED"|"PENDING_REVIEW";note:string|null}[]>(Prisma.sql`SELECT s.* FROM "BillingProcedureScope" s JOIN "Billing" b ON b.id=s."billingId" WHERE b."matterId" IN (${Prisma.join(ids)})`) : [];
    const expenses = data.ready && ids.length ? await db.$queryRaw<{id:string;matterId:string;amount:Prisma.Decimal;reversed:Prisma.Decimal;revision:number;moneyKind:MoneyKind;occurredAt:Date;note:string|null}[]>(Prisma.sql`SELECT f.id,f."matterId",f.amount,f.revision,f."moneyKind"::text,f."occurredAt",f.note,COALESCE((SELECT SUM(delta) FROM "FinanceCorrectionEffect" e WHERE e."expenseEntryId"=f.id),0) AS reversed FROM "FeeEntry" f WHERE f.type='COST' AND f."matterId" IN (${Prisma.join(ids)}) ORDER BY f."occurredAt" DESC`) : [];
    const invoiceAdjustments=data.ready&&ids.length&&await invoiceAdjustmentReady(db)?await db.$queryRaw<{id:string;invoiceId:string;kind:string;amount:Prisma.Decimal;reference:string;reason:string;documentId:string;occurredAt:Date}[]>(Prisma.sql`SELECT j.* FROM "InvoiceAdjustment" j JOIN "InvoiceRequest" i ON i.id=j."invoiceId" WHERE i."matterId" IN (${Prisma.join(ids)}) ORDER BY j."createdAt" DESC`):[];
    // 归档案件的收尾通道：服务端 assertLedgerWrite 已放行「finance.tail ALL + 本案指定
    // 收尾人」，此处按同口径算出 UI 可写标记——否则闭环指定了收尾人却在唯一界面被
    // status!=='ARCHIVED' 一刀切禁用，收尾流程走不通（2026-09-19 审计）。
    const tailMatterIds=new Set<string>();
    const archivedIds=matters.filter(m=>m.status==="ARCHIVED").map(m=>m.id);
    if(data.ready&&archivedIds.length&&await closureReady(db)&&scopeFor(session.user,"finance.tail")==="ALL"){
      const plans=await db.$queryRaw<{matterId:string;financeOwnerId:string|null}[]>(Prisma.sql`SELECT "matterId","financeOwnerId" FROM "ArchiveClosurePlan" WHERE "matterId" IN (${Prisma.join(archivedIds)})`);
      for(const p of plans)if(p.financeOwnerId===session.user.id)tailMatterIds.add(p.matterId);
    }
    const mattersWithTail=matters.map(m=>({...m,tailWritable:m.status==="ARCHIVED"&&tailMatterIds.has(m.id)}));
    return {contractDocuments,invoiceAdjustments:invoiceAdjustments.map(j=>({...j,amount:j.amount.toFixed(2)})),
      documents,procedures,scopes,expenses:expenses.map(e=>({...e,amount:e.amount.toFixed(2),reversed:e.reversed.toFixed(2)})),
      currentUserId:session.user.id,
      corrections:corrections.map(c=>({...c,amount:c.amount.toFixed(2)})),
      allocations:allocations.map(a=>({...a,amount:a.amount.toFixed(2)})),invoiceLinks:invoiceLinks.map(a=>({...a,amount:a.amount.toFixed(2)})),
      commissions:commissions.map(c=>({...c,amount:c.amount.toFixed(2),adjustment:c.adjustment.toFixed(2),accrued:c.accrued.toFixed(2),paid:c.paid.toFixed(2),recovered:c.recovered.toFixed(2),netPaid:c.netPaid.toFixed(2),payable:c.payable.toFixed(2),recoverable:c.recoverable.toFixed(2)})),
      settlements:settlements.map(s=>({...s,amount:s.amount.toFixed(2)})),
      ready: data.ready, matters: mattersWithTail, summary: data.summary, pending:pending.map(p=>({...p,amount:p.amount.toFixed(2)})), billings:billings.map(b=>({...b,contractAmount:b.contractAmount.toFixed(2),resultingAmount:b.resultingAmount?.toFixed(2)??null,previousAmount:b.previousAmount?.toFixed(2)??null})),
      receivables: data.receivables.map(r => ({ ...r, amount: r.amount.toFixed(2), settledAmount: r.settledAmount.toFixed(2), adjustmentAmount: r.adjustmentAmount.toFixed(2), outstanding: receivableBalance(r).toFixed(2), dueBucket: dueBucket(r) })),
      payments: data.payments.map(p => ({ ...p, amount: p.amount.toFixed(2), allocatedAmount: p.allocatedAmount.toFixed(2), refundedAmount: p.refundedAmount.toFixed(2), unallocated: paymentBalance(p).toFixed(2) })),
      invoices: data.invoices.map(i => ({ ...i, amount: i.amount.toFixed(2), linked: i.linked.toFixed(2), outstanding: i.amount.minus(i.linked).toFixed(2) })),
    };
  }, { isolationLevel: "RepeatableRead" });
}
async function mutate(work: (db: Prisma.TransactionClient, userId: string) => Promise<{ matterId: string }>, permission: "personal" | "finance.write" | "finance.confirm" | "finance.correct" | "finance.settle") {
  const session = await requireSession(permission);
  try {
    const result = await prisma.$transaction(db => work(db, session.user.id), { isolationLevel: "Serializable", timeout: 20000 });
    revalidatePath("/finance");
    revalidatePath("/finance/reconciliation");
    revalidatePath(`/matters/${result.matterId}`);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return {ok:false as const,message:["P2034","P2002","P2025"].includes(error.code) || (error.code==="P2010" && ["40001","40P01","23505"].includes(String(error.meta?.code))) ? "账务或授权已变化，请刷新后重试" : "账务保存失败，未完成本次操作"};
    if(error instanceof z.ZodError) return {ok:false as const,message:error.issues[0]?.message ?? "请检查填写内容"};
    return {ok:false as const,message:error instanceof Error ? actionErrorMessage(error) :"操作失败，请重试"};
  }
}
export async function allocateLedger(input: AllocateLedgerInput) {
  return mutate((db, userId) => allocateLedgerTx(db, userId, input), "finance.write");
}
export async function registerBilling(input:BillingRegistration) { return mutate((db,id)=>registerBillingTx(db,id,input),"finance.write"); }
export async function signBilling(input:z.input<typeof billingSignInput>) { return mutate((db,id)=>signBillingTx(db,id,input),"finance.write"); }
export async function registerReceipt(input:ReceiptRegistration) { return mutate((db,id)=>registerReceiptTx(db,id,input),"finance.write"); }
export async function confirmReceipt(id:string) { return mutate((db,userId)=>confirmReceiptTx(db,userId,id),"finance.confirm"); }
export async function rejectReceipt(id:string,reason:string) { return mutate((db,userId)=>rejectReceiptTx(db,userId,id,reason),"finance.confirm"); }
export async function confirmDueCondition(input:z.input<typeof conditionInput>) { return mutate((db,id)=>confirmDueConditionTx(db,id,input),"finance.write"); }

export async function registerExpense(input:ReceiptRegistration) { return mutate((db,id)=>registerExpenseTx(db,id,input),"finance.write"); }

export async function submitCorrection(input:CorrectionInput) { return mutate((db,id)=>submitCorrectionTx(db,id,input),"finance.write"); }
export async function decideCorrection(input:z.input<typeof correctionDecision>) { return mutate((db,id)=>decideCorrectionTx(db,id,input),input.decision==="CANCELLED"?"finance.write":"finance.correct"); }
export async function settleCommission(input:SettlementInput) { return mutate((db,id)=>settleCommissionTx(db,id,input),"finance.settle"); }

export async function draftAmendment(input:ContractTermsInput) { return mutate((db,id)=>draftAmendmentTx(db,id,input),"finance.write"); }
export async function activateAmendment(id:string,revision:number) { return mutate((db,userId)=>activateAmendmentTx(db,userId,id,revision),"personal"); }

export async function cancelAmendment(id:string,revision:number) { return mutate((db,userId)=>cancelAmendmentTx(db,userId,id,revision),"finance.write"); }

export async function bindContractScope(input:Parameters<typeof bindContractScopeTx>[2]) {return mutate((db,id)=>bindContractScopeTx(db,id,input),"finance.write");}

export async function adjustInvoice(input:z.input<typeof invoiceAdjustmentInput>){return mutate((db,id)=>adjustInvoiceTx(db,id,input),"finance.correct");}
