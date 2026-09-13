/**
 * v0.42 所内案号模板渲染（纯函数，无 DB 依赖，便于单测）
 *
 * 支持 token：
 *   {年}   四位年份        {年2}  两位年份
 *   {所}   律所简称        {类}   类别单字（民/刑…）  {类词}  类别词（民诉/刑辩…）
 *   {序3}  三位流水         {序4}  四位流水
 *
 * 默认模板 `{年}-{所}{类词}-{序3}` + 所简称「普」+ 类词「民诉」→ `2026-普民诉-001`。
 */
export interface CaseNoTokens {
  year: number;
  firmShortName: string;
  categoryAbbr: string;
  categoryWord: string;
  seq: number;
}

export function renderCaseNoTemplate(template: string, t: CaseNoTokens): string {
  return template
    .replace(/\{年2\}/g, String(t.year).slice(-2))
    .replace(/\{年\}/g, String(t.year))
    .replace(/\{所\}/g, t.firmShortName)
    .replace(/\{类词\}/g, t.categoryWord)
    .replace(/\{类\}/g, t.categoryAbbr)
    .replace(/\{序4\}/g, String(t.seq).padStart(4, "0"))
    .replace(/\{序3\}/g, String(t.seq).padStart(3, "0"));
}
