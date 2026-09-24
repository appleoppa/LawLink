// 内部 helper：仅供服务端 action 事务内调用，不做鉴权（调用方已过 requireSession）。
// 不能放 "use server" 文件里导出——事务客户端不可序列化，客户端伪造调用虽会在运行时抛错，
// 但任何从 "use server" 模块导出的函数都会成为可寻址的 RPC 入口（规约见 server/notifications/create.ts）。
import { Prisma } from "@prisma/client";
import {randomBytes} from 'node:crypto';
import {financeLedgerReady} from './ledger-storage';
import { ActionError } from "@/lib/action-error";

/** 切换前既有入口的基线写入。新账本启用后一律拒绝，不作为旧账转换入口。 */
export async function insertFinanceRowTx<T extends Record<string,unknown>>(tx:Prisma.TransactionClient,model:'Billing'|'Receivable'|'Payment'|'FeeEntry'|'FinanceCorrection',data:T):Promise<T&{id:string}>{
  if(await financeLedgerReady(tx))throw new ActionError('请通过新财务登记与更正流程处理');
  const metadata=Prisma.dmmf.datamodel.models.find(m=>m.name===model)!;
  const id=`c${randomBytes(12).toString('hex')}`;
  const values={...data,id,...(metadata.fields.some(f=>f.name==='updatedAt')?{updatedAt:new Date()}:{})};
  const entries=Object.entries(values).filter(([,value])=>value!==undefined);
  for(const [key] of entries)if(!metadata.fields.some(f=>f.name===key&&f.kind!=='object'))throw new ActionError('财务字段无效');
  await tx.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(`"${model}"`)} (${Prisma.join(entries.map(([key])=>Prisma.raw(`"${key}"`)))}) VALUES (${Prisma.join(entries.map(([key,value])=>{const field=metadata.fields.find(f=>f.name===key)!;return field.kind==='enum'?Prisma.sql`${value}::${Prisma.raw(`"${field.type}"`)}`:Prisma.sql`${value}`;}))})`);
  return {...data,id};
}

/** Billing 签署时生成应收（在 createBilling 事务内调用） */
export async function generateReceivableForBilling(
  tx: Prisma.TransactionClient,
  input: { matterId: string; billingId: string; title: string; amount: Prisma.Decimal; dueDate?: Date | null }
) {
  await insertFinanceRowTx(tx,'Receivable',{
      matterId: input.matterId,
      billingId: input.billingId,
      title: input.title,
      amount: input.amount,
      dueDate: input.dueDate ?? null
  });
}

/** 收款确认时生成实收（在 confirmFeeEntry 事务内调用） */
export async function generatePaymentForReceivedEntry(
  tx: Prisma.TransactionClient,
  input: { matterId: string; feeEntryId: string; amount: Prisma.Decimal; occurredAt: Date; recordedById: string }
) {
  await insertFinanceRowTx(tx,'Payment',{
      matterId: input.matterId,
      feeEntryId: input.feeEntryId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      recordedById: input.recordedById
  });
}
