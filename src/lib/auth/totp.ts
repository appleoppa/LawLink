/**
 * TOTP 双步验证核心（RFC 6238，SHA-1，30s 步长，6 位码，±1 窗口容差）。
 * node:crypto 自实现，无新依赖。secret 为 base32；恢复码 8 位分组明文哈希（sha256）比对。
 */
import { createHmac, randomBytes, createHash } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 生成 20 字节（160 位）随机 secret 的 base32 编码 */
export function generateTotpSecret(): string {
  const buf = randomBytes(20);
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 指定计数器的 6 位动态码（纯函数，供测试） */
export function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** 校验动态码（当前步长 ±1 窗口）。比对为恒时语义（聚合后一次比较）。 */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  return verifyTotpCounter(secret, code, nowMs) !== null;
}

/** 校验动态码并返回命中的计数器（供重放防护记录「最近已用」），未命中返回 null */
export function verifyTotpCounter(secret: string, code: string, nowMs = Date.now()): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = Math.floor(nowMs / 30_000);
  let matched: number | null = null;
  for (const drift of [-1, 0, 1]) {
    if (totpAt(secret, step + drift) === normalized) matched = step + drift;
  }
  return matched;
}

/** otpauth:// 绑定 URI（扫码/手输用） */
export function otpauthUri(params: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const q = new URLSearchParams({ secret: params.secret, issuer: params.issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** 生成 8 枚恢复码（形如 3f9a-2b7c）；返回明文列表，哈希入库 */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const hex = randomBytes(4).toString("hex");
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

/** 核销一枚恢复码：命中返回其下标（调用方从库中移除），未命中返回 null */
export function matchRecoveryCode(hashes: string[], code: string): number | null {
  const h = hashRecoveryCode(code);
  const idx = hashes.indexOf(h);
  return idx >= 0 ? idx : null;
}
