/**
 * v0.42 批F（项6）案件批量导入 —— 纯逻辑（无 DB / 无 exceljs 依赖，便于单测）。
 * 列定义、文本→枚举映射、标题生成、首程序推断、单行结构校验都在这里；
 * 律师邮箱 / 案由的 DB 查找放在 server/imports/actions.ts。
 */
import type { MatterCategory, MatterStatus, ClientType, PartyType, ProcedureType } from "@prisma/client";

import { matterCategoryLabel, matterStatusLabel } from "@/lib/enums";

/** 导入列定义（key = 内部字段，header = Excel 表头） */
export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  hint?: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "clientName", header: "客户名称", required: true },
  { key: "clientIdNumber", header: "客户证件号", required: true, hint: "身份证 / 统一社会信用代码" },
  { key: "clientType", header: "客户类型", required: false, hint: "个人 / 企业，默认个人" },
  { key: "opposingName", header: "相对方名称", required: true },
  { key: "opposingIdNumber", header: "相对方证件号", required: true },
  { key: "opposingType", header: "相对方类型", required: false, hint: "个人 / 企业，默认个人" },
  { key: "category", header: "案件类型", required: true, hint: Object.values(matterCategoryLabel).join(" / ") },
  { key: "status", header: "案件状态", required: true, hint: "办理中 / 已结案 / 已归档" },
  { key: "ownerEmail", header: "主办律师邮箱", required: false, hint: "按邮箱精确匹配；留空则归当前导入人" },
  { key: "intakeDate", header: "收案日期", required: false, hint: "YYYY-MM-DD" },
  { key: "cause", header: "案由", required: false, hint: "匹配案由库；未匹配则作为自由文本" },
  { key: "claimAmount", header: "标的额", required: false, hint: "数字，单位元" },
  { key: "clientPhone", header: "联系电话", required: false },
  { key: "jurisdiction", header: "所属管辖地", required: false }
];

export type RawRow = Record<string, string>;

export interface NormalizedRow {
  clientName: string;
  clientIdNumber: string;
  clientType: ClientType;
  clientPhone: string | null;
  opposingName: string;
  opposingIdNumber: string;
  opposingPartyType: PartyType;
  clientPartyType: PartyType;
  category: MatterCategory;
  status: MatterStatus;
  ownerEmail: string | null;
  intakeDate: Date | null;
  causeText: string | null;
  claimAmount: number | null;
  jurisdiction: string | null;
}

/** 文本反查案件类型（按 matterCategoryLabel） */
export function parseCategoryLabel(text: string): MatterCategory | null {
  const t = text.trim();
  for (const [key, label] of Object.entries(matterCategoryLabel)) {
    if (label === t) return key as MatterCategory;
  }
  return null;
}

/** 文本反查案件状态（兼容「结案」=「已结案」） */
export function parseStatusLabel(text: string): MatterStatus | null {
  const t = text.trim();
  if (t === "结案") return "CLOSED";
  for (const [key, label] of Object.entries(matterStatusLabel)) {
    if (label === t) return key as MatterStatus;
  }
  return null;
}

/** 个人 / 企业 → ClientType（默认个人） */
export function parseClientType(text: string | undefined): ClientType {
  const t = (text ?? "").trim();
  if (t === "企业" || t === "公司" || t === "单位") return "COMPANY";
  return "INDIVIDUAL";
}

/** 个人 / 企业 → PartyType（默认自然人） */
export function parsePartyType(text: string | undefined): PartyType {
  const t = (text ?? "").trim();
  if (t === "企业" || t === "公司" || t === "单位") return "COMPANY";
  return "NATURAL_PERSON";
}

/** 收案日期解析：接受 YYYY-MM-DD / YYYY/MM/DD（已由调用方把 Excel 日期格式化为字符串） */
export function parseImportDate(text: string | undefined): Date | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** 标的额解析：去掉逗号/￥/元，转数字 */
export function parseAmount(text: string | undefined): number | null {
  const t = (text ?? "").trim().replace(/[,¥￥\s元]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 案件标题：`客户 与 相对方 案由`（无重复空格） */
export function buildMatterTitle(clientName: string, opposingName: string, cause: string | null): string {
  const base = `${clientName.trim()} 与 ${opposingName.trim()}`;
  const c = (cause ?? "").trim();
  return c ? `${base} ${c}` : base;
}

/** 首程序类型：与收案转化（convertIntakeToMatter）一致的推断 */
export function firstProcedureTypeFor(category: MatterCategory): ProcedureType {
  return category === "CIVIL_COMMERCIAL" ||
    category === "CRIMINAL" ||
    category === "ADMINISTRATIVE"
    ? ("FIRST_INSTANCE" as ProcedureType)
    : ("NON_LITIGATION_PHASE" as ProcedureType);
}

export interface RowValidation {
  errors: string[];
  normalized: NormalizedRow | null;
}

/** 单行结构校验 + 枚举/数值/日期归一化（不含 DB 查找） */
export function validateRow(raw: RawRow): RowValidation {
  const errors: string[] = [];
  const get = (k: string) => (raw[k] ?? "").trim();

  const clientName = get("clientName");
  const clientIdNumber = get("clientIdNumber");
  const opposingName = get("opposingName");
  const opposingIdNumber = get("opposingIdNumber");
  if (!clientName) errors.push("缺少客户名称");
  if (!clientIdNumber) errors.push("缺少客户证件号");
  if (!opposingName) errors.push("缺少相对方名称");
  if (!opposingIdNumber) errors.push("缺少相对方证件号");

  const categoryText = get("category");
  const category = parseCategoryLabel(categoryText);
  if (!categoryText) errors.push("缺少案件类型");
  else if (!category) errors.push(`案件类型「${categoryText}」无法识别`);

  const statusText = get("status");
  const status = parseStatusLabel(statusText);
  if (!statusText) errors.push("缺少案件状态");
  else if (!status) errors.push(`案件状态「${statusText}」无法识别（办理中/已结案/已归档）`);

  const intakeText = get("intakeDate");
  let intakeDate: Date | null = null;
  if (intakeText) {
    intakeDate = parseImportDate(intakeText);
    if (!intakeDate) errors.push(`收案日期「${intakeText}」格式应为 YYYY-MM-DD`);
  }

  const amountText = get("claimAmount");
  let claimAmount: number | null = null;
  if (amountText) {
    claimAmount = parseAmount(amountText);
    if (claimAmount === null) errors.push(`标的额「${amountText}」不是有效数字`);
  }

  if (errors.length > 0 || !category || !status) {
    return { errors, normalized: null };
  }

  const ownerEmail = get("ownerEmail") || null;
  const causeText = get("cause") || null;
  const jurisdiction = get("jurisdiction") || null;
  const clientPhone = get("clientPhone") || null;

  return {
    errors,
    normalized: {
      clientName,
      clientIdNumber,
      clientType: parseClientType(get("clientType")),
      clientPhone,
      opposingName,
      opposingIdNumber,
      opposingPartyType: parsePartyType(get("opposingType")),
      clientPartyType: parsePartyType(get("clientType")),
      category,
      status,
      ownerEmail,
      intakeDate,
      causeText,
      claimAmount,
      jurisdiction
    }
  };
}
