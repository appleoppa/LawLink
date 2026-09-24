"use server";
/** B2：OCR 设置管理 action（仅 SUPER_ADMIN；密钥不回显明文）。 */
import { z } from "zod";
import { requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { readOcrSettings, saveOcrSettings } from "@/server/ocr/provider";

const saveSchema = z.object({
  endpoint: z.string().trim().max(300),
  apiKey: z.string().trim().max(200).optional(),
  supportsPdf: z.boolean()
});

export async function getOcrSettingsPublic() {
  // 2026-09-20 P3 修复：补系统管理鉴权（同文件 save 有 requireSystemAdmin，读取此前裸导出）
  await requireSystemAdmin();
  const stored = await readOcrSettings();
  return {
    endpoint: stored?.endpoint ?? "",
    apiKey: stored?.apiKey ? "已保存" : "",
    supportsPdf: stored?.supportsPdf ?? false
  };
}

export async function saveOcrSettingsAction(input: z.input<typeof saveSchema>) {
  const session = await requireSystemAdmin();
  const data = saveSchema.parse(input);
  const existing = await readOcrSettings();
  await saveOcrSettings({
    endpoint: data.endpoint,
    apiKey: data.apiKey || existing?.apiKey,
    supportsPdf: data.supportsPdf
  });
  await audit({
    userId: session.user.id,
    action: "OCR_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "ocrSettings",
    detail: { hasEndpoint: Boolean(data.endpoint), supportsPdf: data.supportsPdf, keyChanged: Boolean(data.apiKey) }
  });
  return { ok: true };
}
