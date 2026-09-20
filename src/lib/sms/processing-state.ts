/**
 * B1 来件处理状态推导（docs/SMS-B1-DESIGN-20260920.md §2.3）。
 * 纯规则：取件结果落库后统一计算状态机位置；不依赖数据库。
 */
import type { SmsProcessingState } from "@prisma/client";

export function deriveProcessingState(
  results: readonly { status: string }[],
  hasMatchedMatter: boolean
): SmsProcessingState {
  if (results.some(r => r.status === "LOGIN_REQUIRED")) return "NEEDS_MANUAL_FETCH";
  if (results.length === 0) return "READY_FOR_REVIEW";
  const anySuccess = results.some(r => r.status === "DOWNLOADED" || r.status === "ALREADY_DOWNLOADED");
  if (!anySuccess) return "PARTIAL";
  if (results.some(r => r.status === "FAILED")) return "PARTIAL";
  return hasMatchedMatter ? "READY_FOR_REVIEW" : "NEEDS_MATCH";
}
