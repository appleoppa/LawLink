import { ALL_CLIENT_ID_TYPES, personIdError } from "@/lib/clients/person-id";
import { z } from "zod";

export const clientTypeSchema = z.enum(["INDIVIDUAL", "COMPANY", "ORGANIZATION"]);
export const cooperationStatusSchema = z.enum([
  "POTENTIAL",
  "NEGOTIATING",
  "SIGNED",
  "TERMINATED"
]);
export const clientGenderSchema = z.enum(["MALE", "FEMALE"]);

// v1.x P0-1: 主体证件类型（个人=身份证/护照，机构=统一社会信用代码）
export const clientIdTypeSchema = z.enum(ALL_CLIENT_ID_TYPES);

export const contactInputSchema = z.object({
  name: z.string().min(1, "联系人姓名必填").max(40),
  title: z.string().max(40).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  wechat: z.string().max(40).optional().or(z.literal("")),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(500).optional().or(z.literal(""))
});

/** 自然人证件号按所选证件类型校验（身份证：数字/末位 X、18 位） */
function validateClientIdNumber(data: { type: string; idType?: string; idNumber?: string }, ctx: z.RefinementCtx) {
  if (!data.idNumber?.trim()) return;
  const idType = data.idType || (data.type === "INDIVIDUAL" ? "ID_CARD" : "USCC");
  if (data.type === "INDIVIDUAL" && idType === "USCC") {
    ctx.addIssue({ path: ["idType"], code: z.ZodIssueCode.custom, message: "自然人不能使用统一社会信用代码，请选择证件类型" });
    return;
  }
  if (data.type === "INDIVIDUAL" || idType !== "USCC") {
    const error = personIdError(idType, data.idNumber);
    if (error) ctx.addIssue({ path: ["idNumber"], code: z.ZodIssueCode.custom, message: error });
  }
}

const clientBaseSchema = z.object({
  name: z.string().min(1, "客户名称必填").max(120),
  type: clientTypeSchema,
  idType: clientIdTypeSchema.optional().or(z.literal("")),
  idNumber: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  legalRep: z.string().max(40).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  source: z.string().max(80).optional().or(z.literal("")),
  // v0.39: 案件云式补充字段（internalCode 系统生成，不收用户输入）
  cooperationStatus: cooperationStatusSchema.default("SIGNED"),
  industry: z.string().max(60).optional().or(z.literal("")),
  gender: clientGenderSchema.optional().or(z.literal("")),
  ethnicity: z.string().max(30).optional().or(z.literal("")),
  tags: z.array(z.string().max(20)).default([]),
  notes: z.string().max(1000).optional().or(z.literal("")),
  contacts: z.array(contactInputSchema).default([])
});

export const clientCreateSchema = clientBaseSchema.superRefine(validateClientIdNumber);

export const clientUpdateSchema = clientBaseSchema.extend({
  id: z.string().cuid()
}).superRefine(validateClientIdNumber);

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;

export const clientListQuerySchema = z.object({
  search: z.string().optional(),
  type: clientTypeSchema.optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
