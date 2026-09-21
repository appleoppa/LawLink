// @vitest-environment node
/**
 * 期间实收汇总口径（periodReceipts / periodReceiptSummary）守卫测试。
 * 起点：2026-09-21 财务页出现「本月律师费实收 ¥-10,000 · 已确认 1 笔」不可解——
 * 净额为负是「当期确认的退款冲正大于收款」的真实数据，口径保留（负向调整不掩盖），
 * 但净实收、正向笔数、退款合计三者必须同源可算，界面据此注明构成。
 */
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { periodReceipts, periodReceiptSummary, type FinanceFacts } from "@/server/finance/facts";

const d = (v: number) => new Prisma.Decimal(v);
const matter = {
  id: "m1", internalCode: "MS-2026-001", title: "演示案", ownerId: "u1",
  owner: { name: "演示律师" }, primaryClientId: null, primaryClient: null
} satisfies FinanceFacts["matters"][number];

const pay = (id: string, amount: number, at: Date, moneyKind: "LAWYER_FEE" | "CLIENT_FUNDS" = "LAWYER_FEE"): FinanceFacts["payments"][number] => ({
  id, matterId: matter.id, amount: d(amount), originalAmount: d(amount), allocatedAmount: d(0), refundedAmount: d(0),
  feeEntryId: null, occurredAt: at, moneyKind, revision: 0, sourceValid: true, matter
});

const refund = (id: string, amount: number, at: Date): FinanceFacts["refunds"][number] => ({
  ...pay(`pay-${id}`, 0, at), id, paymentId: `pay-${id}`, amount: d(amount), occurredAt: at,
  note: "退款：阶段和解", correctionType: "REFUND", confirmedById: "fin1"
});

const sepStart = new Date("2026-09-01T00:00:00+08:00");
const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00+08:00`);
const aug20 = new Date("2026-08-20T12:00:00+08:00");
const octStart = new Date("2026-10-01T00:00:00+08:00");

describe("期间实收汇总口径", () => {
  it("收款 2 万＋退款冲正 3 万＝净 -1 万；笔数只数正向，退款合计单列（2026-09 财务页场景）", () => {
    const facts = { payments: [pay("p1", 20000, at(15))], refunds: [refund("c1", 30000, at(18))] } satisfies Pick<FinanceFacts, "payments" | "refunds">;
    expect(periodReceiptSummary(periodReceipts(facts, sepStart))).toEqual({ netReceived: -10000, confirmedCount: 1, refundTotal: 30000 });
  });

  it("窗口外与代收款不进入律师费实收", () => {
    const facts = {
      payments: [pay("aug", 50000, aug20), pay("cf", 8000, at(18), "CLIENT_FUNDS"), pay("p1", 20000, at(15))],
      refunds: [refund("augR", 10000, aug20)]
    } satisfies Pick<FinanceFacts, "payments" | "refunds">;
    expect(periodReceiptSummary(periodReceipts(facts, sepStart))).toEqual({ netReceived: 20000, confirmedCount: 1, refundTotal: 0 });
  });

  it("end 边界为开区间：跨月回看互不串月", () => {
    const facts = { payments: [pay("p1", 20000, at(15)), pay("p2", 40000, octStart)], refunds: [] } satisfies Pick<FinanceFacts, "payments" | "refunds">;
    expect(periodReceiptSummary(periodReceipts(facts, sepStart, octStart)).netReceived).toBe(20000);
    expect(periodReceiptSummary(periodReceipts(facts, octStart)).netReceived).toBe(40000);
  });
});
