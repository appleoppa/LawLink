import { describe, expect, it } from "vitest";
import { reconcileInvoiceReceipts } from "@/lib/finance/invoice-reconciliation";

const invoice = { id: "i1", matterId: "m1", invoiceNo: "001", amount: 100000 };
const receipt = { matterId: "m1", invoiceNo: "001", amount: 10000, confirmState: "CONFIRMED" };
const reconcile = (invoices = [invoice], receipts = [receipt], uncertain = new Set<string>()) => reconcileInvoiceReceipts(invoices, receipts, uncertain);

describe("旧票款核对", () => {
  it("十万元发票收到一万元仍保留九万元待收参考额", () => {
    expect(reconcile()[0]).toMatchObject({ status: "PARTIAL", received: 10000, outstanding: 90000 });
  });
  it("跨案同号不串款，待确认实收不计入", () => {
    expect(reconcile([invoice], [{ ...receipt, matterId: "m2" }, { ...receipt, confirmState: "PENDING" }])[0])
      .toMatchObject({ status: "UNPAID", received: 0, outstanding: 100000 });
  });
  it("同案重复票号保留待核，不能把一笔款抵两张票", () => {
    expect(reconcile([invoice, { ...invoice, id: "i2" }]).every((r) => r.status === "REVIEW" && r.outstanding === null)).toBe(true);
  });
  it("退款、更正、无票号款项及超额收款均不自动判定结清", () => {
    expect(reconcile([invoice], [receipt], new Set(["m1"]))[0].status).toBe("REVIEW");
    expect(reconcile([invoice], [{ ...receipt, invoiceNo: "" }])[0].status).toBe("REVIEW");
    expect(reconcile([invoice], [{ ...receipt, amount: 110000 }])[0].status).toBe("REVIEW");
  });
  it("完全同额只提示号码金额相符，不能冒充已建立正式关联", () => {
    expect(reconcile([invoice], [{ ...receipt, amount: 100000 }])[0])
      .toMatchObject({ status: "REVIEW", outstanding: null, reason: expect.stringContaining("正式金额关联") });
  });
  it("金额使用精确小数，全量累计不受五百条显示上限影响", () => {
    const result = reconcile([{ ...invoice, amount: 100 }], Array.from({ length: 601 }, () => ({ ...receipt, amount: 0.1 })))[0];
    expect(result).toMatchObject({ received: 60.1, outstanding: 39.9, status: "PARTIAL" });
  });
});
