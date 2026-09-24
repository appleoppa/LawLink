import { createHmac, randomUUID } from "node:crypto";
import { getStorageEncryptionKey } from "@/lib/storage/crypto";

/**
 * 桌面连接器 checkout 令牌（DESKTOP-CONNECTOR-PLAN §二）。
 *
 * 无状态 HMAC 签发：负载 { docId, userId, baselineVersion, fileName, jti, exp }，
 * 域分隔密钥与证件盲索引同源不同域（lawlink:desktop-checkout:v1）。
 * 约束（方案已声明）：TTL 15 分钟；一次性靠短 TTL + 审计近似（无服务端
 * 状态表，不做严格单次）；验证时复核账号仍有效。回传时令牌随
 * uploadNewVersion 的 expectedVersion/baseline 一起构成冲突拦截。
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const DOMAIN = "lawlink:desktop-checkout:v1";

let cachedKey: Buffer | null = null;
function checkoutKey(): Buffer {
  if (!cachedKey) {
    cachedKey = createHmac("sha256", getStorageEncryptionKey()).update(DOMAIN).digest();
  }
  return cachedKey;
}

export type CheckoutPayload = {
  docId: string;
  userId: string;
  baselineVersion: number;
  fileName: string;
  jti: string;
  exp: number;
};

export function issueCheckoutToken(input: {
  docId: string;
  userId: string;
  baselineVersion: number;
  fileName: string;
}): { token: string; payload: CheckoutPayload } {
  const payload: CheckoutPayload = {
    ...input,
    jti: randomUUID(),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", checkoutKey()).update(body).digest("base64url");
  return { token: `${body}.${sig}`, payload };
}

export function verifyCheckoutToken(token: string): CheckoutPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", checkoutKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !a.equals(b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as CheckoutPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!payload.docId || !payload.userId || typeof payload.baselineVersion !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}
