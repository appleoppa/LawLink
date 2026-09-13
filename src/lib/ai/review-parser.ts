/**
 * AI 文书审查返回内容的解析逻辑（纯函数，便于单测）
 * 实际调用走 src/server/ai/review-document.ts
 */
import { extractJson } from "./client";

export type ReviewType = "MISSING" | "RISK" | "ISSUE" | "SUGGESTION";
export type ReviewSeverity = "HIGH" | "MEDIUM" | "LOW";

export type ReviewItem = {
  type: ReviewType;
  severity: ReviewSeverity;
  title: string;
  detail: string;
};

const VALID_TYPES: ReadonlySet<ReviewType> = new Set([
  "MISSING",
  "RISK",
  "ISSUE",
  "SUGGESTION"
]);
const VALID_SEV: ReadonlySet<ReviewSeverity> = new Set(["HIGH", "MEDIUM", "LOW"]);
const SEV_ORDER: Record<ReviewSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * 把 AI 返回文本解析为规范化 ReviewItem 数组。
 * - JSON 解析失败抛错（调用方决定怎么处理）
 * - 非法 type/severity 回退为 ISSUE/MEDIUM
 * - title/detail 任一为空的条目丢弃
 * - 按 severity HIGH→LOW 排序
 */
export function parseReviewItems(content: string): ReviewItem[] {
  const parsed = extractJson<unknown>(content);
  if (!Array.isArray(parsed)) {
    throw new Error("AI 返回内容无法解析为审查清单");
  }
  const items: ReviewItem[] = [];
  for (const raw of parsed as Array<Record<string, unknown>>) {
    const type = typeof raw.type === "string" ? (raw.type.toUpperCase() as ReviewType) : "ISSUE";
    const severity =
      typeof raw.severity === "string"
        ? (raw.severity.toUpperCase() as ReviewSeverity)
        : "MEDIUM";
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const detail = typeof raw.detail === "string" ? raw.detail.trim() : "";
    if (!title || !detail) continue;
    items.push({
      type: VALID_TYPES.has(type) ? type : "ISSUE",
      severity: VALID_SEV.has(severity) ? severity : "MEDIUM",
      title,
      detail
    });
  }
  items.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return items;
}
