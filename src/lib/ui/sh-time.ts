/**
 * 上海时区的日期 / 时刻展示工具。
 *
 * 客户端组件会先在服务端渲染再在浏览器水合：若直接用 getHours()/getDate() 等本地时区方法，
 * 服务器（常为 UTC 或其他时区）与浏览器所在时区不同就会得到不同文本，导致水合失败、时间显示错位。
 * 业务时间一律按 Asia/Shanghai 解释，与 AGENTS「日期统一上海时区」约定一致。
 *
 * 「日历日」用本地正午的 Date 表示（new Date(y, m-1, d, 12)），只读取其年月日字段，
 * 这样在 UTC±12 以内的任意运行时区里做加减天数与取月份都不会跨日。
 */
export const SH_TZ = "Asia/Shanghai";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short"
});

const WEEK_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** 星期中文（0=周日）：与 shParts().w 配套 */
export const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"] as const;

export type ShParts = { y: number; m: number; d: number; hh: number; mm: number; w: number };

/** 某一时刻在上海时区的年、月（1-12）、日、时、分、星期（0=周日） */
export function shParts(value: Date | string | number): ShParts {
  const map: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(new Date(value))) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day), hh: Number(map.hour) % 24, mm: Number(map.minute), w: WEEK_INDEX[map.weekday] ?? 0 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 上海日历日键 YYYY-MM-DD */
export function shDayKey(value: Date | string | number): string {
  const p = shParts(value);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 上海时刻 HH:mm */
export function shTime(value: Date | string | number): string {
  const p = shParts(value);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** 上海 MM-DD */
export function shMonthDay(value: Date | string | number): string {
  const p = shParts(value);
  return `${pad(p.m)}-${pad(p.d)}`;
}

/** 上海 MM-DD HH:mm */
export function shMonthDayTime(value: Date | string | number): string {
  return `${shMonthDay(value)} ${shTime(value)}`;
}

/** 由日历日键得到本地正午 Date（仅用于日历计算） */
export function civilFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/** 上海「今天」的日历日（本地正午 Date） */
export function shTodayCivil(): Date {
  return civilFromKey(shDayKey(new Date()));
}

/** 本地正午日历日 → 键 */
export function civilKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 某时刻相对上海今天相差的日历天数（今天 0，明天 1，昨天 -1） */
export function shDaysFromToday(value: Date | string | number): number {
  return Math.round((civilFromKey(shDayKey(value)).getTime() - shTodayCivil().getTime()) / 86_400_000);
}
