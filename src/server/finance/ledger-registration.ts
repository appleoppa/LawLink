/** 财务登记与确认的事务内服务；调用者必须使用 Serializable 事务。 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { billingRegistrationInput, receiptRegistrationInput, billingSignInput, conditionInput, type BillingRegistration, type ReceiptRegistration } from "@/lib/finance/registration";
import type { MoneyKind } from "@/lib/finance/ledger-labels";
import { requireFinanceLedger } from "./ledger-storage";
import { assertLedgerWrite } from "./ledger-access";
import { auditTx } from "@/server/audit";
import { assertMatterReviewCurrent } from "@/server/conflicts/matter-review";
import { recordTimelineEvent } from "@/server/timeline/record";
import { allocateCommissions } from "./commissions";
import { ActionError } from "@/lib/action-error";

export async function createInstallments(db:Prisma.TransactionClient,billing:{id:string;matterId:string;moneyKind:MoneyKind},items:z.output<typeof billingSignInput>["installments"]) {
  for (const [index,item] of items.entries()) {
    await db.$executeRaw`INSERT INTO "Receivable" (id,"matterId","billingId",title,amount,"moneyKind","sourceKey","installmentNumber","dueState","dueDate","dueCondition","updatedAt")
      VALUES (${randomUUID()},${billing.matterId},${billing.id},${item.title},${new Prisma.Decimal(item.amount)},${billing.moneyKind}::"MoneyKind",${`billing:${billing.id}:${index+1}`},${index+1},${item.dueState}::"ReceivableDueState",${item.dueState==='DATE_SET'?item.dueDate!:null},${item.dueState==='CONDITIONAL'?item.dueCondition!:null},NOW())`;
  }
}
export async function registerBillingTx(db:Prisma.TransactionClient,userId:string,input:BillingRegistration) {
  const data=billingRegistrationInput.parse(input);
  await requireFinanceLedger(db);
  await assertLedgerWrite(db,userId,data.matterId,"finance.write",{allowTail:false});
  const id=randomUUID();
  await db.$executeRaw`INSERT INTO "Billing" (id,"matterId",title,"contractAmount",status,"signedAt","moneyKind","amendmentType","updatedAt") VALUES
    (${id},${data.matterId},${data.title},${new Prisma.Decimal(data.amount)},${data.signedAt?'ACTIVE':'DRAFT'}::"BillingStatus",${data.signedAt??null},${data.moneyKind}::"MoneyKind",'ORIGINAL',NOW())`;
  await createInstallments(db,{id,matterId:data.matterId,moneyKind:data.moneyKind},data.installments);
  await auditTx(db,{userId,action:"BILLING_CREATE",targetType:"Billing",targetId:id,detail:{matterId:data.matterId,amount:String(data.amount),moneyKind:data.moneyKind,signedAt:data.signedAt?.toISOString(),installments:data.installments.length}});
  return {id,matterId:data.matterId};
}
export async function signBillingTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof billingSignInput>) {
  const data=billingSignInput.parse(input);
  await requireFinanceLedger(db);
  const target=await db.billing.findUnique({where:{id:data.id},select:{matterId:true}});
  if(!target)throw new ActionError("收费安排不存在");
  await assertLedgerWrite(db,userId,target.matterId,"finance.write",{allowTail:false});
  const [billing]=await db.$queryRaw<{id:string;matterId:string;moneyKind:MoneyKind;contractAmount:Prisma.Decimal;status:string;signedAt:Date|null;revision:number;sourceBillingId:string|null}[]>`SELECT * FROM "Billing" WHERE id=${data.id} FOR UPDATE`;
 if(billing.sourceBillingId)throw new ActionError("补充协议须从合同变更入口确认生效");
 if(billing.revision!==data.revision || billing.status!=="DRAFT" || billing.signedAt)throw new ActionError("收费安排已签署或发生变化，请刷新");
 billingRegistrationInput.parse({matterId:billing.matterId,title:"签署",moneyKind:billing.moneyKind,amount:billing.contractAmount.toFixed(2),signedAt:data.signedAt,installments:data.installments});
 // 原合同签署＝委托范围正式承接（P2-7）：签署前须通过当前主体与范围的动态冲突复核。
 // 转案带入的草稿在转化时已建立继承复核记录，主体与范围未变化时指纹一致、正常放行。
 await assertMatterReviewCurrent(db,billing.matterId);
  await db.$executeRaw`UPDATE "Billing" SET status='ACTIVE',"signedAt"=${data.signedAt},revision=revision+1,"updatedAt"=NOW() WHERE id=${billing.id}`;
  await createInstallments(db,billing,data.installments);
  await auditTx(db,{userId,action:"BILLING_SIGN",targetType:"Billing",targetId:billing.id,detail:{matterId:billing.matterId,previousRevision:data.revision,installments:data.installments.length}});
  return {id:billing.id,matterId:billing.matterId};
}
export async function registerReceiptTx(db:Prisma.TransactionClient,userId:string,input:ReceiptRegistration) {
  const data=receiptRegistrationInput.parse(input);
  await requireFinanceLedger(db);
  await assertLedgerWrite(db,userId,data.matterId,"finance.write");
  if(data.billingId) {
    const [billing]=await db.$queryRaw<{matterId:string;moneyKind:string}[]>`SELECT "matterId","moneyKind"::text FROM "Billing" WHERE id=${data.billingId} FOR SHARE`;
    if(!billing || billing.matterId!==data.matterId || billing.moneyKind!==data.moneyKind)throw new ActionError("来源合同须属于本案且款项性质相同");
  }
  const id=randomUUID();
  await db.$executeRaw`INSERT INTO "FeeEntry" (id,"matterId","billingId",type,amount,"moneyKind","occurredAt","payerOrPayee",note,"recordedById","confirmState","updatedAt") VALUES
    (${id},${data.matterId},${data.billingId??null},'RECEIVED',${new Prisma.Decimal(data.amount)},${data.moneyKind}::"MoneyKind",${data.occurredAt},${data.payerOrPayee??null},${data.note??null},${userId},'PENDING',NOW())`;
  await auditTx(db,{userId,action:"FEE_ENTRY_SUBMIT",targetType:"FeeEntry",targetId:id,detail:{matterId:data.matterId,amount:String(data.amount),moneyKind:data.moneyKind,pendingConfirm:true}});
  const receivers=await db.user.findMany({where:{active:true,OR:[{role:"FINANCE"},{role:"CUSTOM",roleDefinition:{active:true,permissions:{some:{permissionKey:"finance.confirm",scope:"ALL"}}}}]},select:{id:true}});
  if(receivers.length)await db.notification.createMany({data:receivers.map(r=>({userId:r.id,type:"SYSTEM" as const,title:"有实收待确认",content:`新登记实收 ¥${data.amount}，请核对到账后确认`,href:`/finance/reconciliation?matterId=${data.matterId}`,refType:"FeeEntry",refId:id}))});
  return {id,matterId:data.matterId};
}
async function receiptForUpdate(db:Prisma.TransactionClient,userId:string,id:string) {
  await requireFinanceLedger(db);
  const target=await db.feeEntry.findUnique({where:{id},select:{matterId:true}});
  if(!target)throw new ActionError("记录不存在");
  await assertLedgerWrite(db,userId,target.matterId,"finance.confirm");
  const [entry]=await db.$queryRaw<{id:string;matterId:string;billingId:string|null;type:string;confirmState:string;amount:Prisma.Decimal;moneyKind:MoneyKind;occurredAt:Date;recordedById:string}[]>`SELECT * FROM "FeeEntry" WHERE id=${id} FOR UPDATE`;
  if(entry.type!=="RECEIVED" || entry.confirmState!=="PENDING")throw new ActionError("此笔已被处理，只有待确认实收可以处理");
  return entry;
}
export async function confirmReceiptTx(db:Prisma.TransactionClient,userId:string,id:string) {
  const entry=await receiptForUpdate(db,userId,id);
  const changed=await db.feeEntry.updateMany({where:{id,confirmState:"PENDING"},data:{confirmState:"CONFIRMED",confirmedById:userId,confirmedAt:new Date()}});
  if(changed.count!==1)throw new ActionError("此笔已被处理，请刷新");
  await db.$executeRaw`INSERT INTO "Payment" (id,"matterId","feeEntryId",amount,"moneyKind","occurredAt","recordedById","updatedAt") VALUES
    (${randomUUID()},${entry.matterId},${id},${entry.amount},${entry.moneyKind}::"MoneyKind",${entry.occurredAt},${userId},NOW())`;
  if(entry.moneyKind==='LAWYER_FEE') {
    const plans=await db.commissionPlan.findMany({where:{matterId:entry.matterId,active:true},orderBy:{id:"asc"}});
    const shares=allocateCommissions(entry.amount.toNumber(),plans);
    for(const [index,plan] of plans.entries()) {
      if(shares[index].lte(0))continue;
      // COMMISSION 是确认时派生的台账行（非实收），显式落 CONFIRMED——
      // 数据库默认值即将改为 PENDING（防漏写绕过实收两步制），派生行不得依赖默认
      await db.$executeRaw`INSERT INTO "FeeEntry" (id,"matterId","billingId",type,amount,"moneyKind","occurredAt","parentFeeEntryId","beneficiaryUserId","recordedById","commissionRateSnapshot","commissionBaseSnapshot","confirmState","updatedAt") VALUES
        (${randomUUID()},${entry.matterId},${entry.billingId},'COMMISSION',${shares[index]},'LAWYER_FEE',${entry.occurredAt},${id},${plan.userId},${userId},${plan.percent},${entry.amount},'CONFIRMED',NOW())`;
    }
  }
  await recordTimelineEvent(db,{matterId:entry.matterId,eventType:"FEE_RECEIVED",title:`实收 ¥${entry.amount.toFixed(2)}`,occurredAt:entry.occurredAt,refType:"FeeEntry",refId:id});
  await auditTx(db,{userId,action:"FEE_ENTRY_CONFIRM",targetType:"FeeEntry",targetId:id,detail:{matterId:entry.matterId,amount:entry.amount.toFixed(2),moneyKind:entry.moneyKind}});
  return {id,matterId:entry.matterId};
}
export async function rejectReceiptTx(db:Prisma.TransactionClient,userId:string,id:string,reason:string) {
  const note=z.string().trim().min(1,"请填写退回原因").max(1000).parse(reason);
  const entry=await receiptForUpdate(db,userId,id);
  const removed=await db.feeEntry.deleteMany({where:{id,confirmState:"PENDING"}});
  if(removed.count!==1)throw new ActionError("此笔已被处理，请刷新");
  await auditTx(db,{userId,action:"FEE_ENTRY_REJECT",targetType:"FeeEntry",targetId:id,detail:{matterId:entry.matterId,amount:entry.amount.toFixed(2),reason:note}});
  // 站内通知与退回同事务，既不遗漏也不发送外部消息。
  await db.notification.create({data:{userId:entry.recordedById,type:"SYSTEM",title:"实收登记被退回",content:`实收 ¥${entry.amount.toFixed(2)} 被退回：${note}`,href:`/finance/reconciliation?matterId=${entry.matterId}`,refType:"FeeEntry",refId:id}});
  return {id,matterId:entry.matterId};
}
export async function confirmDueConditionTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof conditionInput>) {
  const data=conditionInput.parse(input);
  if(data.satisfiedAt>new Date())throw new ActionError("条件成就日期不能在未来");
  await requireFinanceLedger(db);
  const target=await db.receivable.findUnique({where:{id:data.id},select:{matterId:true}});
  if(!target)throw new ActionError("应收不存在");
  await assertLedgerWrite(db,userId,target.matterId,"finance.write");
  const count=await db.$executeRaw`UPDATE "Receivable" SET "conditionSatisfiedAt"=${data.satisfiedAt},"conditionConfirmedById"=${userId},revision=revision+1,"updatedAt"=NOW()
    WHERE id=${data.id} AND revision=${data.revision} AND "dueState"='CONDITIONAL' AND "conditionSatisfiedAt" IS NULL AND status<>'CANCELLED'`;
  if(count!==1)throw new ActionError("条件已确认或应收已变化，请刷新");
  await auditTx(db,{userId,action:"RECEIVABLE_CONDITION_CONFIRM",targetType:"Receivable",targetId:data.id,detail:{matterId:target.matterId,satisfiedAt:data.satisfiedAt.toISOString(),note:data.note,previousRevision:data.revision}});
  return {id:data.id,matterId:target.matterId};
}

export async function registerExpenseTx(db:Prisma.TransactionClient,userId:string,input:ReceiptRegistration) {
  const data=receiptRegistrationInput.parse(input);
  await requireFinanceLedger(db);await assertLedgerWrite(db,userId,data.matterId,"finance.write");
  if(data.billingId)throw new ActionError("支出请按案件登记，不关联收费合同");
  const id=randomUUID();
  await db.$executeRaw`INSERT INTO "FeeEntry" (id,"matterId",type,amount,"moneyKind","occurredAt","payerOrPayee",note,"recordedById","confirmState","updatedAt") VALUES (${id},${data.matterId},'COST',${new Prisma.Decimal(data.amount)},${data.moneyKind}::"MoneyKind",${data.occurredAt},${data.payerOrPayee??null},${data.note??null},${userId},'CONFIRMED',NOW())`;
  await auditTx(db,{userId,action:"FEE_ENTRY_CREATE",targetType:"FeeEntry",targetId:id,detail:{matterId:data.matterId,type:"COST",amount:String(data.amount),moneyKind:data.moneyKind}});
  return {id,matterId:data.matterId};
}

/** 仅由已完成收案转化授权的事务调用；不把审批权限扩大为通用财务写入权限。 */
export async function createIntakeBillingDraftTx(db:Prisma.TransactionClient,userId:string,input:{matterId:string;title:string;amount:Prisma.Decimal;schedule:string|null}) {
  await requireFinanceLedger(db);
  const data=billingRegistrationInput.parse({...input,amount:input.amount.toFixed(2),moneyKind:"LAWYER_FEE",installments:[]});
  const id=randomUUID();
  await db.$executeRaw`INSERT INTO "Billing" (id,"matterId",title,"contractAmount",schedule,status,"moneyKind","amendmentType","updatedAt") VALUES
    (${id},${data.matterId},${data.title},${input.amount},${input.schedule},'DRAFT','LAWYER_FEE','ORIGINAL',NOW())`;
  await auditTx(db,{userId,action:"BILLING_CREATE_FROM_INTAKE",targetType:"Billing",targetId:id,detail:{matterId:data.matterId,status:"DRAFT",moneyKind:"LAWYER_FEE"}});
  return {id,matterId:data.matterId};
}

export async function deleteBillingDraftTx(db:Prisma.TransactionClient,userId:string,id:string) {
  await requireFinanceLedger(db);
  const target=await db.billing.findUnique({where:{id},select:{matterId:true}});
  if(!target)throw new ActionError("收费安排不存在");
  await assertLedgerWrite(db,userId,target.matterId,"finance.write",{allowTail:false});
  const [billing]=await db.$queryRaw<{status:string;signedAt:Date|null}[]>`SELECT status,"signedAt" FROM "Billing" WHERE id=${id} FOR UPDATE`;
  if(!billing || billing.status!=="DRAFT" || billing.signedAt)throw new ActionError("收费安排已签署或发生变化，不可删除");
  if(await db.feeEntry.count({where:{billingId:id}}) || await db.receivable.count({where:{billingId:id}}))throw new ActionError("收费安排已有收付关联，不可删除");
  await db.billing.delete({where:{id}});
  await auditTx(db,{userId,action:"BILLING_DELETE",targetType:"Billing",targetId:id,detail:{matterId:target.matterId,status:"DRAFT"}});
  return {id,matterId:target.matterId};
}
