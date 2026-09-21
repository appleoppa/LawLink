/**
 * B2 OCR provider 抽象（docs/SYSTEM-AUDIT-REMEDIATION-V3-20260920.md B 批设计定案：
 * 云 API、联网部署、管理后台「外部接入」配置、部署方自选厂商）。
 *
 * 两个实现，按配置自动选择：
 *   1. ai-vision（默认）：复用 AI 设置的 visionModel（OpenAI 兼容多模态，qwen-vl 等）——
 *      图片直接识别；无需单独注册 OCR 厂商。AI 未配置时不可用。
 *   2. http（可选）：通用 HTTP OCR 网关（SystemSetting `ocrSettings`：
 *      {endpoint, apiKey?, supportsPdf}）——POST {contentBase64, mimeType} → {text}，
 *      部署方可接任意云 OCR（阿里/腾讯/百度/自建网关）；supportsPdf 时可整体识别扫描 PDF。
 *
 * 未配置/类型不支持 → 抛 OcrNotConfiguredError，调用方按 NEEDS_OCR 降级可见，
 * 不显示为分析成功（v3 验收场景 9：AI 不可用时保存、取件与人工确认照常）。
 */
import { prisma } from "@/lib/prisma";
import { aiVision } from "@/lib/ai/client";
import { ActionError } from "@/lib/action-error";

const OCR_SETTINGS_KEY = "ocrSettings";

export interface StoredOcrSettings {
  endpoint: string;
  apiKey?: string;
  /** HTTP 网关声明支持整体识别扫描 PDF（无文本层时直接送 PDF 字节） */
  supportsPdf?: boolean;
}

export class OcrNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`OCR 不可用：${reason}。可在管理后台「AI 与元典」配置视觉模型，或在系统设置配置 OCR 服务`);
    this.name = "OcrNotConfiguredError";
  }
}

export async function readOcrSettings(): Promise<StoredOcrSettings | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: OCR_SETTINGS_KEY } });
  const stored = row?.value as Partial<StoredOcrSettings> | null;
  if (!stored?.endpoint) return null;
  return { endpoint: stored.endpoint, apiKey: stored.apiKey || undefined, supportsPdf: stored.supportsPdf === true };
}

export async function saveOcrSettings(input: StoredOcrSettings) {
  await prisma.systemSetting.upsert({
    where: { key: OCR_SETTINGS_KEY },
    create: { key: OCR_SETTINGS_KEY, value: input as object },
    update: { value: input as object }
  });
}

export interface OcrResult {
  text: string;
  engine: "ai-vision" | "http";
}

/** 识别单张图片或（网关支持时）扫描 PDF。 */
export async function recognizeText(input: { data: Buffer; mimeType: string; hint?: string; userId?: string }): Promise<OcrResult> {
  const settings = await readOcrSettings();
  const mime = input.mimeType.toLowerCase();
  const isImage = mime.startsWith("image/");
  const isPdf = mime.includes("pdf");

  if (settings?.endpoint) {
    const canHandle = isImage || (isPdf && settings.supportsPdf);
    if (canHandle) return httpOcr(settings, input);
    throw new OcrNotConfiguredError(`所配 HTTP OCR 不支持 ${input.mimeType}（图片或声明 supportsPdf 的网关才可识别）`);
  }

  if (isImage) return aiVisionOcr(input);
  throw new OcrNotConfiguredError(`无文本层的 PDF 需要支持 PDF 的 OCR 服务端点（当前仅视觉模型可用，仅支持图片）`);
}

async function aiVisionOcr(input: { data: Buffer; mimeType: string; hint?: string; userId?: string }): Promise<OcrResult> {
  const dataUrl = `data:${input.mimeType};base64,${input.data.toString("base64")}`;
  // 2026-09-20 第五轮审计 P2-1 修复：此前直接调 aiChat 未传 model，落到 textModel——
  // 纯文本模型收到 image_url 多半报错（落 FAILED）。改走 aiVision（默认 visionModel），
  // 与本文件头注「默认复用 AI 设置的 visionModel」的声明一致。
  const result = await aiVision({
    image: { dataUrl },
    prompt: `请逐字识别这张${input.hint ?? "法院文书扫描件"}图片中的全部文字，按原文顺序输出纯文本，不要解释、不要总结、不要添加标点以外的内容。`,
    logAction: "sms-ocr-vision",
    userId: input.userId // 第八轮体检：扫描件外发也记发起人
  });
  if (!result.content.trim()) throw new ActionError("OCR 未返回文本");
  return { text: result.content.trim(), engine: "ai-vision" };
}

async function httpOcr(settings: StoredOcrSettings, input: { data: Buffer; mimeType: string; hint?: string }): Promise<OcrResult> {
  const { assertSafeHttpUrl, safeFetch } = await import("@/lib/net/safe-url");
  const url = await assertSafeHttpUrl(settings.endpoint);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await safeFetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
      },
      body: JSON.stringify({ contentBase64: input.data.toString("base64"), mimeType: input.mimeType }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new ActionError(`OCR 服务返回 HTTP ${res.status}`);
    const body = (await res.json()) as { text?: string; data?: { text?: string }[] };
    const text = body.text ?? body.data?.[0]?.text ?? "";
    if (!text.trim()) throw new ActionError("OCR 服务未返回文本");
    // 2026-09-20 P3 修复：拒答文本（网关无法识别时返回的说明文字）不当有效 OCR 结果送 AI
    const trimmed = text.trim();
    if (/^(无法识别|识别失败|识别不到|请提供(更清晰|清晰)|图片(模糊|无法)|no text|unable to (recognize|read))/i.test(trimmed) && trimmed.length < 60) {
      throw new ActionError("OCR 服务未能识别该文件（拒答），请人工核对或更换 OCR 配置");
    }
    return { text: trimmed, engine: "http" };
  } finally {
    clearTimeout(timer);
  }
}
