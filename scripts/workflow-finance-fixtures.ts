/** 独立验收的合成数据。只接受经过调用方身份校验的测试库；不用于业务写入或生产 seed。 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { MoneyKind } from "../src/lib/finance/ledger-labels";
export async function fixtureBilling(db: Prisma.TransactionClient, matterId: string, amount: number, id: string = randomUUID()) {
  await db.$executeRaw`INSERT INTO "Billing" (id,"matterId",title,"contractAmount",status,"signedAt","moneyKind","updatedAt") VALUES (${id},${matterId},'合成收费合同',${amount},'ACTIVE',NOW(),'LAWYER_FEE',NOW())`;
  return { id };
}
export async function fixtureReceivable(db: Prisma.TransactionClient, matterId: string, amount: number, options: { id?: string; billingId?: string; moneyKind?: MoneyKind; settledAmount?: number } = {}) {
  const id = options.id ?? randomUUID();
  await db.$executeRaw`INSERT INTO "Receivable" (id,"matterId","billingId",title,amount,"moneyKind","settledAmount","updatedAt") VALUES (${id},${matterId},${options.billingId ?? null},'合成分期应收',${amount},${options.moneyKind ?? 'LAWYER_FEE'}::"MoneyKind",${options.settledAmount ?? 0},NOW())`;
  return { id };
}
export async function fixtureReceipt(db: Prisma.TransactionClient, matterId: string, amount: number, recordedById: string, confirmedById: string, options: { id?: string; feeId?: string; moneyKind?: MoneyKind; allocatedAmount?: number } = {}) {
  const id = options.id ?? randomUUID(), feeId = options.feeId ?? randomUUID(), kind = options.moneyKind ?? 'LAWYER_FEE';
  await db.$executeRaw`INSERT INTO "FeeEntry" (id,"matterId",type,amount,"recordedById","confirmState","confirmedById","confirmedAt","moneyKind","updatedAt") VALUES (${feeId},${matterId},'RECEIVED',${amount},${recordedById},'CONFIRMED',${confirmedById},NOW(),${kind}::"MoneyKind",NOW())`;
  await db.$executeRaw`INSERT INTO "Payment" (id,"matterId","feeEntryId",amount,"recordedById","moneyKind","allocatedAmount","updatedAt") VALUES (${id},${matterId},${feeId},${amount},${confirmedById},${kind}::"MoneyKind",${options.allocatedAmount ?? 0},NOW())`;
  return { id, feeId };
}
