import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { decimalToNumber, nullableDecimalToNumber, serializeDecimals } from "@/lib/decimal";

describe("decimal helpers", () => {
  it("converts Prisma Decimal to a plain number", () => {
    expect(decimalToNumber(new Prisma.Decimal("1280000.50"))).toBe(1280000.5);
  });

  it("keeps number values usable and normalizes empty values to null", () => {
    expect(decimalToNumber(5200000)).toBe(5200000);
    expect(nullableDecimalToNumber(null)).toBeNull();
    expect(nullableDecimalToNumber(undefined)).toBeNull();
  });
});

describe("serializeDecimals", () => {
  it("converts nested Decimal fields anywhere in the payload", () => {
    const payload = {
      claimAmount: new Prisma.Decimal("8600000.00"),
      targets: [
        {
          name: "被保全人",
          properties: [
            { amount: new Prisma.Decimal("1200000.55"), detail: null },
            { amount: null, detail: "无金额" }
          ]
        }
      ]
    };
    const out = serializeDecimals(payload);
    expect(out.claimAmount).toBe(8600000);
    expect(out.targets[0].properties[0].amount).toBe(1200000.55);
    expect(out.targets[0].properties[1].amount).toBeNull();
  });

  it("preserves Date instances, primitives, and arrays", () => {
    const date = new Date("2026-07-04T00:00:00Z");
    const out = serializeDecimals({
      when: date,
      tags: ["a", "b"],
      count: 3,
      flag: true,
      nothing: null
    });
    expect(out.when).toBe(date);
    expect(out.tags).toEqual(["a", "b"]);
    expect(out.count).toBe(3);
    expect(out.flag).toBe(true);
    expect(out.nothing).toBeNull();
  });

  it("leaves plain JSON objects intact (no false Decimal detection)", () => {
    const json = { s: "string-not-sign", nested: { e: 1 } };
    const out = serializeDecimals(json);
    expect(out).toEqual(json);
  });
});
