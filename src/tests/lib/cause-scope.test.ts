import { describe, expect, it } from "vitest";
import {
  causeScopeForSelection,
  isCauseAllowedForSelection
} from "@/lib/cause-scope";

describe("causeScopeForSelection", () => {
  it("商事仲裁类别共用民商事案由库并限制财产权益类案由", () => {
    const scope = causeScopeForSelection("COMMERCIAL_ARBITRATION");
    expect(scope.dbCategory).toBe("CIVIL_COMMERCIAL");
    expect(scope.includeCodePrefixes).toContain("CC-4");
    expect(scope.includeCodePrefixes).toContain("CC-9");
    expect(scope.excludeCodePrefixes).toContain("CC-9-27");
  });

  it("民商事类别下选择商事仲裁程序时也启用同一限制", () => {
    const scope = causeScopeForSelection("CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION");
    expect(scope.dbCategory).toBe("CIVIL_COMMERCIAL");
    expect(scope.includeCodePrefixes).toContain("CC-4");
  });

  it("劳动仲裁只使用劳动争议案由段", () => {
    const scope = causeScopeForSelection("LABOR_ARBITRATION");
    expect(scope.dbCategory).toBe("CIVIL_COMMERCIAL");
    expect(scope.includeCodePrefixes).toEqual(["CC-7"]);
  });
});

describe("isCauseAllowedForSelection", () => {
  it("允许商事仲裁选择合同类案由", () => {
    expect(
      isCauseAllowedForSelection(
        { category: "CIVIL_COMMERCIAL", code: "CC-4-10-108-3", active: true },
        "COMMERCIAL_ARBITRATION"
      )
    ).toBe(true);
  });

  it("拒绝商事仲裁选择婚姻继承、劳动、破产和人身损害类案由", () => {
    const rejectedCodes = [
      "CC-2-2-14",
      "CC-7-19-205",
      "CC-9-27-333",
      "CC-8-22-224"
    ];
    for (const code of rejectedCodes) {
      expect(
        isCauseAllowedForSelection(
          { category: "CIVIL_COMMERCIAL", code, active: true },
          "COMMERCIAL_ARBITRATION"
        )
      ).toBe(false);
    }
  });

  it("非商事仲裁的民商事案件仍可选择普通民事案由", () => {
    expect(
      isCauseAllowedForSelection(
        { category: "CIVIL_COMMERCIAL", code: "CC-2-2-14", active: true },
        "CIVIL_COMMERCIAL"
      )
    ).toBe(true);
  });
});
