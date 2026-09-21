import type { MatterCategory } from "@prisma/client";
import { nextSystemCounter } from "@/lib/system-counter";
import { matterCategoryCode } from "@/lib/procedures-by-category";
import { getFirmProfile, CATEGORY_ABBR } from "@/server/settings/firm-profile";
import { renderCaseNoTemplate } from "@/lib/matters/firm-caseno";
import { shParts } from "@/lib/ui/sh-time";

/** 2026-09-20 第五轮审计时区修复：编号年份按上海（元旦 0-8 点不再生成去年编号、落去年计数器） */
function shYearNow(): number {
  return shParts(new Date()).y;
}


/**
 * 原子生成 internalCode：{前缀}-{YYYY}-{CODE}-{4位流水}
 *
 * 前缀可在「设置 → 律所信息」配置（默认 LL）。计数器 key 形如 `code-counter-2026-CC`。
 */
export async function generateInternalCode(category: MatterCategory): Promise<string> {
  const year = shYearNow();
  const code = matterCategoryCode[category];
  const { matterCodePrefix } = await getFirmProfile();

  const next = await nextSystemCounter(`code-counter-${year}-${code}`);
  return `${matterCodePrefix}-${year}-${code}-${String(next).padStart(4, "0")}`;
}

/**
 * v0.42 生成所内案号（项 11）：按「设置 → 律所信息」的模板渲染。
 * 计数器按 年 + 类别 独立自增，key 形如 `firm-caseno-2026-CC`。
 * 模板为空时回退默认；与 internalCode 计数器互不干扰。
 */
export async function generateFirmCaseNo(category: MatterCategory): Promise<string> {
  const year = shYearNow();
  const code = matterCategoryCode[category];
  const profile = await getFirmProfile();

  const seq = await nextSystemCounter(`firm-caseno-${year}-${code}`);
  return renderCaseNoTemplate(profile.caseNoTemplate, {
    year,
    firmShortName: profile.firmShortName,
    categoryAbbr: CATEGORY_ABBR[category],
    categoryWord: profile.categoryWords[category],
    seq
  });
}
