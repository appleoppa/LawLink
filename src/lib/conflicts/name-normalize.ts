/**
 * 冲突检索名称归一化与双向匹配（第六轮体检 P2-2，docs/SYSTEM-AUDIT-20260920-ROUND6-v2.md）。
 *
 * 背景：此前模糊匹配是单向 contains（历史名 ⊇ 查询名），且无任何归一——新收案录
 * 全称「广东嘉吉贸易有限公司」而历史案件当年录简称「嘉吉贸易」时，利冲 BLOCKING
 * 检不出来。漏检代价是执业违规，按「宁可降级提示交律师判断，不可静默漏检」设计：
 *
 * - 归一化只做保守变换：全角→半角、去空白、去括号段、去组织形式后缀、ASCII 小写；
 *   不做繁简转换（无词典会产生假等价）、不去裸前缀地域（「广州酒家」是品牌）。
 * - 前缀地域只用于生成 SQL 探针扩大候选面（多查无害），命中仍须归一双向比对确认。
 * - 归一命中（NORMALIZED_*）在算法层降一级严重度并标注「请人工核对」，由律师判断。
 */

/** 常见全角→半角（含标点、数字、字母区间） */
function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, " ");
}

/** 组织形式后缀（长在前，重复剥离；刻意不含「分公司/分店」——分支机构是独立主体） */
const ORG_SUFFIXES = ["股份有限公司", "有限责任公司", "有限公司", "合伙企业", "集团公司", "公司", "集团"];

/** 括号段一律剥离（半角化后）：地域标注（广州）、修饰（集团）等；中文商号极少依赖括号承载区别性信息 */
function stripParens(s: string): string {
  return s.replace(/[（(][^（）()]*[）)]/g, "");
}

/** 机构名称归一化：trim → 全角半角化 → 去括号段 → 去组织后缀 → 小写。自然人姓名同样安全（各步均为恒等）。 */
export function normalizeOrgName(raw: string): string {
  let s = toHalfWidth(raw).replace(/\s+/g, "");
  s = stripParens(s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ORG_SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }
  return s.toLowerCase();
}

/** 省/直辖市/常见地域前缀（仅用于探针生成，不用于等价判定） */
const REGION_PREFIXES = [
  "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽",
  "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西",
  "甘肃", "青海", "广西", "内蒙古", "西藏", "宁夏", "新疆", "香港", "澳门"
];

function stripLeadingRegion(core: string): string | null {
  for (const r of REGION_PREFIXES) {
    if (core.startsWith(r) && core.length - r.length >= 3) return core.slice(r.length);
  }
  return null;
}

/**
 * SQL contains 探针集合：原名、归一核、去地域前缀核。
 * 探针只是候选面（多查无害，命中另经归一双向比对确认）；沿用既有 ≥3 字门槛控制噪音。
 */
export function buildNameProbes(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const set = new Set<string>();
  if (trimmed.length >= 3) set.add(trimmed);
  const norm = normalizeOrgName(trimmed);
  if (norm.length >= 3) set.add(norm);
  const regionStripped = stripLeadingRegion(norm);
  if (regionStripped && regionStripped.length >= 3) set.add(regionStripped);
  return [...set];
}

export type NameMatchLevel =
  | { level: "EXACT"; ratio: 1 }
  | { level: "NORMALIZED_EQUAL"; ratio: 1 }
  | { level: "CONTAINS"; ratio: number }
  | { level: "NORMALIZED_CONTAINS"; ratio: number };

/** 双向匹配分级：EXACT（原文相同）＞ NORMALIZED_EQUAL（归一后相同）＞ CONTAINS（原文双向包含）＞ NORMALIZED_CONTAINS（归一后双向包含）；null＝不匹配 */
export function nameMatchLevel(query: string, stored: string): NameMatchLevel | null {
  const q = query.trim();
  const s = stored.trim();
  if (!q || !s) return null;
  if (q === s) return { level: "EXACT", ratio: 1 };
  const nq = normalizeOrgName(q);
  const ns = normalizeOrgName(s);
  if (!nq || !ns) return null;
  if (nq === ns) return { level: "NORMALIZED_EQUAL", ratio: 1 };
  const ratio = (a: string, b: string) => Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (q.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(q.toLowerCase())) {
    return { level: "CONTAINS", ratio: ratio(q.toLowerCase(), s.toLowerCase()) };
  }
  if (nq.includes(ns) || ns.includes(nq)) return { level: "NORMALIZED_CONTAINS", ratio: ratio(nq, ns) };
  return null;
}

export function isNormalizedMatch(m: NameMatchLevel | null | undefined): boolean {
  return m?.level === "NORMALIZED_EQUAL" || m?.level === "NORMALIZED_CONTAINS";
}
