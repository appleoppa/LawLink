// @vitest-environment node
import { describe,it,expect } from "vitest";
import { Prisma } from "@prisma/client";
import { correctionInput,commissionReversal,commissionPosition } from "@/lib/finance/corrections";
import { canExecuteFinance } from "@/lib/roles/catalog";
const d=(n:string|number)=>new Prisma.Decimal(n);
describe("账务更正边界",()=>{
 it("多次分级退款累计舍入，到全额退款时分成准确归零",()=>{
  let prior=d(0);for(let i=1;i<=100;i++){const delta=commissionReversal(d("0.33"),d(1),d(i).div(100),prior);expect(delta.gte(0)).toBe(true);prior=prior.plus(delta);}expect(prior.toFixed(2)).toBe("0.33");
 });
 it("分成计提调整不伪装为实际扣回",()=>{
  const p=commissionPosition(d(30000),d(-6000),d(30000),d(0));expect(p.accrued.toFixed(2)).toBe("24000.00");expect(p.recoverable.toFixed(2)).toBe("6000.00");expect(p.recovered.toFixed(2)).toBe("0.00");
 });
 it("更正确认和分成支付独立于到账确认及管理权",()=>{
  expect(canExecuteFinance({role:"PRINCIPAL_LAWYER",managerAuthorized:true},"finance.correct")).toBe(false);
  expect(canExecuteFinance({role:"CUSTOM",rolePermissions:[{permissionKey:"finance.confirm",scope:"ALL"}]},"finance.correct")).toBe(false);
  expect(canExecuteFinance({role:"CUSTOM",rolePermissions:[{permissionKey:"finance.correct",scope:"ALL"}]},"finance.settle")).toBe(false);
  expect(canExecuteFinance({role:"CUSTOM",rolePermissions:[{permissionKey:"finance.correct",scope:"ALL"}]},"finance.correct")).toBe(true);
 });
 it("不能通过折让免除另一笔债权或重复指定同一关系",()=>{
  const base={targetId:"ar",revision:0,type:"DISCOUNT",amount:"1",occurredAt:new Date(),reason:"原因",voucherReference:"凭据"};
  expect(correctionInput.safeParse({...base,waivers:[{targetId:"b",amount:"1"}]}).success).toBe(false);
  expect(correctionInput.safeParse({...base,allocationReversals:[{targetId:"a",amount:"0.50"},{targetId:"a",amount:"0.50"}]}).success).toBe(false);
 });
});
