import type { ConflictSeverity, PartyRole } from "@prisma/client";

export type IntakeReviewField = { label: string; value: string };
export type IntakeReviewSection = { title: string; note?: string; fields: IntakeReviewField[] };
export const conflictPartyRoleLabel: Record<PartyRole, string> = {
  CLIENT_PARTY: "委托方", OPPOSING_PARTY: "对方", THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人", AGENT: "代理人", WITNESS: "证人", OTHER: "其他"
};
export const conflictSeverityLabel: Record<ConflictSeverity, string> = {
  BLOCKING: "阻塞提示", HIGH: "高风险提示", MEDIUM: "中风险提示", LOW: "低风险提示"
};
export const conflictMatchedFieldLabel: Record<string, string> = {
  name: "姓名 / 名称", idNumber: "身份证号 / 信用代码", enterpriseSocialCode: "统一社会信用代码"
};

export const conflictMatchKinds = [
  { key: "exact", label: "名称相同" },
  { key: "similar", label: "名称相似" },
  { key: "identity", label: "证件一致" },
  { key: "other", label: "其他历史匹配" }
] as const;

export function conflictMatchKind(hit: { matchedField: string; matchedName: string; matchedValue: string; matchedRatio: number | null }) {
  if (["idNumber", "enterpriseSocialCode"].includes(hit.matchedField)) return "identity";
  if (hit.matchedField !== "name" || !hit.matchedName || !hit.matchedValue) return "other";
  return hit.matchedName === hit.matchedValue && (hit.matchedRatio === null || hit.matchedRatio === 1) ? "exact" : "similar";
}

export type ConflictReviewQuery = { role: string; name: string; idNumber: string };
/**
 * 由收案资料生成冲突检索条件。
 * 客户档案证件号入库为密文：服务端调用须传 decodeClientId（decryptIdNumber），
 * 否则检索条件会带上密文，证件匹配失效且与已检索条件比对不一致。收案表单内为明文，可不传。
 */
export function buildIntakeConflictQueries(intake: {
  client: { name: string; idNumber: string | null } | null;
  parties: { role: PartyRole; name: string; idNumber: string | null; enterpriseSocialCode?: string | null }[];
}, decodeClientId: (stored: string | null) => string = (v) => v ?? "") {
  const queries = [
    ...(intake.client ? [{ role: "CLIENT_PARTY" as const, name: intake.client.name, idNumber: decodeClientId(intake.client.idNumber) }] : []),
    ...intake.parties.map(p => ({ role: p.role, name: p.name, idNumber: p.idNumber || p.enterpriseSocialCode || "" }))
  ].map(q => ({ ...q, name: q.name.trim(), idNumber: q.idNumber.trim() })).filter(q => q.name || q.idNumber);
  const unique = new Map(queries.map(q => [JSON.stringify([q.role, q.name, q.idNumber]), q]));
  // 带证件的查询也检索名称，无须为相同身份和名称再发送一次空证件查询。
  return [...unique.values()].filter(q => q.idNumber || !queries.some(other => other.role === q.role && other.name === q.name && other.idNumber));
}
// 历史 JSON 只提取已知字段，不将未知内容或内部关联 ID 发给浏览器。
export function readConflictPayload(payload: unknown) {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const string = (value: unknown) => typeof value === "string" ? value : "";
  const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
  const p = object(payload);
  return {
    queries: rows(p.queries).map(q => ({ role: string(q.role), name: string(q.name), idNumber: string(q.idNumber) })),
    sameNameClients: rows(p.sameNameClients).map(c => ({ name: string(c.name) })),
    idMatchedClients: rows(p.idMatchedClients).map(c => ({ name: string(c.name), idNumber: string(c.idNumber) }))
  };
}
export function conflictQueryCoverage(expected: ConflictReviewQuery[], checked: ConflictReviewQuery[]) {
  const key = (q: ConflictReviewQuery) => JSON.stringify([q.role, q.name.trim(), q.idNumber.trim()]);
  const actual = new Set(checked.map(key));
  return expected.length > 0 && expected.every(q => actual.has(key(q)));
}
