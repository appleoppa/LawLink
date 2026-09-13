import { describe, it, expect } from "vitest";
import { parseReviewItems } from "@/lib/ai/review-parser";

describe("parseReviewItems", () => {
  it("正常路径：4 条不同 type / severity 解析 + 按严重度排序", () => {
    const json = JSON.stringify([
      { type: "SUGGESTION", severity: "LOW", title: "措辞建议", detail: "可改用更规范术语" },
      { type: "MISSING", severity: "HIGH", title: "违约责任缺失", detail: "未约定违约金计算方式" },
      { type: "RISK", severity: "MEDIUM", title: "管辖约定模糊", detail: "未指定具体法院" },
      { type: "ISSUE", severity: "HIGH", title: "金额前后不符", detail: "正文 5 万但附件 5.5 万" }
    ]);
    const items = parseReviewItems(json);
    expect(items).toHaveLength(4);
    expect(items[0].severity).toBe("HIGH");
    expect(items[1].severity).toBe("HIGH");
    expect(items[2].severity).toBe("MEDIUM");
    expect(items[3].severity).toBe("LOW");
  });

  it("空数组合法", () => {
    expect(parseReviewItems("[]")).toEqual([]);
  });

  it("title/detail 缺失的条目丢弃", () => {
    const json = JSON.stringify([
      { type: "RISK", severity: "HIGH", title: "", detail: "x" },
      { type: "RISK", severity: "HIGH", title: "有效", detail: "" },
      { type: "RISK", severity: "HIGH", title: "保留", detail: "完整" }
    ]);
    const items = parseReviewItems(json);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("保留");
  });

  it("非法 type/severity 回退默认值", () => {
    const json = JSON.stringify([
      { type: "UNKNOWN_TYPE", severity: "CRIT", title: "T", detail: "D" }
    ]);
    const items = parseReviewItems(json);
    expect(items[0].type).toBe("ISSUE");
    expect(items[0].severity).toBe("MEDIUM");
  });

  it("大小写不规范也能识别", () => {
    const json = JSON.stringify([
      { type: "missing", severity: "high", title: "T", detail: "D" }
    ]);
    const items = parseReviewItems(json);
    expect(items[0].type).toBe("MISSING");
    expect(items[0].severity).toBe("HIGH");
  });

  it("JSON 被 markdown ``` 包裹也能抽取", () => {
    const wrapped = "好的，分析如下：\n```json\n[{\"type\":\"RISK\",\"severity\":\"HIGH\",\"title\":\"X\",\"detail\":\"Y\"}]\n```";
    const items = parseReviewItems(wrapped);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("X");
  });

  it("非数组（对象）抛错", () => {
    expect(() => parseReviewItems('{"items": []}')).toThrow(/无法解析/);
  });

  it("无 JSON 抛错", () => {
    expect(() => parseReviewItems("抱歉，无法处理")).toThrow(/无法解析/);
  });
});
