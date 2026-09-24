import { describe, it, expect } from "vitest";
import { partyInputSchema } from "@/server/matters/schemas";

const baseInputs = {
  role: "OPPOSING_PARTY" as const,
  ordinal: 1,
  name: "张三",
  phone: "",
  address: "",
  legalRep: "",
  contactName: "",
  enterpriseName: "",
  notes: ""
};

describe("partyInputSchema (v0.27)", () => {
  it("自然人必须填 idNumber", () => {
    const r = partyInputSchema.safeParse({
      ...baseInputs,
      partyType: "NATURAL_PERSON",
      idNumber: "",
      enterpriseSocialCode: ""
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issues = r.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("idNumber");
    }
  });

  it("自然人填了 idNumber 通过", () => {
    const r = partyInputSchema.safeParse({
      ...baseInputs,
      partyType: "NATURAL_PERSON",
      idNumber: "310101199001011234",
      enterpriseSocialCode: ""
    });
    expect(r.success).toBe(true);
  });

  it("公司必须填 enterpriseSocialCode", () => {
    const r = partyInputSchema.safeParse({
      ...baseInputs,
      name: "上海某某有限公司",
      partyType: "ORGANIZATION",
      idNumber: "",
      enterpriseSocialCode: ""
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issues = r.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("enterpriseSocialCode");
    }
  });

  it("公司填了 enterpriseSocialCode 即使没 idNumber 也通过", () => {
    const r = partyInputSchema.safeParse({
      ...baseInputs,
      name: "上海某某有限公司",
      partyType: "ORGANIZATION",
      idNumber: "",
      enterpriseSocialCode: "91310000XXXXXXXXXX"
    });
    expect(r.success).toBe(true);
  });

  it("默认 partyType 为 NATURAL_PERSON（不传时）", () => {
    const r = partyInputSchema.safeParse({
      ...baseInputs,
      idNumber: "310101199001011234",
      enterpriseSocialCode: ""
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.partyType).toBe("NATURAL_PERSON");
    }
  });
});
