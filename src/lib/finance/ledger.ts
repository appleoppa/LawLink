import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { MoneyKind } from "./ledger-labels";
export { moneyKinds, moneyKindLabels, dueLabels } from "./ledger-labels";
export type { MoneyKind } from "./ledger-labels";
export const moneyInput = z.union([z.string(), z.number()]).transform(String).refine(
  value => /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value) && new Prisma.Decimal(value).gt(0),
  "金额须大于 0，最多两位小数"
);
export const allocationInput = z.object({
  paymentId: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  kind: z.enum(["RECEIVABLE", "INVOICE"]),
  items: z.array(z.object({ targetId: z.string().min(1).max(80), amount: moneyInput })).min(1).max(100),
}).superRefine((input, ctx) => {
  if (new Set(input.items.map(i => i.targetId)).size !== input.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "同一目标只能填写一次" });
});
export type AllocateLedgerInput = z.input<typeof allocationInput>;
export type LedgerFields = { moneyKind: MoneyKind; revision: number };
export type LedgerReceivable = LedgerFields & { id: string; matterId: string; title: string; amount: Prisma.Decimal; settledAmount: Prisma.Decimal; adjustmentAmount: Prisma.Decimal; status: string; dueDate: Date | null; dueState: string; dueCondition: string | null; conditionSatisfiedAt: Date | null; billingId: string | null };
export type LedgerPayment = LedgerFields & { id: string; matterId: string; amount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal; feeEntryId: string | null; occurredAt: Date; sourceValid: boolean };
export type LedgerInvoice = { id: string; matterId: string | null; invoiceNo: string | null; amount: Prisma.Decimal; linked: Prisma.Decimal };
const zero = () => new Prisma.Decimal(0);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), zero());
export const receivableBalance = (r: LedgerReceivable) => r.amount.plus(r.adjustmentAmount).minus(r.settledAmount);
export const paymentBalance = (p: LedgerPayment) => p.amount.minus(p.refundedAmount).minus(p.allocatedAmount);

/** 到期日是上海的民事日期，不按浏览器时区或当前时刻计算逾期天数。 */
export function dueBucket(row: Pick<LedgerReceivable, "dueState" | "dueDate" | "conditionSatisfiedAt">, now = new Date()) {
  const date = row.dueState === "DATE_SET" ? row.dueDate : row.dueState === "CONDITIONAL" ? row.conditionSatisfiedAt : null;
  if (!date) return row.dueState === "CONDITIONAL" ? "CONDITIONAL" as const : "UNKNOWN" as const;
  const day = (value: Date) => Math.floor((value.getTime() + 8 * 3600000) / 86400000);
  return day(now) > day(date) ? "OVERDUE" as const : "NOT_DUE" as const;
}

/** 仅使用正式应收及已确认实收，不维护历史待核或并行统计口径。 */
export function summarizeLedger(receivables: LedgerReceivable[], payments: LedgerPayment[]) {
  if (payments.some(p => !p.sourceValid)) throw new Error("实收来源不一致，不能生成财务汇总");
  const active = receivables.filter(r => r.status !== "CANCELLED");
  return {
    receivable: sum(active.map(r => r.amount.plus(r.adjustmentAmount))).toFixed(2),
    outstanding: sum(active.map(receivableBalance)).toFixed(2),
    netReceived: sum(payments.map(p => p.amount.minus(p.refundedAmount))).toFixed(2),
    unallocated: sum(payments.map(paymentBalance)).toFixed(2),
    lawyerFeeReceived: sum(payments.filter(p => p.moneyKind === "LAWYER_FEE").map(p => p.amount.minus(p.refundedAmount))).toFixed(2),
    clientFundsReceived: sum(payments.filter(p => p.moneyKind === "CLIENT_FUNDS").map(p => p.amount.minus(p.refundedAmount))).toFixed(2),
  };
}
