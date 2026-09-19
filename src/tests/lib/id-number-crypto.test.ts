// @vitest-environment node
import { describe, it, expect } from "vitest";

// 32 字节主密钥的 base64（测试专用）
process.env.STORAGE_ENCRYPTION_KEY = process.env.STORAGE_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

import {
  encryptIdNumber, decryptIdNumber, blindIdNumber,
  sealIdNumber, isEncryptedIdNumber
} from "@/lib/clients/id-number-crypto";
import { duplicateWhereInput } from "@/lib/clients/identity";

const ID = "11010119900101123X";
const ID_NORM = "11010119900101123X";
const ID_LOWER_SPACE = " 11010119900101123x ";

describe("证件号加密与盲索引（P1 §三）", () => {
  it("加密-解密回环；密文形态可识别", () => {
    const enc = encryptIdNumber(ID);
    expect(enc).not.toContain(ID);
    expect(isEncryptedIdNumber(enc)).toBe(true);
    expect(decryptIdNumber(enc)).toBe(ID);
    expect(isEncryptedIdNumber(ID)).toBe(false);
  });

  it("盲索引稳定且与格式差异无关（规范化后同值同索引）", () => {
    expect(blindIdNumber(ID_NORM)).toBe(blindIdNumber(ID_NORM));
    expect(blindIdNumber(ID_NORM)).toHaveLength(64); // sha256 hex
    expect(blindIdNumber(ID_NORM)).not.toBe(ID_NORM); // 非平凡
  });

  it("sealIdNumber 空值返回 null 字段", () => {
    expect(sealIdNumber("")).toEqual({ idNumber: null, idNumberBlind: null });
    expect(sealIdNumber(null)).toEqual({ idNumber: null, idNumberBlind: null });
    const sealed = sealIdNumber(ID_LOWER_SPACE);
    expect(sealed.idNumberBlind).toBe(blindIdNumber(ID_NORM));
    expect(decryptIdNumber(sealed.idNumber)).toBe(ID_NORM);
  });

  it("密文损坏解密返回空串（不抛错）", () => {
    expect(decryptIdNumber("aGVsbG8.aGVsbG8.aGVsbG8")).toBe("");
  });

  it("查重条件落在盲索引列（明文列不可比较）", () => {
    const where = duplicateWhereInput({ idType: "ID_CARD", idNumber: ID_NORM, excludeId: "c1" });
    expect(where).toEqual({
      idType: "ID_CARD",
      idNumberBlind: blindIdNumber(ID_NORM),
      id: { not: "c1" }
    });
  });
});
