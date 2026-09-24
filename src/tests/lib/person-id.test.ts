import { describe, expect, it } from "vitest";
import { personIdError, sanitizePersonIdInput } from "@/lib/clients/person-id";

describe("自然人证件号校验", () => {
  it("身份证输入只保留数字与 X，自动大写并限 18 位", () => {
    expect(sanitizePersonIdInput("ID_CARD", "3101 0119a9001x0123")).toBe("310101199001X0123");
    expect(sanitizePersonIdInput(undefined, "1".repeat(25))).toHaveLength(18);
  });
  it("身份证位数不对或 X 不在末位不能通过", () => {
    expect(personIdError("ID_CARD", "31010119900101")).toMatch("应为 18 位，当前 14 位");
    expect(personIdError("ID_CARD", "3101011990X1011234")).toMatch("最后一位");
    expect(personIdError("ID_CARD", "31010119900101123X")).toBeNull();
    expect(personIdError(null, "310101199001011234")).toBeNull();
  });
  it("护照等其他证件不按身份证规则校验", () => {
    expect(sanitizePersonIdInput("PASSPORT", "e 1234 5678")).toBe("E12345678");
    expect(personIdError("PASSPORT", "E12345678")).toBeNull();
    expect(personIdError("HK_MACAO_MAINLAND_PERMIT", "H1")).not.toBeNull();
  });
});
