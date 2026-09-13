/**
 * 客户证件号加密与盲索引（P1 §三）。
 *
 * 存储形态：Client.idNumber 存 AES-256-GCM 密文（iv.tag.ct，base64 三段），
 * 与附件共用 STORAGE_ENCRYPTION_KEY；等值检索走 idNumberBlind——
 * HMAC-SHA256，密钥由主密钥域分离派生（"client-id-blind" 域，不新增环境变量；
 * 轮换流程：换派生域盐重算全量盲索引，见 OPERATIONS.md）。
 * 模糊 LIKE 检索退役：盲索引只支持等值（§三检索策略）。
 */
import { createHmac } from "node:crypto";
import { encryptBuffer, decryptBuffer } from "@/lib/storage/crypto";
import { normalizeIdNumber } from "@/lib/clients/identity";

/** 盲索引域密钥：从附件主密钥经域分离派生（缓存；部署环境变量不变时稳定） */
let cachedBlindKey: Buffer | null = null;
function blindKey(): Buffer {
  if (!cachedBlindKey) {
    // 复用 encryptBuffer 使用的密钥派生路径：以加密一个固定域标记取其 iv? 不行——
    // 直接从环境读取主密钥（与 storage/crypto 相同来源），HMAC 域分离。
    const master = process.env.STORAGE_ENCRYPTION_KEY;
    if (!master) throw new Error("STORAGE_ENCRYPTION_KEY 未配置：证件号加密与盲索引不可用");
    cachedBlindKey = createHmac("sha256", master).update("lawlink:client-id-blind:v1").digest();
  }
  return cachedBlindKey;
}

/** 等值盲索引（输入先规范化；同一号码任意格式差异归一到同一索引值） */
export function blindIdNumber(normalized: string): string {
  return createHmac("sha256", blindKey()).update(normalized).digest("hex");
}

/** 密文形态识别：iv.tag.ct 三段 base64 */
export function isEncryptedIdNumber(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(v);
}

/** 加密明文证件号 → iv.tag.ct */
export function encryptIdNumber(plain: string): string {
  const enc = encryptBuffer(Buffer.from(plain, "utf8"));
  return [enc.iv.toString("base64"), enc.authTag.toString("base64"), enc.ciphertext.toString("base64")].join(".");
}

/** 解密（密文损坏/未加密原文时返回原文本身——回填前的过渡兼容读） */
export function decryptIdNumber(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isEncryptedIdNumber(stored)) return stored; // 尚未回填的明文（迁移期）
  const [iv, tag, ct] = stored.split(".");
  try {
    return decryptBuffer(Buffer.from(ct, "base64"), iv, tag).toString("utf8");
  } catch {
    return "";
  }
}

/** 展示打码：18 位身份证保前 3 后 2；信用代码（18 位）保前 3 后 4；其余保首尾各 2 */
export function maskIdNumber(stored: string | null | undefined): string {
  const plain = decryptIdNumber(stored);
  if (!plain) return "";
  if (plain.length === 18 && /^\d{17}[\dXx]$/.test(plain)) return `${plain.slice(0, 3)}${"•".repeat(13)}${plain.slice(-2)}`;
  if (plain.length === 18) return `${plain.slice(0, 3)}${"•".repeat(11)}${plain.slice(-4)}`;
  if (plain.length >= 8) return `${plain.slice(0, 2)}${"•".repeat(plain.length - 4)}${plain.slice(-2)}`;
  return plain;
}

/** 入库统一入口：规范化 + 加密 + 盲索引（无号码返回三个 null 字段） */
export function sealIdNumber(raw: string | null | undefined): {
  idNumber: string | null;
  idNumberBlind: string | null;
} {
  const normalized = normalizeIdNumber(raw);
  if (!normalized) return { idNumber: null, idNumberBlind: null };
  return { idNumber: encryptIdNumber(normalized), idNumberBlind: blindIdNumber(normalized) };
}
