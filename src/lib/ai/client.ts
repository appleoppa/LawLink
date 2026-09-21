/**
 * v0.9.1 OpenAI 兼容协议封装
 *
 * 所有调用走 {baseUrl}/chat/completions。
 * 支持 OpenAI / 通义 / DeepSeek / Kimi / 智谱 / OpenRouter / Ollama 等。
 *
 * server-side only（直接读 SystemSetting）。
 */
import { getAiSettings } from "./settings";
import { withExternalCallLog } from "@/lib/external-call-log";
import { assertSafeHttpUrl } from "@/lib/net/safe-url";

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

export interface AiChatOptions {
  messages: ChatMessage[];
  model?: string; // 覆盖默认 textModel
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  logAction?: string; // 外部调用台账的业务动作名（如 review-document）
}

export interface AiChatResult {
  content: string;
  raw: unknown;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI 未配置，请先到 管理后台 → AI 与元典 填写 API key");
    this.name = "AiNotConfiguredError";
  }
}

async function callOpenAiCompatible(opts: {
  apiKey: string;
  baseUrl: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    // 私网校验（2026-09-19 审计）：管理端可配的 baseUrl 不得指向本机/内网
    await assertSafeHttpUrl(opts.baseUrl.replace(/\/$/, ""));
    const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify(opts.body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI 请求失败 (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function aiChat(input: AiChatOptions): Promise<AiChatResult> {
  const s = await getAiSettings();
  if (!s.configured) throw new AiNotConfiguredError();

  const body = {
    model: input.model || s.textModel,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 1500,
    temperature: input.temperature ?? 0.2
  };

  // v1.x P1: 外部调用台账（成败/耗时；失败不改变原有异常行为）
  const json = (await withExternalCallLog(
    { service: "ai-chat", action: input.logAction },
    () => callOpenAiCompatible({
      apiKey: s.apiKey,
      baseUrl: s.baseUrl,
      body,
      timeoutMs: input.timeoutMs ?? 20_000
    })
  )) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = json.choices?.[0]?.message?.content ?? "";
  return { content, raw: json };
}

/**
 * 视觉识别：传 base64 / dataURL / URL 三选一，prompt 引导模型抽字段。
 */
export async function aiVision(input: {
  image: { dataUrl: string } | { url: string };
  prompt: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  logAction?: string;
}): Promise<AiChatResult> {
  const s = await getAiSettings();
  if (!s.configured) throw new AiNotConfiguredError();

  const imageUrl = "dataUrl" in input.image ? input.image.dataUrl : input.image.url;

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: input.prompt }
      ]
    }
  ];

  return aiChat({
    messages,
    model: input.model || s.visionModel,
    maxTokens: input.maxTokens ?? 2000,
    timeoutMs: input.timeoutMs ?? 30_000,
    logAction: input.logAction
  });
}

/**
 * 从 AI 返回文本中提取 JSON（容错：``` 包裹、前后有解释文字均能抽出）。
 */
export function extractJson<T = unknown>(content: string): T | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : content;
  const match = candidate.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
