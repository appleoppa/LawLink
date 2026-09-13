import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "AES-256-GCM" as const;
const KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 12; // 96 bit recommended for GCM
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.STORAGE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("STORAGE_ENCRYPTION_KEY 未设置。在 .env 用 openssl rand -base64 32 生成");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `STORAGE_ENCRYPTION_KEY 长度错误：期望 32 字节（base64 编码后约 44 字符），实际 ${buf.length}`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * 加密一个 Buffer，返回 ciphertext / iv / authTag（均为 Buffer，调用者负责 base64）。
 */
export function encryptBuffer(plain: Buffer): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  algorithm: string;
} {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct, iv, authTag: tag, algorithm: ALGORITHM };
}

/**
 * 解密。iv / authTag 是 base64。
 */
export function decryptBuffer(
  ciphertext: Buffer,
  ivBase64: string,
  authTagBase64: string
): Buffer {
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
