import { describe, expect, it } from "vitest";
import {
  identityDocumentInputSchema,
  identityPageKindsFor,
  normalizeIdentityDocumentNumber,
  readAndValidateIdentityImage
} from "@/lib/identity-documents";

const residentId = "11010519491231002X";

describe("身份证件规则", () => {
  it("严格校验居民身份证并规范化末位字母", () => {
    const result = identityDocumentInputSchema.parse({
      identityDocumentType: "PRC_RESIDENT_ID",
      identityDocumentName: "",
      identityDocumentNumber: ` ${residentId.toLowerCase()} `
    });
    expect(result.identityDocumentNumber).toBe(residentId);
  });

  it.each([
    ["PRC_HK_MACAO_TRAVEL_PERMIT", "E12345678"],
    ["HK_MACAO_MAINLAND_TRAVEL_PERMIT", "H1234567890"],
    ["TAIWAN_MAINLAND_TRAVEL_PERMIT", "12345678"],
    ["PASSPORT", "P1234567"],
    ["FOREIGN_PERMANENT_RESIDENT_ID", "F1234567890"]
  ] as const)("支持 %s", (identityDocumentType, identityDocumentNumber) => {
    expect(identityDocumentInputSchema.safeParse({ identityDocumentType, identityDocumentName: "", identityDocumentNumber }).success).toBe(true);
  });

  it("其他证件必须填写名称", () => {
    expect(identityDocumentInputSchema.safeParse({ identityDocumentType: "OTHER", identityDocumentName: "", identityDocumentNumber: "AB-12345" }).success).toBe(false);
    expect(identityDocumentInputSchema.safeParse({ identityDocumentType: "OTHER", identityDocumentName: "外交人员证", identityDocumentNumber: "AB-12345" }).success).toBe(true);
  });

  it("按证件形态分配照片页别", () => {
    expect(identityPageKindsFor("PRC_RESIDENT_ID")).toEqual(["PORTRAIT_SIDE", "EMBLEM_SIDE"]);
    expect(identityPageKindsFor("PASSPORT")).toEqual(["DATA_PAGE", "SUPPLEMENTARY_PAGE"]);
  });

  it("号码规范化不混入联系方式变化", () => {
    expect(normalizeIdentityDocumentNumber(" e 123 45678 ")).toBe("E12345678");
  });
});

describe("证件图片校验", () => {
  it("同时核对文件内容、MIME和扩展名", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])], "证件.jpg", { type: "image/jpeg" });
    await expect(readAndValidateIdentityImage(jpeg)).resolves.toMatchObject({ mimeType: "image/jpeg" });
    const disguised = new File(["not an image"], "证件.jpg", { type: "image/jpeg" });
    await expect(readAndValidateIdentityImage(disguised)).rejects.toThrow("仅支持");
  });
});
