"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MatterCategory } from "@prisma/client";

import { requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { saveFirmProfile, CATEGORY_WORD_DEFAULTS } from "./firm-profile";
import { ActionError } from "@/lib/action-error";

const CATEGORY_KEYS = Object.keys(CATEGORY_WORD_DEFAULTS) as MatterCategory[];

/** 约 256KB（base64 编码后的字符长度上限）——律所 logo 应远小于此 */
const MAX_LOGO_CHARS = 256 * 1024;

const saveSchema = z.object({
  firmName: z.string().trim().max(40).optional(),
  firmSubtitle: z.string().trim().max(40).optional(),
  matterCodePrefix: z.string().trim().max(12).optional(),
  firmShortName: z.string().trim().max(8).optional(),
  caseNoTemplate: z.string().trim().max(60).optional(),
  // undefined=不改 logo；null 或 "" =清除；data URL 字符串=替换
  logoDataUrl: z.string().nullable().optional(),
  categoryWords: z.record(z.string(), z.string().trim().max(12)).optional()
});

export async function saveFirmProfileAction(input: z.infer<typeof saveSchema>) {
  const session = await requireSystemAdmin();
  const data = saveSchema.parse(input);

  // Logo 校验：必须是 image/* 的 base64 data URL，且体积受限
  if (typeof data.logoDataUrl === "string" && data.logoDataUrl.length > 0) {
    if (!/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(data.logoDataUrl)) {
      throw new ActionError("Logo 必须是 PNG / JPG / WebP / SVG 图片");
    }
    if (data.logoDataUrl.length > MAX_LOGO_CHARS) {
      throw new ActionError("Logo 体积过大，请控制在约 180KB 以内");
    }
  }

  // 只保留有效类别键的非空词
  let categoryWords: Partial<Record<MatterCategory, string>> | undefined;
  if (data.categoryWords) {
    categoryWords = {};
    for (const key of CATEGORY_KEYS) {
      const word = data.categoryWords[key];
      if (typeof word === "string" && word.length > 0) categoryWords[key] = word;
    }
  }

  await saveFirmProfile({
    firmName: data.firmName,
    firmSubtitle: data.firmSubtitle,
    matterCodePrefix: data.matterCodePrefix,
    firmShortName: data.firmShortName,
    caseNoTemplate: data.caseNoTemplate,
    logoDataUrl:
      data.logoDataUrl === undefined
        ? undefined
        : data.logoDataUrl
          ? data.logoDataUrl
          : null,
    categoryWords: categoryWords as Record<MatterCategory, string> | undefined
  });

  await audit({
    userId: session.user.id,
    action: "FIRM_PROFILE_SAVE",
    targetType: "SystemSetting",
    targetId: "firmProfile"
  });

  // 侧栏品牌在所有 (app) 页面渲染 → 刷新整个布局
  revalidatePath("/", "layout");
  return { ok: true };
}
