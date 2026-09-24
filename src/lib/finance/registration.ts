import { Prisma } from "@prisma/client";
import { z } from "zod";
import { moneyInput } from "./ledger";
import { moneyKinds } from "./ledger-labels";
const id = z.string().min(1).max(80);
export const installmentInput = z.object({
  title: z.string().trim().min(1).max(120), amount: moneyInput,
  dueState: z.enum(["UNKNOWN", "DATE_SET", "CONDITIONAL"]),
  dueDate: z.coerce.date().optional(), dueCondition: z.string().trim().max(1000).optional(),
}).superRefine((r,ctx) => {
  if (r.dueState === "DATE_SET" && !r.dueDate) ctx.addIssue({code:"custom",path:["dueDate"],message:"请填写到期日"});
  if (r.dueState === "CONDITIONAL" && !r.dueCondition) ctx.addIssue({code:"custom",path:["dueCondition"],message:"请填写到期条件"});
});
export const billingRegistrationInput = z.object({
  matterId: id, title: z.string().trim().min(1).max(120), moneyKind: z.enum(moneyKinds),
  amount: z.union([z.string(),z.number()]).transform(String).refine(v=>/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v),"收费金额须非负且最多两位小数"),
  signedAt: z.coerce.date().refine(d=>d<=new Date(),"实际签署日期不能在未来").optional(), installments: z.array(installmentInput).max(100),
}).superRefine((r,ctx) => {
  // 字段级校验失败时不再把非法文本传给 Decimal，保持可预期的表单错误。
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(r.amount) || r.installments.some(p=>!moneyInput.safeParse(p.amount).success)) return;
  if (r.signedAt && !r.installments.reduce((v,p)=>v.plus(p.amount),new Prisma.Decimal(0)).eq(r.amount)) ctx.addIssue({code:"custom",path:["installments"],message:"各期金额合计必须等于收费总额"});
  if (!r.signedAt && r.installments.length) ctx.addIssue({code:"custom",path:["installments"],message:"草稿暂不生成应收，请签署时确认分期"});
});
export const receiptRegistrationInput = z.object({
  matterId: id, billingId: id.optional(), amount: moneyInput, moneyKind: z.enum(moneyKinds),
  occurredAt: z.coerce.date().refine(d=>d<=new Date(),"实际发生日期不能在未来"), payerOrPayee: z.string().trim().max(80).optional(), note: z.string().trim().max(500).optional(),
});
export const billingSignInput = z.object({id, revision:z.number().int().nonnegative(), signedAt:z.coerce.date().refine(d=>d<=new Date(),"实际签署日期不能在未来"), installments:z.array(installmentInput).max(100)});
export const conditionInput = z.object({id, revision:z.number().int().nonnegative(), satisfiedAt:z.coerce.date(), note:z.string().trim().min(1,"请填写条件成就依据").max(1000)});
export type BillingRegistration = z.input<typeof billingRegistrationInput>;
export type ReceiptRegistration = z.input<typeof receiptRegistrationInput>;
