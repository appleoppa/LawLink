import { Prisma } from "@prisma/client";
import { z } from "zod";
import { moneyInput } from "./ledger";
import { ActionError } from "@/lib/action-error";

const id = z.string().min(1).max(80);
const items = z.array(z.object({ targetId: id, amount: moneyInput })).max(100).default([]).superRefine((rows, ctx) => {
  if (new Set(rows.map(r => r.targetId)).size !== rows.length) ctx.addIssue({ code: "custom", message: "同一关联只能填写一次" });
});
export const actualDate = z.coerce.date().refine(d => d <= new Date(), "实际发生日期不能在未来");
export const correctionInput = z.object({
  targetId: id,
  targetKind: z.enum(["LEDGER", "EXPENSE"]).default("LEDGER"),
  revision: z.number().int().nonnegative(),
  type: z.enum(["REFUND", "DISCOUNT", "REVERSAL"]),
  debtTreatment: z.enum(["KEEP_DEBT", "WAIVE_DEBT"]).default("KEEP_DEBT"),
  amount: moneyInput,
  occurredAt: actualDate,
  reason: z.string().trim().min(1, "请填写原因").max(2000),
  voucherReference: z.string().trim().min(1, "请填写凭据编号或材料依据").max(500),
  allocationReversals: items,
  invoiceReversals: items,
  waivers: items,
}).superRefine((data, ctx) => {
  if (data.targetKind === "EXPENSE" && (data.type !== "REVERSAL" || data.allocationReversals.length || data.invoiceReversals.length || data.waivers.length)) ctx.addIssue({code:"custom",message:"支出只支持原记录冲销，不关联收款或应收"});
  if (data.type !== "REFUND" && (data.debtTreatment !== "KEEP_DEBT" || data.waivers.length)) ctx.addIssue({ code: "custom", message: "只有退款可以同时选择免除债权" });
  if (data.type === "DISCOUNT" && data.invoiceReversals.length) ctx.addIssue({ code: "custom", message: "折让不改变票款关系" });
  if (data.debtTreatment === "KEEP_DEBT" && data.waivers.length) ctx.addIssue({ code: "custom", message: "保留债权不能减免应收" });
});
export type CorrectionInput = z.input<typeof correctionInput>;
export const correctionDecision = z.object({ id, revision: z.number().int().nonnegative(), decision: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]), note: z.string().trim().max(2000).default("") }).superRefine((data, ctx) => {
  if (data.decision !== "CONFIRMED" && !data.note) ctx.addIssue({ code: "custom", message: "请填写处理原因" });
});
export const settlementInput = z.object({ commissionEntryId: id, revision: z.number().int().nonnegative(), kind: z.enum(["PAID", "RECOVERED"]), amount: moneyInput, occurredAt: actualDate, voucherReference: z.string().trim().min(1, "请填写支付或扣回凭据").max(500), note: z.string().trim().max(2000).default("") });
export type SettlementInput = z.input<typeof settlementInput>;
export function commissionPosition(original: Prisma.Decimal, adjustment: Prisma.Decimal, paid: Prisma.Decimal, recovered: Prisma.Decimal) {
  const accrued = original.plus(adjustment), netPaid = paid.minus(recovered);
  return { accrued, paid, recovered, netPaid, payable: Prisma.Decimal.max(0, accrued.minus(netPaid)), recoverable: Prisma.Decimal.max(0, netPaid.minus(accrued)) };
}
/** 累计目标额减去此前撤回额，原计提金额包含当时的分摊尾差。 */
export function commissionReversal(original: Prisma.Decimal, base: Prisma.Decimal, cumulativeRefund: Prisma.Decimal, priorReversal: Prisma.Decimal) {
  if (base.lte(0) || cumulativeRefund.gt(base) || cumulativeRefund.lt(0)) throw new ActionError("分成基数或退款金额不一致");
  return original.mul(cumulativeRefund).div(base).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).minus(priorReversal);
}
