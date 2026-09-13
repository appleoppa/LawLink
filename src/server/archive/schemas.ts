import { z } from "zod";

export const archiveClosedReasonSchema = z.enum([
  "JUDGMENT",
  "MEDIATION",
  "WITHDRAWAL",
  "SETTLEMENT",
  "RULING",
  "OTHER"
]);

export const archiveSubmitSchema = z.object({
  matterId: z.string().cuid(),
  summary: z.string().min(1, "结案小结必填").max(4000),
  closedReason: archiveClosedReasonSchema,
  completedAt: z.coerce.date(),
  judgmentSummary: z.string().max(2000).optional().or(z.literal("")),
  checklistItems: z.record(z.object({
    status: z.enum(["ATTACHED", "MISSING", "NOT_APPLICABLE"]),
    documentIds: z.array(z.string().cuid()).max(200),
    note: z.string().trim().max(1000).default("")
  })),
  manualChecks: z.record(z.object({
    confirmed: z.boolean(),
    note: z.string().trim().max(1000).default("")
  })),
  // 必交项缺失时须逐项说明并明确申请例外审批。
  forceWithMissing: z.boolean().default(false)
});

export type ArchiveSubmitInput = z.infer<typeof archiveSubmitSchema>;

export const archiveApproveSchema = z.object({
  archiveId: z.string().cuid(),
  note: z.string().trim().max(500).optional(),
  verificationIds: z.array(z.string().max(120)).max(500),
  exceptionApproved: z.boolean().default(false)
});

export type ArchiveApproveInput = z.infer<typeof archiveApproveSchema>;

export const CLOSED_REASON_CN: Record<z.infer<typeof archiveClosedReasonSchema>, string> = {
  JUDGMENT: "判决",
  MEDIATION: "调解",
  WITHDRAWAL: "撤诉",
  SETTLEMENT: "和解",
  RULING: "裁定",
  OTHER: "其他"
};
