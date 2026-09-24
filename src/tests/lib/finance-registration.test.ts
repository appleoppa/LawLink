// @vitest-environment node
import { describe,it,expect } from "vitest";
import { billingRegistrationInput,receiptRegistrationInput } from "@/lib/finance/registration";
const bill={matterId:"matter",title:"委托收费",moneyKind:"LAWYER_FEE",amount:"100000",signedAt:new Date(),installments:[{title:"第一期",amount:"40000",dueState:"DATE_SET",dueDate:new Date()},{title:"第二期",amount:"60000",dueState:"CONDITIONAL",dueCondition:"交付成果"}]};
describe("新登记输入边界",()=>{
  it("收费总额与分期金额为非法文本时返回校验错误，不抛出计算异常",()=>{
    expect(billingRegistrationInput.safeParse({...bill,amount:"不是金额"}).success).toBe(false);
    expect(billingRegistrationInput.safeParse({...bill,installments:[{...bill.installments[0],amount:"不是金额"}]}).success).toBe(false);
  });
  it("分期总额与签署金额一致",()=>expect(billingRegistrationInput.safeParse(bill).success).toBe(true));
  it("拒绝分期尾差、超额与重复计算",()=>expect(billingRegistrationInput.safeParse({...bill,installments:[{...bill.installments[0],amount:"40000.01"},bill.installments[1]]}).success).toBe(false));
  it("条件及日期必须完整",()=>{expect(billingRegistrationInput.safeParse({...bill,installments:[{title:"一期",amount:"100000",dueState:"CONDITIONAL",dueCondition:" "}]}).success).toBe(false);expect(billingRegistrationInput.safeParse({...bill,installments:[{title:"一期",amount:"100000",dueState:"DATE_SET"}]}).success).toBe(false);});
  it("未签署不能生成应收",()=>expect(billingRegistrationInput.safeParse({...bill,signedAt:undefined}).success).toBe(false));
  it("零收费允许签署但不允许零额分期",()=>{expect(billingRegistrationInput.safeParse({...bill,amount:"0.00",installments:[]}).success).toBe(true);expect(billingRegistrationInput.safeParse({...bill,amount:0,installments:[{title:"一期",amount:0,dueState:"UNKNOWN"}]}).success).toBe(false);});
  it.each([undefined,"UNKNOWN","INVALID"])("款项性质 %s 不能自动推定",moneyKind=>expect(receiptRegistrationInput.safeParse({matterId:"matter",amount:"1",moneyKind,occurredAt:new Date()}).success).toBe(false));
  it.each(["-1","0","0.001","1e4"])("拒绝不合规实收金额 %s",amount=>expect(receiptRegistrationInput.safeParse({matterId:"matter",amount,moneyKind:"LAWYER_FEE",occurredAt:new Date()}).success).toBe(false));
});
