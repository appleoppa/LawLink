"use server";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { z } from "zod";
import { requireSystemAdmin } from "@/lib/auth/session";
import { aiVision, AiNotConfiguredError, extractJson } from "@/lib/ai/client";
import { readPublicAiSettings } from "@/lib/ai/settings";
import { approvalAudit, approvalTransaction } from "@/lib/approvals/service";
import {
  identityDocumentTypeSchema,
  normalizeIdentityDocumentNumber,
  readAndValidateIdentityImage
} from "@/lib/identity-documents";

const recognitionSchema = z.object({
  documentType: identityDocumentTypeSchema.or(z.literal("UNKNOWN")).optional(),
  name: z.string().trim().max(40).optional().default(""),
  documentNumber: z.string().trim().max(80).optional().default(""),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().default("LOW")
});

function destination(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return { host, local };
  } catch {
    return { host: "配置地址无效", local: false };
  }
}

export async function getIdentityRecognitionConfig() {
  await requireSystemAdmin();
  const settings = await readPublicAiSettings();
  return { configured: settings.configured, ...destination(settings.baseUrl) };
}

async function prepareImage(buffer: Buffer) {
  const image = await loadImage(buffer);
  const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas.encode("jpeg", 82);
}

export async function recognizeIdentityDocument(formData: FormData): Promise<
  | { ok: true; data: z.infer<typeof recognitionSchema> }
  | { ok: false; message: string }
> {
  const session = await requireSystemAdmin();
  const settings = await readPublicAiSettings();
  const target = destination(settings.baseUrl);
  if (!settings.configured) return { ok: false, message: "视觉识别服务尚未配置，请手工录入，或先到设置中配置" };
  if (!target.local && formData.get("remoteConsent") !== "true") {
    return { ok: false, message: `请确认将证件照片发送至 ${target.host} 进行本次识别` };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, message: "请先选择证件照片" };

  try {
    const validated = await readAndValidateIdentityImage(file);
    const prepared = await prepareImage(validated.buffer);
    const selectedType = identityDocumentTypeSchema.safeParse(formData.get("selectedType"));
    const prompt = `识别身份证件资料页。管理员当前选择的类型是 ${selectedType.success ? selectedType.data : "UNKNOWN"}。
仅返回 JSON，不要解释：
{"documentType":"PRC_RESIDENT_ID | HK_MACAO_TAIWAN_RESIDENCE_PERMIT | PRC_HK_MACAO_TRAVEL_PERMIT | HK_MACAO_MAINLAND_TRAVEL_PERMIT | TAIWAN_MAINLAND_TRAVEL_PERMIT | PASSPORT | FOREIGN_PERMANENT_RESIDENT_ID | OTHER | UNKNOWN","name":"持证人姓名","documentNumber":"证件号码","confidence":"HIGH | MEDIUM | LOW"}
不要返回住址、出生日期、民族、性别或其他个人信息。无法确认的字段使用空字符串，不能猜测。`;
    const response = await aiVision({
      image: { dataUrl: `data:image/jpeg;base64,${prepared.toString("base64")}` },
      prompt,
      maxTokens: 400,
      timeoutMs: 30_000
    });
    const parsed = recognitionSchema.safeParse(extractJson(response.content));
    if (!parsed.success) throw new Error("unreadable");
    const data = { ...parsed.data, documentNumber: normalizeIdentityDocumentNumber(parsed.data.documentNumber) };
    await approvalTransaction(async db => {
      await approvalAudit(db, session.user.id, "USER_IDENTITY_OCR", session.user.id, {
        destinationHost: target.host,
        sourceBytes: file.size,
        transmittedBytes: prepared.length,
        confidence: data.confidence,
        recognizedFields: [data.name ? "name" : null, data.documentNumber ? "identityDocumentNumber" : null, data.documentType && data.documentType !== "UNKNOWN" ? "identityDocumentType" : null].filter(Boolean)
      });
    });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { ok: false, message: "视觉识别服务尚未配置，请手工录入" };
    const message = error instanceof Error && error.message.startsWith("证件照片") ? error.message : "未能识别证件，请对照照片手工录入";
    return { ok: false, message };
  }
}
