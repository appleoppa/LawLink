/** 批准与执行终止是不同事实，原批准不被覆盖。 */
import {randomUUID} from 'node:crypto';import {Prisma} from '@prisma/client';import {z} from 'zod';import {canApproveItem,canExecuteInvoice,approvalAudit} from '@/lib/approvals/service';import {resolveRoleUser} from '@/lib/roles/service';
import { ActionError } from "@/lib/action-error";
export type ExecutionKind='INVOICE'|'SEAL';
export async function terminationReady(db:Prisma.TransactionClient){const [r]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."ExecutionTermination"') IS NOT NULL AS ready`;return r?.ready===true;}
export async function executionTerminations(db:Prisma.TransactionClient){if(!await terminationReady(db))return [];return db.$queryRaw<{id:string;invoiceId:string|null;sealId:string|null;status:string;requestedById:string;reason:string;decisionNote:string|null;revision:number;createdAt:Date;decidedAt:Date|null}[]>`SELECT * FROM "ExecutionTermination" ORDER BY "createdAt" DESC,id DESC`;}
async function target(db:Prisma.TransactionClient,kind:ExecutionKind,id:string){return kind==='INVOICE'?db.invoiceRequest.findUniqueOrThrow({where:{id},select:{status:true,requestedById:true,matterId:true}}):db.sealRequest.findUniqueOrThrow({where:{id},select:{status:true,requestedById:true,matterId:true}});}
async function actor(db:Prisma.TransactionClient,userId:string){await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{active:true,role:true}});if(!u.active||!(await resolveRoleUser(userId,u.role,db)).enabled)throw new ActionError('当前账号或岗位不可用');}
/** 是否存在除 userId 外的第二名合格核实人（P1-7 共用判断：申请、决定、页面取数同源） */
export async function hasOtherTerminationResolver(db:Prisma.TransactionClient,userId:string,kind:ExecutionKind,id:string){
 const others=await db.user.findMany({where:{active:true,id:{not:userId}},select:{id:true}});
 for(const o of others)if(await canResolveTermination(db,o.id,kind,id))return true;return false;
}
export async function canResolveTermination(db:Prisma.TransactionClient,userId:string,kind:ExecutionKind,id:string){return kind==='INVOICE'?await canExecuteInvoice(userId,id,db)||await canApproveItem(userId,'INVOICE_APPROVE',id,db):await canApproveItem(userId,'SEAL_STAMP',id,db)||await canApproveItem(userId,'SEAL_APPROVE',id,db);}
export async function assertExecutionOpen(db:Prisma.TransactionClient,kind:ExecutionKind,id:string){const rows=await executionTerminations(db);if(rows.some(r=>(kind==='INVOICE'?r.invoiceId:r.sealId)===id&&['PENDING','CONFIRMED'].includes(r.status)))throw new ActionError('本申请执行已暂停或终止，请先处理终止申请');}
export async function requestTerminationTx(db:Prisma.TransactionClient,userId:string,kind:ExecutionKind,id:string,reason:string){
 const note=z.string().trim().min(1,'请填写终止原因').max(1500).parse(reason);await actor(db,userId);if(!await terminationReady(db))throw new ActionError('执行终止尚未启用');const row=await target(db,kind,id);
 if(row.status!=='APPROVED')throw new ActionError('只有已批准且尚未实际执行的申请可终止');
 if(row.requestedById!==userId&&!await canResolveTermination(db,userId,kind,id))throw new ActionError('无权申请终止');await assertExecutionOpen(db,kind,id);
 const hasOther=await hasOtherTerminationResolver(db,userId,kind,id),receivers: string[]=[];
 if(hasOther){const eligible=await db.user.findMany({where:{active:true,id:{not:userId}},select:{id:true}});
  for(const r of eligible)if(await canResolveTermination(db,r.id,kind,id))receivers.push(r.id);}
 // 单人执业/唯一持权人出口：无第二名合格人时允许申请人自决（决定端会再次现算核验），
 // 否则已批申请陷入「不可终止、不可驳回、阻塞归档」的三无死局（2026-09-19 审计）。
 const soleHolder=!hasOther&&await canResolveTermination(db,userId,kind,id);
 if(!receivers.length&&!soleHolder)throw new ActionError('没有可独立确认终止的人员，请先配置当前执行或审批权限');
 const requestId=randomUUID();await db.$executeRaw`INSERT INTO "ExecutionTermination" (id,"invoiceId","sealId","requestedById",reason) VALUES (${requestId},${kind==='INVOICE'?id:null},${kind==='SEAL'?id:null},${userId},${note})`;
 await approvalAudit(db,userId,`${kind}_TERMINATION_REQUEST`,id,{note,requestId,soleHolder});
 const notifyTargets=receivers.length?receivers:[userId];
 await db.notification.createMany({data:notifyTargets.map(uid=>({userId:uid,type:'SYSTEM' as const,priority:'HIGH' as const,title:soleHolder?'批准事项终止待自核（本所无其他有权人）':'批准事项终止待核实',content:note,href:`/approvals?type=${kind==='INVOICE'?'INVOICE_APPROVE':'SEAL_APPROVE'}&id=${id}`,refType:'ExecutionTermination',refId:requestId}))});return {id:requestId};
}
export async function decideTerminationTx(db:Prisma.TransactionClient,userId:string,id:string,revision:number,decision:'CONFIRMED'|'REJECTED'|'CANCELLED',note:string){
 const reason=z.string().trim().min(1,'请填写核实或撤回说明').max(1500).parse(note);await actor(db,userId);
 const request=(await executionTerminations(db)).find(r=>r.id===id);if(!request||request.status!=='PENDING'||request.revision!==revision)throw new ActionError('终止申请已处理或发生变化');
 const kind=request.invoiceId?'INVOICE':'SEAL',targetId=(request.invoiceId??request.sealId)!;const row=await target(db,kind,targetId);
 if(row.status!=='APPROVED')throw new ActionError('本申请已经执行或状态改变，不得终止');
 if(decision==='CANCELLED'){if(request.requestedById!==userId)throw new ActionError('仅终止申请人可以撤回');}
 else{
  if(!await canResolveTermination(db,userId,kind,targetId))throw new ActionError('须由当前有权的执行或审批人员核实');
  if(request.requestedById===userId){
   // 自决仅限「全所再无第二名合格人」的单人/唯一持权场景；决定时现算（共享判断），
   // 防止申请后授权面变化（新增合格人）仍被自决。
   if(await hasOtherTerminationResolver(db,userId,kind,targetId))throw new ActionError('须由另一位当前有权的执行或审批人员核实');
  }
 }
 const selfConfirm=decision!=='CANCELLED'&&request.requestedById===userId;
 await db.$executeRaw`UPDATE "ExecutionTermination" SET status=${decision}::"FinanceCorrectionStatus","decidedById"=${userId},"decidedAt"=NOW(),"decisionNote"=${reason},revision=revision+1 WHERE id=${id}`;
 await approvalAudit(db,userId,`${kind}_TERMINATION_${decision}`,targetId,{note:reason,requestId:id,selfConfirm});
 await db.notification.create({data:{userId:request.requestedById,type:'SYSTEM',title:decision==='CONFIRMED'?'批准事项已终止执行':'终止申请已处理',content:reason,href:'/approvals?tab=mine',refType:'ExecutionTermination',refId:id}});return {ok:true};
}
