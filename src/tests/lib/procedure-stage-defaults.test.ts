import { describe, expect, it } from "vitest";
import {
  defaultStageNamesForProcedure,
  optionalStagePresetsForProcedure,
  stagePresetForName
} from "@/lib/procedure-stage-defaults";

describe("defaultStageNamesForProcedure", () => {
  it("uses litigation workflow for first instance procedures", () => {
    expect(defaultStageNamesForProcedure("FIRST_INSTANCE")).toContain("起诉立案");
    expect(defaultStageNamesForProcedure("FIRST_INSTANCE")).toContain("裁判签收");
    expect(defaultStageNamesForProcedure("FIRST_INSTANCE")).toContain("案件归档");
    expect(defaultStageNamesForProcedure("FIRST_INSTANCE")).not.toContain("财产保全");
    expect(optionalStagePresetsForProcedure("FIRST_INSTANCE").map((preset) => preset.name)).not.toContain("履行/执行衔接");
  });

  it("keeps optional litigation stages outside the default active workflow", () => {
    const optionalNames = optionalStagePresetsForProcedure("FIRST_INSTANCE").map((preset) => preset.name);
    expect(optionalNames).toEqual(expect.arrayContaining(["财产保全", "管辖权异议", "司法鉴定", "模拟法庭", "庭后补充"]));
    expect(optionalNames.some((name) => name.includes("执行"))).toBe(false);
    expect(stagePresetForName("FIRST_INSTANCE", "案件归档")?.kind).toBe("required");
    expect(stagePresetForName("FIRST_INSTANCE", "司法鉴定")?.kind).toBe("optional");
  });

  it("uses required enforcement stages by default", () => {
    expect(defaultStageNamesForProcedure("ENFORCEMENT")).toEqual([
      "代理授权",
      "执行立案",
      "财产查控",
      "执行结案",
      "案件归档"
    ]);
  });

  it("uses criminal investigation workflow for investigation procedures", () => {
    expect(defaultStageNamesForProcedure("INVESTIGATION")).toEqual([
      "代理授权",
      "会见",
      "阅卷线索",
      "辩护意见",
      "案件归档"
    ]);
  });

  it("非诉、审查起诉、行政复议使用各自环节，不再套用诉讼环节", () => {
    expect(defaultStageNamesForProcedure("NON_LITIGATION_PHASE")).not.toContain("起诉立案");
    expect(defaultStageNamesForProcedure("NON_LITIGATION_PHASE")).toContain("成果交付");
    expect(defaultStageNamesForProcedure("PROSECUTION_REVIEW")).toContain("阅卷");
    expect(defaultStageNamesForProcedure("PROSECUTION_REVIEW")).not.toContain("开庭审理");
    expect(defaultStageNamesForProcedure("ADMIN_RECONSIDERATION")).toContain("复议决定");
  });
});
