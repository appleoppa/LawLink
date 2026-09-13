/**
 * v0.9.1 AI 配置读写（OpenAI 兼容协议）
 *
 * SystemSetting 单 key `aiSettings`，value 是加密后的 JSON：
 *   { apiKeyCipher, baseUrl, textModel, visionModel }
 * apiKey 用 storage/crypto 同密钥（STORAGE_ENCRYPTION_KEY）加密存。
 *
 * 默认 provider：通义千问（决策 PRD §13.8.2 阿里云百炼免费额度大）。
 * 但用户可改任何 OpenAI 兼容 endpoint：DeepSeek / Kimi / 智谱 / OpenAI / OpenRouter / Ollama。
 */
import { prisma } from "@/lib/prisma";
import { encryptBuffer, decryptBuffer } from "@/lib/storage/crypto";

const AI_SETTINGS_KEY = "aiSettings";

export const AI_DEFAULTS = {
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  textModel: "qwen-turbo",
  visionModel: "qwen-vl-max"
} as const;

export interface StoredAiSettings {
  apiKeyCipher: { ct: string; iv: string; tag: string } | null;
  baseUrl: string;
  textModel: string;
  visionModel: string;
}

export interface ResolvedAiSettings {
  apiKey: string; // 已解密，仅 server 内部用
  baseUrl: string;
  textModel: string;
  visionModel: string;
  configured: boolean;
}

function encryptKey(plain: string): StoredAiSettings["apiKeyCipher"] {
  if (!plain) return null;
  const enc = encryptBuffer(Buffer.from(plain, "utf-8"));
  return {
    ct: enc.ciphertext.toString("base64"),
    iv: enc.iv.toString("base64"),
    tag: enc.authTag.toString("base64")
  };
}

function decryptKey(cipher: StoredAiSettings["apiKeyCipher"]): string {
  if (!cipher) return "";
  const ct = Buffer.from(cipher.ct, "base64");
  return decryptBuffer(ct, cipher.iv, cipher.tag).toString("utf-8");
}

export async function readStoredAiSettings(): Promise<StoredAiSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: AI_SETTINGS_KEY } });
  const stored = (row?.value as Partial<StoredAiSettings> | null) ?? {};
  return {
    apiKeyCipher: stored.apiKeyCipher ?? null,
    baseUrl: stored.baseUrl || AI_DEFAULTS.baseUrl,
    textModel: stored.textModel || AI_DEFAULTS.textModel,
    visionModel: stored.visionModel || AI_DEFAULTS.visionModel
  };
}

/** 给 UI 用：脱敏 + 是否已配置 */
export async function readPublicAiSettings(): Promise<{
  configured: boolean;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  apiKeyMasked: string;
}> {
  const s = await readStoredAiSettings();
  const key = decryptKey(s.apiKeyCipher);
  return {
    configured: !!key,
    baseUrl: s.baseUrl,
    textModel: s.textModel,
    visionModel: s.visionModel,
    apiKeyMasked: key ? `${key.slice(0, 4)}••••${key.slice(-4)}` : ""
  };
}

/** 给 server 内部调用：拿解密后的可用配置 */
export async function getAiSettings(): Promise<ResolvedAiSettings> {
  const s = await readStoredAiSettings();
  const apiKey = decryptKey(s.apiKeyCipher);
  return {
    apiKey,
    baseUrl: s.baseUrl,
    textModel: s.textModel,
    visionModel: s.visionModel,
    configured: !!apiKey
  };
}

export async function saveAiSettings(input: {
  apiKey?: string; // 留空则保留原值；显式传 null 清除
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  clearKey?: boolean;
}) {
  const current = await readStoredAiSettings();
  const next: StoredAiSettings = {
    apiKeyCipher: input.clearKey
      ? null
      : input.apiKey
        ? encryptKey(input.apiKey)
        : current.apiKeyCipher,
    baseUrl: input.baseUrl ?? current.baseUrl,
    textModel: input.textModel ?? current.textModel,
    visionModel: input.visionModel ?? current.visionModel
  };

  await prisma.systemSetting.upsert({
    where: { key: AI_SETTINGS_KEY },
    update: { value: next as object },
    create: { key: AI_SETTINGS_KEY, value: next as object }
  });

  return { ok: true };
}
