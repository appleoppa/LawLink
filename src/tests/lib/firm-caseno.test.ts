import { describe, it, expect } from "vitest";
import { renderCaseNoTemplate } from "@/lib/matters/firm-caseno";

describe("renderCaseNoTemplate — 所内案号模板渲染", () => {
  const base = {
    year: 2026,
    firmShortName: "普",
    categoryAbbr: "民",
    categoryWord: "民诉",
    seq: 1
  };

  it("默认模板 {年}-{所}{类词}-{序3} → 2026-普民诉-001", () => {
    expect(renderCaseNoTemplate("{年}-{所}{类词}-{序3}", base)).toBe("2026-普民诉-001");
  });

  it("{年2} 取后两位、{序4} 补四位", () => {
    expect(renderCaseNoTemplate("{年2}{类}{序4}", { ...base, seq: 23 })).toBe("26民0023");
  });

  it("{类} 与 {类词} 互不污染（{类词} 先替换）", () => {
    expect(renderCaseNoTemplate("{类词}/{类}", base)).toBe("民诉/民");
  });

  it("所简称为空时该段留空", () => {
    expect(renderCaseNoTemplate("{年}-{所}{类词}-{序3}", { ...base, firmShortName: "" })).toBe(
      "2026-民诉-001"
    );
  });

  it("流水大于补位宽度时不截断", () => {
    expect(renderCaseNoTemplate("{序3}", { ...base, seq: 1234 })).toBe("1234");
  });
});
