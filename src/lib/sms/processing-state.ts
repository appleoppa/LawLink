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
  // 2026-09-20 P3 修复：全部链接访问失败时此前也标 PARTIAL（「部分完成」语义误导，
  // 用户以为有文件落袋）——全 FAILED 转「待人工取件」引导人工接续补传；
  // NO_FILE_FOUND / UNSUPPORTED_TYPE 等非失败非成功仍归 PARTIAL。
  if (!anySuccess) return results.every(r => r.status === "FAILED") ? "NEEDS_MANUAL_FETCH" : "PARTIAL";
  if (results.some(r => r.status === "FAILED")) return "PARTIAL";
  return hasMatchedMatter ? "READY_FOR_REVIEW" : "NEEDS_MATCH";
}
