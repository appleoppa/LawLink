/**
 * 自然人证件类型与号码校验（客户与当事人共用 ClientIdType；前后端同一套规则）。
 * 纯函数、无 node 依赖，可在客户端表单与服务端 zod 中共用。
 */
export const PERSON_ID_TYPES = ["ID_CARD", "HK_MACAO_MAINLAND_PERMIT", "TAIWAN_MAINLAND_PERMIT", "PASSPORT", "FOREIGN_PERMANENT_ID", "OTHER"] as const;
export type PersonIdType = (typeof PERSON_ID_TYPES)[number];

export const ALL_CLIENT_ID_TYPES = ["ID_CARD", "USCC", "PASSPORT", "OTHER", "HK_MACAO_MAINLAND_PERMIT", "TAIWAN_MAINLAND_PERMIT", "FOREIGN_PERMANENT_ID"] as const;
export type ClientIdTypeValue = (typeof ALL_CLIENT_ID_TYPES)[number];

export const clientIdTypeLabel: Record<ClientIdTypeValue, string> = {
  ID_CARD: "居民身份证",
  HK_MACAO_MAINLAND_PERMIT: "港澳居民来往内地通行证",
  TAIWAN_MAINLAND_PERMIT: "台湾居民来往大陆通行证",
  PASSPORT: "护照",
  FOREIGN_PERMANENT_ID: "外国人永久居留身份证",
  OTHER: "其他证件",
  USCC: "统一社会信用代码"
};

/** 证件号输入过滤：身份证只保留数字与 X（自动大写、限 18 位）；其他证件去空格并大写 */
export function sanitizePersonIdInput(type: string | null | undefined, raw: string): string {
  const v = raw.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
  if (!type || type === "ID_CARD") return v.replace(/[^0-9X]/g, "").slice(0, 18);
  return v.slice(0, 30);
}

/**
 * 校验证件号：返回错误文案，合法返回 null。
 * - 身份证：只允许数字与末位 X，且必须 18 位（位数不对不能通过）
 * - 其他证件：字母、数字与连字符，5–30 位
 * 空值不在此处判断（是否必填由调用方决定）。
 */
export function personIdError(type: string | null | undefined, value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!v) return null;
  if (!type || type === "ID_CARD") {
    if (!/^[0-9X]+$/.test(v)) return "身份证号码只能输入数字或 X";
    if (v.length !== 18) return `身份证号码应为 18 位，当前 ${v.length} 位`;
    if (v.slice(0, 17).includes("X")) return "身份证号码中 X 只能出现在最后一位";
    return null;
  }
  if (type === "USCC") {
    if (!/^[0-9A-Z]{18}$/.test(v)) return `统一社会信用代码应为 18 位数字或大写字母，当前 ${v.length} 位`;
    return null;
  }
  if (!/^[0-9A-Z-]{5,30}$/.test(v)) return "证件号码应为 5–30 位字母、数字或连字符";
  return null;
}
