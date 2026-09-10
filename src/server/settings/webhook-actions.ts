"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import {
  getWebhookSettings,
  saveWebhookSettings,
  sendWebhookText
} from "./webhook";

const saveSchema = z.object({
  enabled: z.boolean(),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || v.startsWith("https://"), "仅支持 HTTPS 的机器人地址")
});

async function requireManager() {
  const session = await requireSession();
  if (session.user.role !== "ADMIN" && session.user.role !== "PRINCIPAL_LAWYER") {
    throw new Error("仅管理员 / 主任律师可配置提醒推送");
  }
  return session;
}

export async function getWebhookSettingsAction() {
  await requireManager();
  return getWebhookSettings();
}

export async function saveWebhookSettingsAction(input: z.infer<typeof saveSchema>) {
  const session = await requireManager();
  const data = saveSchema.parse(input);
  if (data.enabled && !data.url) throw new Error("启用推送需要填写机器人地址");

  await saveWebhookSettings({ enabled: data.enabled, url: data.url });
  await audit({
    userId: session.user.id,
    action: "WEBHOOK_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "notifyWebhook",
    detail: { enabled: data.enabled, hasUrl: Boolean(data.url) }
  });
  revalidatePath("/settings/reminders");
  return { ok: true };
}

export async function sendTestWebhookAction() {
  const session = await requireManager();
  const result = await sendWebhookText(
    `LawLink 测试消息：提醒推送配置成功（发起人：${session.user.name ?? session.user.email}）`
  );
  if (result.skipped) throw new Error("推送未启用或未配置机器人地址");
  if (!result.ok) throw new Error(`发送失败：${result.error ?? "未知错误"}`);
  return { ok: true };
}
