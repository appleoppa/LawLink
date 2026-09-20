// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { allocationInput, dueBucket, summarizeLedger, type LedgerReceivable, type LedgerPayment } from "@/lib/finance/ledger";
const d = (value: number) => new Prisma.Decimal(value);
const ar: LedgerReceivable = { id:"ar",matterId:"m",title:"应收",amount:d(100000),settledAmount:d(40000),adjustmentAmount:d(0),status:"OPEN",dueDate:null,dueState:"UNKNOWN",dueCondition:null,conditionSatisfiedAt:null,billingId:null,moneyKind:"LAWYER_FEE",revision:0 };
const payment: LedgerPayment = {id:"p",matterId:"m",amount:d(40000),allocatedAmount:d(40000),refundedAmount:d(0),feeEntryId:"f",occurredAt:new Date(),sourceValid:true,moneyKind:"LAWYER_FEE",revision:0};
describe("统一账务口径", () => {
  it("分期收 4 万再收 6 万，余额 6 万再归零", () => {
    expect(summarizeLedger([ar],[payment]).outstanding).toBe("60000.00");
    expect(summarizeLedger([{...ar,settledAmount:d(100000)}],[payment,{...payment,id:"p2",amount:d(60000),allocatedAmount:d(60000)}])).toMatchObject({outstanding:"0.00",netReceived:"100000.00",unallocated:"0.00"});
  });
  it("代收款单列，不算律师费", () => {
    expect(summarizeLedger([ar],[payment,{...payment,id:"client",moneyKind:"CLIENT_FUNDS"}])).toMatchObject({netReceived:"80000.00",lawyerFeeReceived:"40000.00",clientFundsReceived:"40000.00"});
  });
  it("来源异常直接报错，不生成缩水的统计或历史待核口径", () => {
    expect(() => summarizeLedger([ar],[{...payment,sourceValid:false}])).toThrow("实收来源不一致");
  });
  it("调整本金、退款与未核销按 Decimal 计算", () => {
    expect(summarizeLedger([{...ar,adjustmentAmount:d(-20000)}],[{...payment,refundedAmount:d(10000),allocatedAmount:d(20000)}])).toMatchObject({outstanding:"40000.00",netReceived:"30000.00",unallocated:"10000.00"});
  });
  it("未知日期、条件待成就不伪装未到期，上海跨日才逾期", () => {
    expect(dueBucket(ar)).toBe("UNKNOWN");
    expect(dueBucket({...ar,dueState:"CONDITIONAL"})).toBe("CONDITIONAL");
    const known = {...ar,dueState:"DATE_SET",dueDate:new Date("2026-09-19T00:00:00+08:00")};
    expect(dueBucket(known,new Date("2026-09-19T15:59:59Z"))).toBe("NOT_DUE");
    expect(dueBucket(known,new Date("2026-09-19T16:00:00Z"))).toBe("OVERDUE");
  });
  it.each(["0","-1","0.001","1e4","NaN","Infinity","", "10000000000"])("拒绝无效金额 %s", amount => {
    expect(allocationInput.safeParse({paymentId:"p",revision:0,kind:"INVOICE",items:[{targetId:"i",amount}]}).success).toBe(false);
  });
  it("拒绝重复目标与缺少版本", () => {
    expect(allocationInput.safeParse({paymentId:"p",revision:0,kind:"RECEIVABLE",items:[{targetId:"ar",amount:"0.10"},{targetId:"ar",amount:"0.20"}]}).success).toBe(false);
    expect(allocationInput.safeParse({paymentId:"p",kind:"INVOICE",items:[{targetId:"i",amount:"1"}]}).success).toBe(false);
  });
});
