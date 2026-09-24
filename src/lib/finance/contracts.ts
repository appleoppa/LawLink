import { z } from "zod";
import { Prisma } from "@prisma/client";
import { installmentInput } from "./registration";
import { actualDate } from "./corrections";
import { moneyInput } from "./ledger";
import { ActionError } from "@/lib/action-error";
const id=z.string().min(1).max(80);
const amount=z.union([z.string(),z.number()]).transform(String).refine(v=>/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v),"金额须非负且最多两位小数");
import { amendmentTypes } from "./contract-labels";
export const contractTermsInput=z.object({
 sourceBillingId:id,sourceRevision:z.number().int().nonnegative(),title:z.string().trim().min(1).max(120),type:z.enum(amendmentTypes),amount,
 signedAt:actualDate,effectiveAt:z.coerce.date(),endsAt:z.coerce.date().optional(),reason:z.string().trim().min(1).max(2000),
 completedWork:z.string().trim().max(4000).default(""),handoverWork:z.string().trim().max(4000).default(""),
 documentIds:z.array(id).min(1,"请关联变更依据材料").max(50),
 scopes:z.array(z.object({procedureId:id,state:z.enum(["COVERED","SUPPLEMENT_REQUIRED","PENDING_REVIEW"]),note:z.string().trim().min(1,"请说明代理范围或豁免依据").max(2000)})).max(100).default([]),
 installments:z.array(installmentInput).max(100).default([]),
 reductions:z.array(z.object({receivableId:id,revision:z.number().int().nonnegative(),amount:moneyInput,allocationReversals:z.array(z.object({targetId:id,amount:moneyInput})).max(100).default([])})).max(100).default([]),
}).superRefine((v,c)=>{
 for(const [key,ids] of [["documentIds",v.documentIds],["scopes",v.scopes.map(s=>s.procedureId)],["reductions",v.reductions.map(r=>r.receivableId)]] as const) if(new Set(ids).size!==ids.length)c.addIssue({code:"custom",path:[key],message:"同一对象只能选择一次"});
 if(v.effectiveAt<v.signedAt)c.addIssue({code:"custom",path:["effectiveAt"],message:"生效日不能早于签署日"});
 if(v.endsAt&&v.endsAt<v.effectiveAt)c.addIssue({code:"custom",path:["endsAt"],message:"终止或到期日不能早于生效日"});
 if(v.type==="TERMINATION"&&(!v.endsAt||!v.completedWork||!v.handoverWork))c.addIssue({code:"custom",message:"终止结算须填写终止日期、已完成事项和待交接事项（没有请明确填无）"});
});
export type ContractTermsInput=z.input<typeof contractTermsInput>;
export function amendmentResult(previous:Prisma.Decimal,type:typeof amendmentTypes[number],value:Prisma.Decimal){
 const result=type==="ADDITION"?previous.plus(value):type==="REDUCTION"?previous.minus(value):type==="SCOPE_ONLY"?previous:value;
 if(result.lt(0))throw new ActionError("调减不能超过当前合同总额");
 if(type==="SCOPE_ONLY"&&!value.eq(0))throw new ActionError("仅范围变更的变动金额必须为零");
 return {result,delta:result.minus(previous)};
}
/** 每条版本链只计已生效末版；草稿不覆盖现行总额。 */
export function effectiveContractRows<T extends {id:string;sourceBillingId:string|null;signedAt:Date|null;status:string;contractAmount:Prisma.Decimal;resultingAmount:Prisma.Decimal|null}>(rows:T[]){
 const active=rows.filter(r=>r.signedAt&&r.status!=="DRAFT"&&r.status!=="CANCELLED");const replaced=new Set(active.map(r=>r.sourceBillingId).filter(Boolean));
 return active.filter(r=>!replaced.has(r.id)).map(r=>({...r,contractAmount:r.resultingAmount??r.contractAmount}));
}
