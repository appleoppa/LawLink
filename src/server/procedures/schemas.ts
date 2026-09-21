import { z } from "zod";
import { procedureTypeSchema } from "@/server/matters/schemas";

export const procedureEngagementSchema = z.enum(["ENGAGED", "INFORMATIONAL"]);

export const procedureStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "CONCLUDED"]);

export const procedureOutcomeSchema = z.enum([
  "WON",
  "PARTIAL_WON",
  "LOST",
  "MEDIATED",
  "WITHDRAWN",
  "DISMISSED",
  "COMPLETED",
  "TRANSFERRED",
  "OTHER"
]);

export const procedureCreateSchema = z.object({
  matterId: z.string().cuid(),
  type: procedureTypeSchema,
  customLabel: z.string().max(40).optional().or(z.literal("")),
  engagement: procedureEngagementSchema.default("ENGAGED"),
  caseNumber: z.string().max(80).optional().or(z.literal("")),
  jurisdiction: z.string().max(120).optional().or(z.literal("")),
  handlingAgency: z.string().max(120).optional().or(z.literal("")),
  panel: z.string().max(80).optional().or(z.literal("")),
  handler: z.string().max(40).optional().or(z.literal("")),
  acceptedAt: z.string().optional().nullable().transform(v => (!v ? undefined : new Date(v))),
  // v0.44: 主办律师
  leadLawyerId: z.string().cuid().optional().nullable(),
  isExternalLead: z.boolean().default(false)
});

export const procedureUpdateSchema = z.object({
  id: z.string().cuid(),
  type: procedureTypeSchema.optional(),
  customLabel: z.string().max(40).optional().or(z.literal("")),
  caseNumber: z.string().max(80).optional().or(z.literal("")),
  jurisdiction: z.string().max(120).optional().or(z.literal("")),
  handlingAgency: z.string().max(120).optional().or(z.literal("")),
  panel: z.string().max(80).optional().or(z.literal("")),
  handler: z.string().max(40).optional().or(z.literal("")),
  acceptedAt: z.string().optional().nullable().transform(v => (!v ? undefined : new Date(v))),
  concludedAt: z.coerce.date().optional(),
  status: procedureStatusSchema.optional(),
  outcome: procedureOutcomeSchema.optional(),
  outcomeNote: z.string().max(500).optional().or(z.literal(""))
});

export const deadlineCategorySchema = z.enum([
  "LIMITATION",
  "EVIDENCE",
  "APPEAL",
  "PERFORMANCE",
  "RESPONSE",
  "ENFORCEMENT",
  "ARBITRATION_SET_ASIDE",
  "PRESERVATION",
  "CUSTOM"
]);

export const deadlineCreateSchema = z.object({
  procedureId: z.string().cuid(),
  title: z.string().min(1, "期限名称必填").max(100),
  category: deadlineCategorySchema.default("CUSTOM"),
  // 必填日期：date input 清空得到空串，先归一成 undefined，配中文 required_error 提示补填
  dueAt: z.preprocess(
    v => (v === "" ? undefined : v),
    z.coerce.date({ required_error: "请选择到期日", invalid_type_error: "请选择到期日" })
  ),
  basis: z.string().max(200).optional().or(z.literal("")),
  remindDays: z.coerce
    .number({ invalid_type_error: "请填写提醒天数" })
    .int("提醒天数须为整数")
    .min(0, "提醒天数不能为负")
    .max(60, "提醒天数不能超过 60")
    .default(3),
  // v1.x P0-8: 期限来源（规则触发时由调用方带入；人工录入可空 = 已确认）
  sourceRuleId: z.string().optional().or(z.literal("")),
  startFact: z.string().max(200).optional().or(z.literal("")),
  sourceDocumentId: z.string().optional().or(z.literal("")),
  // 第六轮体检 P2-1：规则起算日（上海日历日），服务端据此按规则重算并与 dueAt 比对，
  // 不一致不拒绝（允许人工调整）但在 basis 标注提示核对；仅随 sourceRuleId 一起发送
  sourceTriggerDate: z.preprocess(
    v => (v === "" || v == null ? undefined : v),
    z.coerce.date().optional()
  )
});

export const hearingCreateSchema = z.object({
  procedureId: z.string().cuid(),
  title: z.string().min(1, "开庭主题必填").max(80),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  room: z.string().max(40).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  judge: z.string().max(40).optional().or(z.literal("")),
  contact: z.string().max(80).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal(""))
});

export const procedureStageCreateSchema = z.object({
  procedureId: z.string().cuid(),
  name: z.string().trim().min(1, "环节名称必填").max(40, "环节名称不能超过 40 个字"),
  description: z.string().max(500, "说明不能超过 500 个字").optional().or(z.literal("")),
  insertPosition: z.enum(["START", "END", "AFTER"]).default("END"),
  insertAfterStageId: z.string().cuid().optional().or(z.literal("")),
  insertAfterStageName: z.string().max(40).optional().or(z.literal(""))
});

export const procedureStageRemoveSchema = z.object({
  id: z.string().cuid()
});

export type ProcedureCreateInput = z.infer<typeof procedureCreateSchema>;
export type ProcedureUpdateInput = z.infer<typeof procedureUpdateSchema>;
export type DeadlineCreateInput = z.infer<typeof deadlineCreateSchema>;
export type HearingCreateInput = z.infer<typeof hearingCreateSchema>;
export type ProcedureStageCreateInput = z.infer<typeof procedureStageCreateSchema>;
export type ProcedureStageRemoveInput = z.infer<typeof procedureStageRemoveSchema>;
