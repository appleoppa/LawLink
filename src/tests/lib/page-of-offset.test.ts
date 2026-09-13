// @vitest-environment node
import { describe, it, expect } from "vitest";
import { pageOfOffset } from "@/lib/documents/text-extraction";

describe("文本层页码定位（P0-2 版本链批）", () => {
  const text = "第一页内容\f第二页内容\f第三页内容";

  it("\\f 分页：偏移换算 1 起页码", () => {
    expect(pageOfOffset(text, 0)).toBe(1);           // 第一页开头
    expect(pageOfOffset(text, text.indexOf("第二页"))).toBe(2);
    expect(pageOfOffset(text, text.indexOf("第三页"))).toBe(3);
  });

  it("无分页符时恒为第 1 页；越界偏移安全", () => {
    expect(pageOfOffset("整段文本无分页", 5)).toBe(1);
    expect(pageOfOffset(text, 9999)).toBe(3);
  });

  it("命中点正好在分页符上归下一页前（页首命中算所在页）", () => {
    const atF = text.indexOf("\f", 1) + 1; // 第二页首字符
    expect(pageOfOffset(text, atF)).toBe(2);
  });
});
