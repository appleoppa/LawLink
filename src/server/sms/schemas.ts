import { z } from "zod";

export const smsParseAndSaveSchema = z.object({
  rawText: z.string().min(1, "短信内容必填").max(8000),
  batch: z.boolean().default(false), // 按空行分隔多条
  useAi: z.boolean().default(false), // v0.9.1：调 AI 抽 summary/action/urgency
  extractAttachments: z.boolean().default(false)
});

export const smsListFilterSchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  processed: z.enum(["unprocessed", "processed", "all"]).default("unprocessed"),
  needsManual: z.boolean().default(false),
  smsType: z
    .enum([
      "HEARING_NOTICE",
      "SERVICE_NOTICE",
      "FEE_NOTICE",
      "MEDIATION",
      "ENFORCEMENT",
      "FILING_NOTICE",
      "JUDGMENT_NOTICE",
      "EVIDENCE_SUBMIT",
      "OTHER"
    ])
    .optional()
});

export const smsMatchToMatterSchema = z.object({
  smsId: z.string().cuid(),
  matterId: z.string().cuid().nullable()
});

export const smsGenerateHearingSchema = z.object({
  smsId: z.string().cuid(),
  procedureId: z.string().cuid(),
  title: z.string().min(1).max(100),
  startsAt: z.coerce.date(),
  room: z.string().max(80).optional().or(z.literal("")),
  judge: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal(""))
});

export const smsGenerateDeadlineSchema = z.object({
  smsId: z.string().cuid(),
  procedureId: z.string().cuid(),
  title: z.string().min(1).max(100),
  category: z
    .enum([
      "LIMITATION",
      "EVIDENCE",
      "APPEAL",
      "PERFORMANCE",
      "RESPONSE",
      "ENFORCEMENT",
      "ARBITRATION_SET_ASIDE",
      "CUSTOM"
    ])
    .default("CUSTOM"),
  dueAt: z.coerce.date(),
  basis: z.string().max(200).optional().or(z.literal("")),
  remindDays: z.coerce.number().int().positive().default(3)
});

export const smsIdSchema = z.object({ id: z.string().cuid() });

export const smsBackfillCaseNumberSchema = z.object({
  smsId: z.string().cuid(),
  procedureId: z.string().cuid(),
  caseNumber: z.string().trim().min(5, "案号过短").max(60)
});
