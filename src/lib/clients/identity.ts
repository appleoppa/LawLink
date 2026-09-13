/**
 * 客户主体身份规范化与查重（报告 P0-1）。
 *
 * 身份持续唯一策略（v5 报告定稿）：停用/软删除客户仍占用身份，
 * 重复主体经恢复或合并处理；数据库层以部分唯一索引兜底
 * （Client_idType_idNumber_active_key，见迁移 20260913052823）。
 * 本模块是三入口（建档/编辑/导入）共用的规范化与查重口径。
 */
import type { ClientIdType } from "@prisma/client";
import { blindIdNumber } from "@/lib/clients/id-number-crypto";

/** 规范化证件号码：去首尾空白 + 大写（身份证尾号 x、信用代码小写均统一） */
export function normalizeIdNumber(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return v.length > 0 ? v : null;
}

/** 按客户主体类型的默认证件类型建议（仅建议，表单仍需确认） */
export function suggestIdType(clientType: "PERSON" | "COMPANY" | "ORG" | string): ClientIdType | null {
  if (clientType === "COMPANY" || clientType === "ORG") return "USCC";
  if (clientType === "PERSON") return "ID_CARD";
  return null;
}

export interface ClientDuplicateCandidate {
  id: string;
  name: string;
  type: string;
  internalCode: string | null;
  deletedAt: Date | null;
}

export interface ClientDuplicateCheck {
  /** 同证件类型 + 规范化号码的现存客户（含软删——身份持续唯一） */
  idNumberDuplicate: ClientDuplicateCandidate | null;
  /** 同名未删除客户（仅提示疑似，不作为自动合并依据） */
  nameDuplicates: ClientDuplicateCandidate[];
}

/**
 * 查重查询条件构造（供 prisma 查询使用）。
 * v1.x P1 §三：等值匹配走盲索引列（idNumber 已存密文不可比较）；
 * 入参为规范化后的明文号码，内部转盲索引。
 */
export function duplicateWhereInput(input: {
  idType: ClientIdType;
  idNumber: string;
  excludeId?: string;
}) {
  return {
    idType: input.idType,
    idNumberBlind: blindIdNumber(input.idNumber),
    ...(input.excludeId ? { id: { not: input.excludeId } } : {})
  };
}

export function nameWhereInput(input: { name: string; excludeId?: string }) {
  return {
    name: input.name,
    deletedAt: null,
    ...(input.excludeId ? { id: { not: input.excludeId } } : {})
  };
}
