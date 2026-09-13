// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  generateTotpSecret, totpAt, verifyTotp, otpauthUri,
  generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode
} from "@/lib/auth/totp";

// RFC 6238 附录 B 的 SHA-1 测试向量种子（base32 of "12345678901234567890"）
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP 核心（RFC 6238 / SHA-1）", () => {
  it("RFC 测试向量：T=59s → 94287082 的 6 位截断（287082）", () => {
    // counter = 1（59/30），RFC 向量 8 位码 94287082 → 6 位动态码 287082
    expect(totpAt(RFC_SECRET, 1)).toBe("287082");
  });

  it("verifyTotp 接受当前窗口码并拒绝错码", () => {
    const now = 1_700_000_000_000; // 对齐 30s 边界内
    const code = totpAt(RFC_SECRET, Math.floor(now / 30_000));
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "000000", now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abc12", now)).toBe(false);
  });

  it("±1 步长窗口容差生效，超窗拒绝", () => {
    const now = 1_700_000_000_000;
    const prev = totpAt(RFC_SECRET, Math.floor(now / 30_000) - 1);
    expect(verifyTotp(RFC_SECRET, prev, now)).toBe(true); // 上一窗有效
    const prev3 = totpAt(RFC_SECRET, Math.floor(now / 30_000) - 3);
    expect(verifyTotp(RFC_SECRET, prev3, now)).toBe(false); // 超窗拒绝
  });

  it("secret 生成为合法 base32（可解码回环校验通过）", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(verifyTotp(s, totpAt(s, Math.floor(Date.now() / 30_000)))).toBe(true);
  });

  it("otpauth URI 含 issuer/account/secret", () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: "a@b.c", issuer: "LawLink" });
    expect(uri.startsWith("otpauth://totp/LawLink%3Aa%40b.c?")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });
});

describe("恢复码", () => {
  it("8 枚、格式合法、哈希可核销一次", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(codes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(hashes).not.toContain(codes[0]); // 只存哈希
    const idx = matchRecoveryCode(hashes, codes[3]);
    expect(idx).toBe(3);
    expect(matchRecoveryCode(hashes, "dead-beef")).toBeNull();
  });

  it("哈希大小写/空白不敏感（用户输入容错）", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(matchRecoveryCode(hashes, ` ${codes[0].toUpperCase()} `)).toBe(0);
  });

  it("同码哈希稳定（无盐设计服务于等值核销）", () => {
    expect(hashRecoveryCode("aaaa-bbbb")).toBe(hashRecoveryCode("AAAA-BBBB"));
  });
});
