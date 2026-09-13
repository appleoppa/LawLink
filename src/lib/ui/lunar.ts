/**
 * 农历日期展示（墨案 02 工作台问候区）。依赖运行环境 ICU 的 chinese 历法，
 * 不引入第三方库；环境不支持时返回 null，界面不显示农历。
 */
const DAY_NAMES = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

export function lunarDateLabel(date: Date, timeZone = "Asia/Shanghai"): string | null {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric", timeZone }).formatToParts(date);
    const month = parts.find((p) => p.type === "month")?.value;
    const day = Number(parts.find((p) => p.type === "day")?.value);
    if (!month || !day || day < 1 || day > 30) return null;
    return `农历${month}${DAY_NAMES[day - 1]}`;
  } catch {
    return null;
  }
}
