/**
 * v0.9.2 律师常用速算
 *
 * 三大场景：
 *  - 诉讼费：依据《诉讼费用交纳办法》全国统一分段累进 + 简易程序减半
 *  - 迟延履行金：判决金额 × (LPR + 5%) × 实际履行 - 应履行 天数 / 365
 *  - 天数：两日期间 / 加减 N 日
 *
 * 大写金额：numberToChinese（万 / 亿 / 万亿 完整支持）
 *
 * 不依赖网络、不依赖 server。
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 诉讼费
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type CourtFeeCaseType =
  | "PROPERTY"       // 财产案件
  | "DIVORCE"        // 离婚案件
  | "LABOR"          // 劳动争议
  | "IP"             // 知识产权（无争议金额）
  | "OTHER";         // 其他非财产案件

/**
 * 财产案件分段累进（《诉讼费用交纳办法》第十三条）：
 *   ≤ 1 万                              50 元
 *   1 万 – 10 万         × 2.5%  - 200
 *   10 万 – 20 万        × 2%    + 300
 *   20 万 – 50 万        × 1.5%  + 1300
 *   50 万 – 100 万       × 1%    + 3800
 *   100 万 – 200 万      × 0.9%  + 4800
 *   200 万 – 500 万      × 0.8%  + 6800
 *   500 万 – 1000 万     × 0.7%  + 11800
 *   1000 万 – 2000 万    × 0.6%  + 21800
 *   > 2000 万            × 0.5%  + 41800
 */
function feePropertyTiers(amount: number): number {
  if (amount <= 10_000) return 50;
  if (amount <= 100_000) return amount * 0.025 - 200;
  if (amount <= 200_000) return amount * 0.02 + 300;
  if (amount <= 500_000) return amount * 0.015 + 1_300;
  if (amount <= 1_000_000) return amount * 0.01 + 3_800;
  if (amount <= 2_000_000) return amount * 0.009 + 4_800;
  if (amount <= 5_000_000) return amount * 0.008 + 6_800;
  if (amount <= 10_000_000) return amount * 0.007 + 11_800;
  if (amount <= 20_000_000) return amount * 0.006 + 21_800;
  return amount * 0.005 + 41_800;
}

export interface CourtFeeResult {
  caseType: CourtFeeCaseType;
  amount: number; // 输入标的额
  fee: number; // 普通程序
  feeSimplified: number; // 简易程序（减半）
  note: string;
}

export function calcCourtFee(input: { caseType: CourtFeeCaseType; amount?: number }): CourtFeeResult {
  const amount = input.amount ?? 0;

  switch (input.caseType) {
    case "PROPERTY": {
      const fee = Math.round(feePropertyTiers(amount));
      return {
        caseType: "PROPERTY",
        amount,
        fee,
        feeSimplified: Math.round(fee / 2),
        note: "财产案件按分段累进，简易程序减半收取"
      };
    }
    case "DIVORCE": {
      // 离婚：每件 50-300 元；涉及财产分割 > 20 万 部分 × 0.5%
      const base = 300;
      const extra = amount > 200_000 ? (amount - 200_000) * 0.005 : 0;
      const fee = Math.round(base + extra);
      return {
        caseType: "DIVORCE",
        amount,
        fee,
        feeSimplified: Math.round(fee / 2),
        note:
          amount > 200_000
            ? "离婚 300 元 + 财产分割超 20 万部分 × 0.5%（简易程序减半）"
            : "离婚每件 300 元（简易程序减半）"
      };
    }
    case "LABOR":
      return {
        caseType: "LABOR",
        amount,
        fee: 10,
        feeSimplified: 5,
        note: "劳动争议案件每件 10 元（简易程序 5 元）"
      };
    case "IP":
      // 50 元 ≤ X ≤ 100 元；案件复杂 100-500 元；区间给中位
      return {
        caseType: "IP",
        amount: 0,
        fee: 1000,
        feeSimplified: 500,
        note: "知识产权（无争议金额）500–1000 元，本结果取上限"
      };
    case "OTHER":
      return {
        caseType: "OTHER",
        amount: 0,
        fee: 100,
        feeSimplified: 50,
        note: "其他非财产案件每件 50–100 元，本结果取上限"
      };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 迟延履行金
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 民诉法解释第 463 条 + 民诉法第 260 条：
 *   迟延履行期间债务利息 = 判决金额 × (LPR 1Y + 5%) × 迟延天数 / 365
 *
 * 法律依据：被执行人未按判决履行金钱给付义务，应当加倍支付迟延履行期间债务利息。
 * 此为"加倍部分"。
 *
 * LPR 当前默认 3.45%（2024-2025 区间），用户可手动覆盖。
 */
export interface LateInterestResult {
  principal: number;
  daysLate: number;
  yearlyRate: number;       // LPR + 5%
  interest: number;         // 加倍部分（推荐采用值）
  totalToPay: number;       // 本金 + 加倍利息
}

export function calcLateInterest(input: {
  principal: number;
  dueDate: Date;
  paidDate: Date;
  lprPercent?: number; // LPR 1 年期，默认 3.45
  extraPercent?: number; // 加成，默认 5
}): LateInterestResult {
  const lpr = input.lprPercent ?? 3.45;
  const extra = input.extraPercent ?? 5;
  const yearlyRate = (lpr + extra) / 100;
  const daysLate = Math.max(
    0,
    Math.floor((input.paidDate.getTime() - input.dueDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const interest = +(input.principal * yearlyRate * daysLate / 365).toFixed(2);
  return {
    principal: input.principal,
    daysLate,
    yearlyRate,
    interest,
    totalToPay: +(input.principal + interest).toFixed(2)
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 天数计算
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function daysBetween(a: Date, b: Date, excludeWeekend = false): number {
  const start = new Date(a);
  const end = new Date(b);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (!excludeWeekend) {
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }
  // 排除周末（工作日数）
  const sign = end >= start ? 1 : -1;
  let count = 0;
  const cur = new Date(start);
  const target = new Date(end);
  while (cur.getTime() !== target.getTime()) {
    cur.setDate(cur.getDate() + sign);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += sign;
  }
  return count;
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 大写金额（取自旧系统 numToCn，整理后）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CN_DIGIT = "零壹贰叁肆伍陆柒捌玖";
const CN_UNIT_LO = ["仟", "佰", "拾", ""];
const CN_UNIT_HI = ["", "万", "亿", "万亿"];

function chineseGroup4(s: string): string {
  const padded = s.padStart(4, "0");
  let r = "";
  let needZero = false;
  for (let i = 0; i < 4; i++) {
    const d = +padded[i];
    if (d === 0) {
      if (r) needZero = true;
    } else {
      if (needZero) {
        r += "零";
        needZero = false;
      }
      r += CN_DIGIT[d] + CN_UNIT_LO[i];
    }
  }
  return r;
}

export function numberToChinese(n: number): string {
  if (n === 0 || !isFinite(n)) return "零元整";
  const neg = n < 0;
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const [intStr, decStrRaw = ""] = String(abs).split(".");
  const decStr = decStrRaw.padEnd(2, "0").slice(0, 2);

  // 整数部分：按 4 位分段
  const segs: string[] = [];
  let t = intStr;
  while (t.length > 0) {
    segs.unshift(t.slice(-4));
    t = t.slice(0, -4);
  }

  let r = "";
  let lastHadValue = false;
  for (let i = 0; i < segs.length; i++) {
    const s = chineseGroup4(segs[i]);
    const ui = segs.length - 1 - i;
    if (s) {
      if (r && !lastHadValue) r += "零";
      r += s + CN_UNIT_HI[ui];
      lastHadValue = true;
    } else {
      if (r) lastHadValue = false;
    }
  }
  if (!r) r = "零";
  r += "元";

  const j = +decStr[0];
  const f = +decStr[1];
  if (j === 0 && f === 0) {
    r += "整";
  } else {
    if (j > 0) r += CN_DIGIT[j] + "角";
    else if (f > 0) r += "零";
    if (f > 0) r += CN_DIGIT[f] + "分";
  }
  return (neg ? "负" : "") + r;
}
