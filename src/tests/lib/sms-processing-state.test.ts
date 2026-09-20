// @vitest-environment node
// B1 来件处理状态机（docs/SMS-B1-DESIGN-20260920.md §2.3）纯规则回归。
import { describe, expect, it } from "vitest";
import { deriveProcessingState } from "@/lib/sms/processing-state";

const r = (status: string) => ({ status });

describe("deriveProcessingState（B1 状态机）", () => {
  it("无链接无结果的来件直接待处理", () => {
    expect(deriveProcessingState([], false)).toBe("READY_FOR_REVIEW");
    expect(deriveProcessingState([], true)).toBe("READY_FOR_REVIEW");
  });

  it("登录/验证码平台 → 待人工取件（优先级最高，即使有部分成功）", () => {
    expect(deriveProcessingState([r("LOGIN_REQUIRED")], false)).toBe("NEEDS_MANUAL_FETCH");
    expect(deriveProcessingState([r("DOWNLOADED"), r("LOGIN_REQUIRED")], true)).toBe("NEEDS_MANUAL_FETCH");
  });

  it("全部失败 → 部分完成（可重试，不静默丢）", () => {
    expect(deriveProcessingState([r("FAILED"), r("FAILED")], true)).toBe("PARTIAL");
  });

  it("部分成功部分失败 → 部分完成", () => {
    expect(deriveProcessingState([r("DOWNLOADED"), r("FAILED")], true)).toBe("PARTIAL");
  });

  it("全部成功：已匹配案件 → 待处理；未匹配 → 待匹配（先取件后匹配）", () => {
    expect(deriveProcessingState([r("DOWNLOADED"), r("ALREADY_DOWNLOADED")], true)).toBe("READY_FOR_REVIEW");
    expect(deriveProcessingState([r("DOWNLOADED")], false)).toBe("NEEDS_MATCH");
  });

  it("NO_FILE_FOUND / UNSUPPORTED_TYPE 不算成功也不算登录墙——全为此类时归部分完成", () => {
    expect(deriveProcessingState([r("NO_FILE_FOUND"), r("UNSUPPORTED_TYPE")], true)).toBe("PARTIAL");
  });
});
