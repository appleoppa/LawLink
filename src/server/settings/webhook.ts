/**
 * v0.50: 提醒 webhook 配置（企业微信 / 钉钉群机器人）。
 *
 * 单 SystemSetting key `notifyWebhook`。两家的自定义机器人都接受
 * POST {"msgtype":"text","text":{"content":"..."}}，无需区分厂商；
 * 钉钉机器人若配置了「自定义关键词」安全设置，消息以「LawLink」开头即可命中。
 * 沿用 firm-profile 的「单 key + 类型化读写」范式。
 */
import { prisma } from "@/lib/prisma";

const WEBHOOK_KEY = "notifyWebhook";

export interface WebhookSettings {
  enabled: boolean;
  url: string;
}

export const WEBHOOK_DEFAULTS: WebhookSettings = {
  enabled: false,
  url: ""
};

export async function getWebhookSettings(): Promise<WebhookSettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: WEBHOOK_KEY } });
  const s = (row?.value as Partial<WebhookSettings> | null) ?? {};
  return {
    enabled: s.enabled ?? WEBHOOK_DEFAULTS.enabled,
    url: typeof s.url === "string" ? s.url : WEBHOOK_DEFAULTS.url
  };
}

export async function saveWebhookSettings(next: WebhookSettings): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: WEBHOOK_KEY },
    create: { key: WEBHOOK_KEY, value: { ...next } },
    update: { value: { ...next } }
  });
}

const WEBHOOK_TIMEOUT_MS = 8000;

/**
 * 发送文本消息到已配置的 webhook。未启用/未配置时静默跳过（返回 skipped）。
 * 不抛异常：提醒推送失败不能影响主流程，失败原因返回给调用方记录。
 */
export async function sendWebhookText(
  content: string
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const settings = await getWebhookSettings();
  if (!settings.enabled || !settings.url) return { ok: false, skipped: true };

  let url: URL;
  try {
    url = new URL(settings.url);
    if (url.protocol !== "https:") throw new Error("仅支持 HTTPS");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "webhook URL 无效" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content } }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    // 企微/钉钉都返回 {errcode:0,...} 表示成功
    const data = (await response.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
    if (data && typeof data.errcode === "number" && data.errcode !== 0) {
      return { ok: false, error: `errcode ${data.errcode}: ${data.errmsg ?? ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "请求失败" };
  } finally {
    clearTimeout(timer);
  }
}
