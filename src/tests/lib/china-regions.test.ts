import { describe, expect, it } from "vitest";
import {
  agencyOptions,
  agencyOptionsForProcedure,
  isAgencyAllowedForProcedure,
  isNationalAgency,
  normalizeJurisdictionForAgency
} from "@/lib/china-regions";

describe("agencyOptions", () => {
  it("未选管辖地时仍提供最高人民法院", () => {
    expect(agencyOptions()).toEqual(["最高人民法院"]);
  });

  it("选到区县时包含最高人民法院且保留地方机构", () => {
    const options = agencyOptions("浙江省/杭州市/西湖区");

    expect(options).toContain("西湖区人民法院");
    expect(options).toContain("杭州市中级人民法院");
    expect(options).toContain("浙江省高级人民法院");
    expect(options).toContain("最高人民法院");
    expect(options).toContain("杭州仲裁委员会");
  });

  it("商事仲裁程序只提供仲裁机构，后续执行程序仍可选择法院", () => {
    const arbitrationOptions = agencyOptionsForProcedure(
      "浙江省/杭州市/西湖区",
      "COMMERCIAL_ARBITRATION"
    );
    expect(arbitrationOptions).toEqual(["杭州仲裁委员会"]);
    expect(isAgencyAllowedForProcedure("西湖区人民法院", "COMMERCIAL_ARBITRATION")).toBe(false);
    expect(isAgencyAllowedForProcedure("杭州仲裁委员会", "COMMERCIAL_ARBITRATION")).toBe(true);

    const enforcementOptions = agencyOptionsForProcedure("浙江省/杭州市/西湖区", "ENFORCEMENT");
    expect(enforcementOptions).toContain("西湖区人民法院");
    expect(enforcementOptions).toContain("杭州仲裁委员会");
  });
});

describe("national agency helpers", () => {
  it("识别最高人民法院", () => {
    expect(isNationalAgency("最高人民法院")).toBe(true);
    expect(isNationalAgency(" 最高人民法院 ")).toBe(true);
    expect(isNationalAgency("浙江省高级人民法院")).toBe(false);
  });

  it("最高人民法院不保留地方管辖地", () => {
    expect(normalizeJurisdictionForAgency("最高人民法院", "浙江省/杭州市/西湖区")).toBeNull();
    expect(normalizeJurisdictionForAgency("浙江省高级人民法院", "浙江省/杭州市")).toBe("浙江省/杭州市");
  });
});
