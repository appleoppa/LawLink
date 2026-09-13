/**
 * v0.42 律所信息 / 编号体系配置（项 1 + 项 11）
 *
 * 单 SystemSetting key `firmProfile`，value 为 JSON：
 *   - firmName / firmSubtitle / logoDataUrl：侧栏品牌（默认 LawLink / 律师工作台）
 *   - matterCodePrefix：内部编号前缀（internalCode 的 LL 段，默认 LL）
 *   - firmShortName / caseNoTemplate / categoryWords：所内案号模板与各段映射
 *
 * 沿用 src/lib/ai/settings.ts 的「单 key + 类型化读写」范式。logo 直接以
 * base64 data URL 内联存储（律所 logo 体积小），避免引入额外存储/服务路由。
 */
import type { MatterCategory } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const FIRM_PROFILE_KEY = "firmProfile";

/** {类词} 默认映射：可在设置页逐类编辑 */
export const CATEGORY_WORD_DEFAULTS: Record<MatterCategory, string> = {
  CIVIL_COMMERCIAL: "民诉",
  LABOR_ARBITRATION: "劳仲",
  COMMERCIAL_ARBITRATION: "商仲",
  CRIMINAL: "刑辩",
  ADMINISTRATIVE: "行诉",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "顾问",
  SPECIAL_PROJECT: "专项"
};

/** {类} 单字简称（固定，不可编辑） */
export const CATEGORY_ABBR: Record<MatterCategory, string> = {
  CIVIL_COMMERCIAL: "民",
  LABOR_ARBITRATION: "劳",
  COMMERCIAL_ARBITRATION: "商",
  CRIMINAL: "刑",
  ADMINISTRATIVE: "行",
  NON_LITIGATION: "非",
  LEGAL_COUNSEL: "顾",
  SPECIAL_PROJECT: "专"
};

export interface FirmProfile {
  firmName: string;
  firmSubtitle: string;
  logoDataUrl: string | null;
  matterCodePrefix: string;
  firmShortName: string;
  caseNoTemplate: string;
  categoryWords: Record<MatterCategory, string>;
}

export const FIRM_PROFILE_DEFAULTS: FirmProfile = {
  firmName: "LawLink",
  firmSubtitle: "律师工作台",
  logoDataUrl: null,
  matterCodePrefix: "LL",
  firmShortName: "",
  caseNoTemplate: "{年}-{所}{类词}-{序3}",
  categoryWords: CATEGORY_WORD_DEFAULTS
};

export async function getFirmProfile(): Promise<FirmProfile> {
  const row = await prisma.systemSetting.findUnique({ where: { key: FIRM_PROFILE_KEY } });
  const s = (row?.value as Partial<FirmProfile> | null) ?? {};
  return {
    firmName: s.firmName || FIRM_PROFILE_DEFAULTS.firmName,
    firmSubtitle: s.firmSubtitle ?? FIRM_PROFILE_DEFAULTS.firmSubtitle,
    logoDataUrl: s.logoDataUrl ?? null,
    matterCodePrefix: s.matterCodePrefix?.trim() || FIRM_PROFILE_DEFAULTS.matterCodePrefix,
    firmShortName: s.firmShortName ?? FIRM_PROFILE_DEFAULTS.firmShortName,
    caseNoTemplate: s.caseNoTemplate?.trim() || FIRM_PROFILE_DEFAULTS.caseNoTemplate,
    categoryWords: { ...CATEGORY_WORD_DEFAULTS, ...(s.categoryWords ?? {}) }
  };
}

export async function saveFirmProfile(patch: Partial<FirmProfile>): Promise<FirmProfile> {
  const current = await getFirmProfile();
  // 显式逐字段合并：undefined 表示「不改」（对象展开会把 undefined 一并覆盖，故不用 spread）。
  // logoDataUrl 特殊：undefined=保留，null=清除。
  const next: FirmProfile = {
    firmName: patch.firmName ?? current.firmName,
    firmSubtitle: patch.firmSubtitle ?? current.firmSubtitle,
    logoDataUrl: patch.logoDataUrl === undefined ? current.logoDataUrl : patch.logoDataUrl,
    matterCodePrefix: patch.matterCodePrefix ?? current.matterCodePrefix,
    firmShortName: patch.firmShortName ?? current.firmShortName,
    caseNoTemplate: patch.caseNoTemplate ?? current.caseNoTemplate,
    categoryWords: { ...current.categoryWords, ...(patch.categoryWords ?? {}) }
  };
  await prisma.systemSetting.upsert({
    where: { key: FIRM_PROFILE_KEY },
    update: { value: next as object },
    create: { key: FIRM_PROFILE_KEY, value: next as object }
  });
  return next;
}
