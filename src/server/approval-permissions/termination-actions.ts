'use server';
import {z} from 'zod';import {prisma} from '@/lib/prisma';import {requireSession} from '@/lib/auth/session';import {approvalTransaction} from '@/lib/approvals/service';import {requireApprovalRecord} from './records';import {executionTerminations,terminationReady,canResolveTermination,hasOtherTerminationResolver,requestTerminationTx,decideTerminationTx,type ExecutionKind} from './termination';import {revalidatePath} from 'next/cache';
export async function getTermination(kind:ExecutionKind,id:string){
 z.enum(['INVOICE','SEAL']).parse(kind);const s=await requireSession('approval');const {row}=await requireApprovalRecord(s.user,{action:kind==='INVOICE'?'INVOICE_APPROVE':'SEAL_APPROVE',id});if(!await terminationReady(prisma))return null;
 const rows=(await executionTerminations(prisma)).filter(r=>(kind==='INVOICE'?r.invoiceId:r.sealId)===id),pending=rows.find(r=>r.status==='PENDING'),confirmed=rows.some(r=>r.status==='CONFIRMED');
 const canResolve=await canResolveTermination(prisma,s.user.id,kind,id);
 // P1-7：页面取数与执行端共用资格判断——申请人本人为唯一持权人（全所无第二名合格人）时
 // 自核确认在 UI 可达；服务端决定端仍会现算复核，防线不变。
 const soleResolver=Boolean(pending&&pending.requestedById===s.user.id&&canResolve&&!await hasOtherTerminationResolver(prisma,s.user.id,kind,id));
 return {rows,canRequest:!pending&&!confirmed&&['WAITING_INVOICE','WAITING_STAMP'].includes(row.status)&&(row.requesterId===s.user.id||canResolve),canDecide:Boolean(pending&&canResolve&&(pending.requestedById!==s.user.id||soleResolver)),soleResolver,canCancel:pending?.requestedById===s.user.id};
}
export async function requestTermination(kind:ExecutionKind,id:string,reason:string){z.enum(['INVOICE','SEAL']).parse(kind);const s=await requireSession('approval');await approvalTransaction(db=>requestTerminationTx(db,s.user.id,kind,id,reason));revalidatePath('/approvals');return {ok:true};}
export async function decideTermination(input:{id:string;revision:number;decision:'CONFIRMED'|'REJECTED'|'CANCELLED';note:string}){const d=z.object({id:z.string().min(1),revision:z.number().int().nonnegative(),decision:z.enum(['CONFIRMED','REJECTED','CANCELLED']),note:z.string().trim().min(1).max(1500)}).parse(input);const s=await requireSession('approval');await approvalTransaction(db=>decideTerminationTx(db,s.user.id,d.id,d.revision,d.decision,d.note));revalidatePath('/approvals');return {ok:true};}
