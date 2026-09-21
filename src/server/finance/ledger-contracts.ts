/** 合同版本链与应收调整，调用方使用 Serializable。 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { contractTermsInput, amendmentResult, type ContractTermsInput } from "@/lib/finance/contracts";
import { correctionInput } from "@/lib/finance/corrections";
import { assertLedgerWrite } from "./ledger-access";
import { requireFinanceLedger } from "./ledger-storage";
import { createInstallments } from "./ledger-registration";
import { correctionPlan,applyCorrectionPlan } from "./ledger-corrections";
import { resolveRoleUser } from "@/lib/roles/service";
import { scopeFor } from "@/lib/roles/catalog";
import { matterAssociationFilter } from "@/lib/permissions";
import { auditTx } from "@/server/audit";
import { assertMatterReviewCurrent } from "@/server/conflicts/matter-review";
import type { MoneyKind } from "@/lib/finance/ledger-labels";
import { ActionError } from "@/lib/action-error";
type BillingRow={id:string;matterId:string;moneyKind:MoneyKind;revision:number;status:string;signedAt:Date|null;effectiveAt:Date|null;sourceBillingId:string|null;amendmentType:string;contractAmount:Prisma.Decimal;resultingAmount:Prisma.Decimal|null;draftTerms:ContractTermsInput|null};
async function sourceForUpdate(db:Prisma.TransactionClient,id:string,revision:number){
 const [source]=await db.$queryRaw<BillingRow[]>`SELECT * FROM "Billing" WHERE id=${id} FOR UPDATE`;
 if(!source||source.revision!==revision||!source.signedAt||source.status!=="ACTIVE"||source.amendmentType==="TERMINATION")throw new ActionError("原收费版本已变化、未生效或已终止，请刷新");
 const children=await db.$queryRaw<{id:string}[]>`SELECT id FROM "Billing" WHERE "sourceBillingId"=${id} AND status='ACTIVE'`;
 if(children.length)throw new ActionError("该版本已有生效变更，请选择当前末版");
 return source;
}
async function checkRelations(db:Prisma.TransactionClient,matterId:string,terms:ReturnType<typeof contractTermsInput.parse>){
 const docs=await db.document.findMany({where:{id:{in:terms.documentIds},matterId,deletedAt:null},select:{id:true,sha256:true}});
 if(docs.length!==terms.documentIds.length)throw new ActionError("变更依据必须是本案有效材料");
 const procedures=await db.matterProcedure.findMany({where:{id:{in:terms.scopes.map(s=>s.procedureId)},matterId},select:{id:true}});
 if(procedures.length!==terms.scopes.length)throw new ActionError("代理范围不得关联其他案件程序");
 return docs;
}
export async function draftAmendmentTx(db:Prisma.TransactionClient,userId:string,input:ContractTermsInput){
 const terms=contractTermsInput.parse(input);await requireFinanceLedger(db);
 const target=await db.billing.findUnique({where:{id:terms.sourceBillingId},select:{matterId:true}});if(!target)throw new ActionError("原合同不存在");
 await assertLedgerWrite(db,userId,target.matterId,"finance.write",{allowTail:false});
 // 起草人必须本案经办，不能仅凭全所财务权限枚举案件材料。
 if(!await db.matter.count({where:{id:target.matterId,...matterAssociationFilter(userId)}}))throw new ActionError("合同变更须由本案经办登记");
 const source=await sourceForUpdate(db,terms.sourceBillingId,terms.sourceRevision);
 const actor=await db.user.findUniqueOrThrow({where:{id:userId},select:{role:true}});
 const role=await resolveRoleUser(userId,actor.role,db);
 if(actor.role==="CUSTOM"&&!scopeFor(role,"documents.read"))throw new ActionError("当前岗位无权查阅合同依据材料");
 await checkRelations(db,target.matterId,terms);
 const {result,delta}=amendmentResult(source.resultingAmount??source.contractAmount,terms.type,new Prisma.Decimal(terms.amount));
 const added=terms.installments.reduce((v,p)=>v.plus(p.amount),new Prisma.Decimal(0));
 const reduced=terms.reductions.reduce((v,p)=>v.plus(p.amount),new Prisma.Decimal(0));
 if(!added.eq(Prisma.Decimal.max(0,delta))||!reduced.eq(Prisma.Decimal.max(0,delta.negated())))throw new ActionError("新增分期或调减应收合计必须等于合同变动差额");
 if(terms.type==="TERMINATION"&&result.eq(0)&&!terms.reason)throw new ActionError("零收费终止必须说明依据");
 const id=randomUUID();
 await db.$executeRaw`INSERT INTO "Billing" (id,"matterId",title,"contractAmount",status,"moneyKind","amendmentType","sourceBillingId","previousAmount","resultingAmount","draftTerms","updatedAt") VALUES (${id},${source.matterId},${terms.title},${new Prisma.Decimal(terms.amount)},'DRAFT',${source.moneyKind}::"MoneyKind",${terms.type}::"BillingAmendmentType",${source.id},${source.resultingAmount??source.contractAmount},${result},${JSON.stringify(terms)}::jsonb,NOW())`;
 for(const documentId of terms.documentIds)await db.$executeRaw`INSERT INTO "BillingAttachment" ("billingId","documentId") VALUES (${id},${documentId})`;
 await auditTx(db,{userId,action:"BILLING_AMENDMENT_DRAFT",targetType:"Billing",targetId:id,detail:{matterId:source.matterId,sourceBillingId:source.id,type:terms.type,previousAmount:(source.resultingAmount??source.contractAmount).toFixed(2),resultingAmount:result.toFixed(2)}});
 return {id,matterId:source.matterId};
}
export async function activateAmendmentTx(db:Prisma.TransactionClient,userId:string,id:string,revision:number){
 await requireFinanceLedger(db);
 const target=await db.billing.findUnique({where:{id},select:{matterId:true}});if(!target)throw new ActionError("变更草稿不存在");
 // 先授权锁，再锁定业务行；实际减少收费还须独立更正确认权。
 await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
 const [draft]=await db.$queryRaw<BillingRow[]>`SELECT * FROM "Billing" WHERE id=${id} FOR UPDATE`;
 if(!draft||draft.revision!==revision||draft.status!=="DRAFT"||!draft.draftTerms)throw new ActionError("变更已处理或不属于补充协议草稿");
 const terms=contractTermsInput.parse(draft.draftTerms),source=await sourceForUpdate(db,terms.sourceBillingId,terms.sourceRevision);
 const {result,delta}=amendmentResult(source.resultingAmount??source.contractAmount,terms.type,new Prisma.Decimal(terms.amount));
 await assertLedgerWrite(db,userId,target.matterId,delta.lt(0)?"finance.correct":"finance.write",{allowTail:false});
 if(terms.effectiveAt>new Date())throw new ActionError("尚未到约定生效日期，可保留草稿到期后确认");
 if(terms.endsAt&&terms.type==='TERMINATION'&&terms.endsAt>new Date())throw new ActionError("尚未到终止日期");
 // 新增范围正式承接前完成动态冲突复核（2026-09-20 A 批 P2-7）：追加/替代总价/范围变更
 // 改变代理范围，生效即承接；调减与终止结算不扩大范围，不机械受阻。
 if(terms.type==='ADDITION'||terms.type==='REPLACEMENT'||terms.type==='SCOPE_ONLY')await assertMatterReviewCurrent(db,source.matterId);
 await checkRelations(db,source.matterId,terms);
 const lineage=await db.$queryRaw<{id:string}[]>`WITH RECURSIVE chain AS (SELECT id,"sourceBillingId" FROM "Billing" WHERE id=${source.id} UNION ALL SELECT b.id,b."sourceBillingId" FROM "Billing" b JOIN chain c ON b.id=c."sourceBillingId") SELECT id FROM chain`;
 const billingIds=lineage.map(r=>r.id);
 if(delta.lt(0)){
  const plans=[];
  for(const part of terms.reductions){
   const ar=await db.receivable.findUnique({where:{id:part.receivableId},select:{billingId:true}});
   if(!ar?.billingId||!billingIds.includes(ar.billingId))throw new ActionError("调减应收必须源于当前合同版本链");
   plans.push(await correctionPlan(db,source.matterId,correctionInput.parse({targetId:part.receivableId,revision:part.revision,type:"DISCOUNT",amount:part.amount,occurredAt:terms.effectiveAt,reason:terms.reason,voucherReference:`补充协议 ${terms.title}`,allocationReversals:part.allocationReversals})));
  }
  if(!plans.length)throw new ActionError("合同调减必须指定应收");
  const combined=plans[0];for(const plan of plans.slice(1)){
   combined.effects.push(...plan.effects);for(const key of ['arReversed','arAdjusted','paymentReversed'] as const)for(const [id,value] of plan[key])combined[key].set(id,(combined[key].get(id)??new Prisma.Decimal(0)).plus(value));for(const id of plan.touchedPayments)combined.touchedPayments.add(id);
  }
  const correctionId=randomUUID(),arId=terms.reductions[0].receivableId;
  await db.$executeRaw`INSERT INTO "FinanceCorrection" (id,"matterId","targetType","targetId","receivableId",type,amount,reason,"relatedDocNo","createdById",status,"confirmedById","confirmedAt","occurredAt","sourceBillingId","requestPayload") VALUES (${correctionId},${source.matterId},'Receivable',${arId},${arId},'DISCOUNT',${delta.negated()},${terms.reason},${terms.title},${userId},'CONFIRMED',${userId},NOW(),${terms.effectiveAt},${id},${JSON.stringify({kind:'CONTRACT',input:terms})}::jsonb)`;
  await applyCorrectionPlan(db,correctionId,combined);
  await auditTx(db,{userId,action:"FINANCE_CORRECTION_CONFIRMED",targetType:"FinanceCorrection",targetId:correctionId,detail:{matterId:source.matterId,sourceBillingId:id,amount:delta.negated().toFixed(2)}});
 }
 if(delta.gt(0))await createInstallments(db,{id,matterId:source.matterId,moneyKind:source.moneyKind},terms.installments);
 for(const scope of terms.scopes)await db.$executeRaw`INSERT INTO "BillingProcedureScope" ("billingId","procedureId",state,note) VALUES (${id},${scope.procedureId},${scope.state}::"BillingScopeState",${scope.note})`;
 await db.$executeRaw`UPDATE "Billing" SET status='ACTIVE',"signedAt"=${terms.signedAt},"effectiveAt"=${terms.effectiveAt},"endsAt"=${terms.endsAt??null},"terminationReason"=${terms.type==='TERMINATION'?terms.reason:null},"completedWork"=${terms.completedWork},"handoverWork"=${terms.handoverWork},revision=revision+1,"updatedAt"=NOW() WHERE id=${id}`;
 await db.$executeRaw`UPDATE "Billing" SET revision=revision+1,"updatedAt"=NOW() WHERE id=${source.id}`;
 await auditTx(db,{userId,action:"BILLING_AMENDMENT_ACTIVATE",targetType:"Billing",targetId:id,detail:{matterId:source.matterId,sourceBillingId:source.id,resultingAmount:result.toFixed(2),delta:delta.toFixed(2),type:terms.type}});
 return {matterId:source.matterId};
}

export async function cancelAmendmentTx(db:Prisma.TransactionClient,userId:string,id:string,revision:number){
 await requireFinanceLedger(db);
 const target=await db.billing.findUnique({where:{id},select:{matterId:true}});if(!target)throw new ActionError("变更不存在");
 await assertLedgerWrite(db,userId,target.matterId,"finance.write",{allowTail:false});
 const [draft]=await db.$queryRaw<BillingRow[]>`SELECT * FROM "Billing" WHERE id=${id} FOR UPDATE`;
 if(draft.revision!==revision||draft.status!=="DRAFT"||!draft.sourceBillingId)throw new ActionError("只可作废尚未生效且未变化的补充协议草稿");
 await db.$executeRaw`UPDATE "Billing" SET status='CLOSED',revision=revision+1,"updatedAt"=NOW() WHERE id=${id}`;
 await auditTx(db,{userId,action:"BILLING_AMENDMENT_CANCEL",targetType:"Billing",targetId:id,detail:{matterId:target.matterId}});
 return target;
}

/** 明确既有合同覆盖范围；不改变价款，保留修改审计。 */
export async function bindContractScopeTx(db:Prisma.TransactionClient,userId:string,input:{billingId:string;revision:number;procedureId:string;state:'COVERED'|'SUPPLEMENT_REQUIRED'|'PENDING_REVIEW';note:string}){
 const {z}=await import('zod');const d=z.object({billingId:z.string().min(1),revision:z.number().int().nonnegative(),procedureId:z.string().cuid(),state:z.enum(['COVERED','SUPPLEMENT_REQUIRED','PENDING_REVIEW']),note:z.string().trim().min(1,'请填写覆盖条款或零收费豁免依据').max(1000)}).parse(input);
 const b=await db.billing.findUniqueOrThrow({where:{id:d.billingId},select:{matterId:true}});await assertLedgerWrite(db,userId,b.matterId,'finance.write',{allowTail:false});
 if(!await db.matter.count({where:{id:b.matterId,...matterAssociationFilter(userId)}}))throw new ActionError('仅本案经办可以确认代理范围');
 await sourceForUpdate(db,d.billingId,d.revision);
 if(!await db.matterProcedure.count({where:{id:d.procedureId,matterId:b.matterId}}))throw new ActionError('程序不属于本案');
 // 确认覆盖＝新范围正式承接（P2-7）：须先通过当前主体与范围的动态冲突复核；
 // SUPPLEMENT_REQUIRED / PENDING_REVIEW 本身即待复核语义，不受此门禁阻断。
 if(d.state==='COVERED')await assertMatterReviewCurrent(db,b.matterId);
 await db.$executeRaw`INSERT INTO "BillingProcedureScope" ("billingId","procedureId",state,note) VALUES (${d.billingId},${d.procedureId},${d.state}::"BillingScopeState",${d.note}) ON CONFLICT ("billingId","procedureId") DO UPDATE SET state=EXCLUDED.state,note=EXCLUDED.note`;
 await db.$executeRaw`UPDATE "Billing" SET revision=revision+1,"updatedAt"=NOW() WHERE id=${d.billingId}`;
 await auditTx(db,{userId,action:'BILLING_SCOPE_CONFIRM',targetType:'Billing',targetId:d.billingId,detail:{matterId:b.matterId,procedureId:d.procedureId,state:d.state,note:d.note,previousRevision:d.revision}});return {matterId:b.matterId};
}
export async function assertProcedureCovered(db:Prisma.TransactionClient,procedureId:string){
 const [r]=await db.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM "BillingProcedureScope" s JOIN "Billing" b ON b.id=s."billingId" WHERE s."procedureId"=${procedureId} AND s.state='COVERED' AND b.status='ACTIVE' AND b."signedAt" IS NOT NULL AND b."amendmentType"<>'TERMINATION' AND NOT EXISTS(SELECT 1 FROM "Billing" newer WHERE newer."sourceBillingId"=b.id AND newer.status='ACTIVE')`;
 if(!Number(r.count))throw new ActionError('本程序尚无有效委托覆盖，请在财务的合同范围中确认条款或零收费依据');
}
