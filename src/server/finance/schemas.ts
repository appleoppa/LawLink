import { z } from "zod";

export const feeEntryTypeSchema = z.enum([
  "RECEIVABLE",
  "RECEIVED",
  "REFUND",
  "COST",
  "COMMISSION"
]);

export const billingStatusSchema = z.enum(["DRAFT", "ACTIVE", "CLOSED"]);

export const billingCreateSchema = z.object({
  matterId: z.string().cuid(),
  title: z.string().min(1, "合同名称必填").max(120),
  contractAmount: z.coerce.number().nonnegative(),
  schedule: z.string().max(1000).optional().or(z.literal("")),
  status: billingStatusSchema.default("DRAFT"),
  signedAt: z.coerce.date().optional()
});

export const feeEntryCreateSchema = z.object({
  matterId: z.string().cuid(),
  billingId: z.string().cuid().optional().or(z.literal("")),
  type: feeEntryTypeSchema,
  // 金额一律取正数，方向由 type 表达；负数实收会让统计口径与 Payment 对不上（2026-09-19）
  amount: z.coerce.number().positive("金额必须大于 0").max(99_999_999.99, "金额超出范围"),
  occurredAt: z.coerce.date().default(() => new Date()),
  invoiceNo: z.string().max(50).optional().or(z.literal("")),
  payerOrPayee: z.string().max(80).optional().or(z.literal("")),
  method: z.string().max(40).optional().or(z.literal("")),
  note: z.string().max(500).optional().or(z.literal(""))
});

export const commissionPlanSetSchema = z.object({
  matterId: z.string().cuid(),
  items: z
    .array(
      z.object({
        userId: z.string().cuid(),
        percent: z.coerce.number().finite().min(0).max(100).refine(
          value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
          "分成比例最多两位小数"
        ),
        label: z.string().max(40).optional().or(z.literal(""))
      })
    )
    .default([])
}).superRefine(({ items }, ctx) => {
  if (items.reduce((total, item) => total + Math.round(item.percent * 100), 0) > 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "分成比例合计不得超过 100%" });
  }
  const users = new Set<string>();
  items.forEach((item, index) => {
    if (users.has(item.userId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "userId"], message: "同一受益人只能设置一项分成" });
    users.add(item.userId);
  });
});

export type BillingCreateInput = z.infer<typeof billingCreateSchema>;
export type FeeEntryCreateInput = z.infer<typeof feeEntryCreateSchema>;
export type CommissionPlanSetInput = z.infer<typeof commissionPlanSetSchema>;
