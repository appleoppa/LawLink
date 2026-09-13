import { z } from "zod";
import { identityDocumentInputSchema, isResidentIdNumber } from "@/lib/identity-documents";

export { isResidentIdNumber };
export const idNumberSchema = z.string().trim().toUpperCase().refine(isResidentIdNumber, "请输入有效的18位居民身份证号码");
export const basicProfileSchema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(40, "姓名不能超过40字"),
  email: z.string().trim().email("邮箱格式不正确").max(254, "邮箱过长"),
  phone: z.string().trim().max(30, "手机号不能超过30字").refine(value => !value || /^\+?[\d ()-]{5,30}$/.test(value), "手机号格式不正确").optional(),
  expectedUpdatedAt: z.string().datetime({ message: "资料版本无效，请刷新页面" })
});
export const myProfileSchema = basicProfileSchema.extend({ currentPassword: z.string().max(128).optional() });
export const adminProfileSchema = basicProfileSchema.extend({ id: z.string().cuid(), currentPassword: z.string().max(128).optional() });
export const bindIdentitySchema = identityDocumentInputSchema.and(z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
  expectedUpdatedAt: z.string().datetime()
}));
export const correctIdentitySchema = identityDocumentInputSchema.and(z.object({
  id: z.string().cuid(),
  reason: z.string().trim().min(4, "请填写至少4字的核对及更正原因").max(200, "原因不能超过200字")
    .refine(value => !/[0-9０-９]{7}/.test(value.replace(/[\s\-()（）]/g, "")), "原因中请勿填写完整证件号码或手机号"),
  expectedUpdatedAt: z.string().datetime()
}));
export function maskIdentity(value: string | null) {
  return value ? `${value.slice(0, 3)}***********${value.slice(-4)}` : null;
}
export function maskProfilePhone(value: string | null) {
  if (!value) return "";
  return value.length > 7 ? `${value.slice(0, 3)}${"*".repeat(value.length - 7)}${value.slice(-4)}` : "*".repeat(value.length);
}
