/**
 * 法定放假安排引擎（F-5，2026-09-21，第六轮体检）。
 *
 * 民诉法第八十五条第三款：期间届满的最后一日是法定休假日的，以休假日后的
 * 第一日为届满日。系统不内置硬编码放假表（每年国务院调整会过期），由管理
 * 后台每年录入；本引擎据此把届满日顺延到下一工作日（调休上班日 WORKDAY
 * 不视为休假日）。
 *
 * 降级约定：Holiday 表未建（迁移未执行）或查询失败时按「未配置」处理，
 * 返回原日期并 adjusted=false——既有「请人工核对顺延」提示逻辑不受影响。
 */
import { prisma } from "@/lib/prisma";
import { civilFromKey, civilKey } from "@/lib/ui/sh-time";

export type HolidayMap = Map<string, { name: string; kind: "HOLIDAY" | "WORKDAY" }>;

/** 读取一段日期范围内的放假安排（上海日历日键 → 安排）；表未建/出错返回空表 */
export async function loadHolidayMap(fromKey: string, toKey: string): Promise<HolidayMap> {
  const map: HolidayMap = new Map();
  try {
    const rows = await prisma.holiday.findMany({
      where: { date: { gte: civilFromKey(fromKey), lte: civilFromKey(toKey) } },
      select: { date: true, name: true, kind: true }
    });
    for (const r of rows) {
      map.set(civilKey(r.date), { name: r.name, kind: r.kind === "WORKDAY" ? "WORKDAY" : "HOLIDAY" });
    }
  } catch {
    // 表未建（迁移未执行）——按未配置降级
  }
  return map;
}

/** 是否已配置任意放假安排（供界面决定提示口径） */
export async function hasHolidayConfig(): Promise<boolean> {
  try {
    return (await prisma.holiday.count({ take: 1 })) > 0;
  } catch {
    return false;
  }
}

/**
 * 届满日顺延：届满日落在放假安排的 HOLIDAY 上时，顺延到后续第一个非休假日
 * （周末不在 Holiday 表中——国务院通知的调休安排已用 WORKDAY 表达上班的周末，
 * 未出现在表中的周末仍按休假日顺延，与「法定休假日」的文义一致）。
 */
export function nextWorkdayKey(key: string, map: HolidayMap): string {
  let cur = civilFromKey(key);
  for (let i = 0; i < 30; i++) {
    const k = civilKey(cur);
    const entry = map.get(k);
    const weekend = cur.getDay() === 0 || cur.getDay() === 6;
    const isRest = entry ? entry.kind === "HOLIDAY" : weekend;
    if (!isRest) return k;
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return key; // 超长连休异常兜底：不顺延
}

export type AdjustedDeadline = { key: string; adjusted: boolean; fromKey?: string; reason?: string };

/**
 * 期限届满日按放假安排顺延（服务端重算与确认场景使用）。
 * 返回 adjusted=false 表示无需顺延或未配置。
 */
export async function adjustDeadlineForHolidays(dueKey: string): Promise<AdjustedDeadline> {
  // 只需看届满日起一小段窗口（长假最长约 8 天，取 15 天余量）
  const map = await loadHolidayMap(dueKey, civilKey(new Date(civilFromKey(dueKey).getTime() + 15 * 86_400_000)));
  const adjustedKey = nextWorkdayKey(dueKey, map);
  if (adjustedKey === dueKey) return { key: dueKey, adjusted: false };
  const hit = map.get(dueKey);
  return {
    key: adjustedKey,
    adjusted: true,
    fromKey: dueKey,
    reason: hit ? `${hit.name}（法定休假日）顺延` : "届满日为周末/休假日顺延"
  };
}
