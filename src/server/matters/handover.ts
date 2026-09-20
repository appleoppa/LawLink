/** 主办交接：接收确认前保留原主办；紧急接管须独立权限。 */
import {randomUUID} from 'node:crypto';import {Prisma} from '@prisma/client';import {z} from 'zod';
import {resolveRoleUser} from '@/lib/roles/service';import {scopeFor} from '@/lib/roles/catalog';
import {assertLiveAssignees,fingerprint,currentActor} from '@/server/intakes/workflow';
import {readWorkRows,responsibilityReady} from '@/server/reminders/responsibility';
import {retireScheduleReminders} from '@/server/reminders/schedule';import {auditTx} from '@/server/audit';
export async function handoverSnapshot(db:Prisma.TransactionClient,matterId:string){
 // 指纹只覆盖实质内容：不含 updatedAt 等易变列——加材料备注、改程序联系法官等
 // 无关改动不应阻断接收人 ACCEPT（2026-09-19 审计）；实质变化仍会改变指纹。
 const matter=await db.matter.findUniqueOrThrow({where:{id:matterId},select:{id:true,title:true,ownerId:true,status:true}});
 const procedures=await db.matterProcedure.findMany({where:{matterId,status:{not:'CONCLUDED'}},orderBy:{id:'asc'},select:{id:true,type:true,customLabel:true,leadLawyerId:true}});
 const work=(await readWorkRows(db)).filter(w=>w.matterId===matterId&&w.state==='OPEN').sort((a,b)=>a.id.localeCompare(b.id));
 const pendingReceipts=await db.feeEntry.findMany({where:{matterId,type:'RECEIVED',confirmState:'PENDING'},orderBy:{id:'asc'},select:{id:true,recordedById:true,amount:true}});
 const invoices=await db.invoiceRequest.findMany({where:{matterId,status:{in:['PENDING','APPROVED']}},orderBy:{id:'asc'},select:{id:true,title:true,status:true}});
 const seals=await db.sealRequest.findMany({where:{matterId,status:{in:['PENDING','APPROVED']}},orderBy:{id:'asc'},select:{id:true,documentTitle:true,status:true}});
 const preservations=await db.preservationCase.findMany({where:{matterId,status:{in:['ACTIVE','RENEWED']}},orderBy:{id:'asc'},select:{id:true,ownerId:true,targets:{select:{properties:{select:{id:true,status:true,expiryDate:true}}}}}});
 const workEssential=work.map(w=>({id:w.id,kind:w.kind,title:w.title,dueAt:w.dueAt?.toISOString()??null,assigneeId:w.assigneeId,name:w.name,proposedAssigneeId:w.proposedAssigneeId,state:w.state}));
 const snapshot={matter,procedures,work:workEssential,pendingReceipts,invoices,seals,preservations};return {snapshot,fingerprint:fingerprint(snapshot)};
}
async function actor(db:Prisma.TransactionClient,userId:string){await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;const u=await db.user.findUnique({where:{id:userId},select:{active:true,role:true}});if(!u?.active)throw new Error('账号不可用');const r=await resolveRoleUser(userId,u.role,db);if(!r.enabled)throw new Error('岗位已停用');return r;}
async function transfer(db:Prisma.TransactionClient,matterId:string,from:string,to:string,accepted:boolean){
 await assertLiveAssignees(db,[to]);
 await db.matter.update({where:{id:matterId,ownerId:from},data:{ownerId:to}});
 await db.matterMember.updateMany({where:{matterId,userId:from,role:'LEAD'},data:{role:'CO_LEAD'}});
 await db.matterMember.upsert({where:{matterId_userId:{matterId,userId:to}},create:{matterId,userId:to,role:'LEAD'},update:{role:'LEAD'}});
 await db.matterProcedure.updateMany({where:{matterId,leadLawyerId:from,status:{not:'CONCLUDED'}},data:{leadLawyerId:to}});
 await db.preservationCase.updateMany({where:{matterId,ownerId:from,status:{in:['ACTIVE','RENEWED']}},data:{ownerId:to}});
 const work=(await readWorkRows(db)).filter(w=>w.matterId===matterId&&w.assigneeId===from&&w.state==='OPEN');
 for(const w of work){const table=w.kind==='Urgent'?'IntakeUrgentItem':'WorkResponsibility';await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET "assigneeId"=${to},"proposedAssigneeId"=NULL,"acceptedAt"=${accepted?new Date():null},revision=revision+1 WHERE id=${w.id}`);if(w.kind==='Task')await db.task.update({where:{id:w.targetId},data:{assigneeId:to}});if(w.kind==='Deadline'||w.kind==='Hearing')await retireScheduleReminders(db,w.kind,w.targetId);}
}
export const handoverInput=z.object({matterId:z.string().cuid(),toUserId:z.string().cuid(),emergency:z.boolean().default(false),reason:z.string().trim().min(1,'请填写交接原因').max(2000)});
export async function requestHandoverTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof handoverInput>){
 const d=handoverInput.parse(input),role=await actor(db,userId);if(!await responsibilityReady(db))throw new Error('责任交接尚未启用');
 const matter=await db.matter.findUniqueOrThrow({where:{id:d.matterId},select:{ownerId:true,status:true,deletedAt:true}});if(matter.deletedAt||matter.status==='ARCHIVED')throw new Error('归档或删除案件不可更换主办');
 if(d.emergency){if(scopeFor(role,'matters.transfer')!=='ALL')throw new Error('应急接管须独立的全所责任交接权限');}
 else {await currentActor(db,userId,'matters.write');if(matter.ownerId!==userId)throw new Error('普通交接只能由当前主办发起');}
 if(d.toUserId===matter.ownerId)throw new Error('接收人已经是本案主办');await assertLiveAssignees(db,[d.toUserId]);
 const [pending]=await db.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM "MatterHandover" WHERE "matterId"=${d.matterId} AND status='PENDING'`;if(Number(pending.count))throw new Error('本案已有待接收交接，请先处理或撤销');
 const before=await handoverSnapshot(db,d.matterId);
 if(d.emergency)await transfer(db,d.matterId,matter.ownerId,d.toUserId,false);
 const current=d.emergency?await handoverSnapshot(db,d.matterId):before,id=randomUUID();
 await db.$executeRaw`INSERT INTO "MatterHandover" (id,"matterId","fromUserId","toUserId","initiatedById",emergency,reason,snapshot,fingerprint) VALUES (${id},${d.matterId},${matter.ownerId},${d.toUserId},${userId},${d.emergency},${d.reason},${JSON.stringify(before.snapshot)}::jsonb,${current.fingerprint})`;
 await db.notification.create({data:{userId:d.toUserId,type:'SYSTEM',priority:'URGENT',title:d.emergency?'案件已应急接管，请确认承接':'案件待交接确认',content:`${before.snapshot.matter.title}；${d.reason}`,href:'/schedule',refType:'MatterHandover',refId:id}});
 await auditTx(db,{userId,action:d.emergency?'MATTER_EMERGENCY_TRANSFER':'MATTER_HANDOVER_REQUEST',targetType:'MatterHandover',targetId:id,detail:{matterId:d.matterId,fromUserId:matter.ownerId,toUserId:d.toUserId,reason:d.reason}});return {id,matterId:d.matterId};
}
export async function decideHandoverTx(db:Prisma.TransactionClient,userId:string,id:string,revision:number,decision:'ACCEPTED'|'CANCELLED',reason:string){
 const role=await actor(db,userId);if(!await responsibilityReady(db))throw new Error('责任交接尚未启用');
 const [h]=await db.$queryRaw<{id:string;matterId:string;fromUserId:string;toUserId:string;initiatedById:string;emergency:boolean;status:string;revision:number;fingerprint:string}[]>`SELECT * FROM "MatterHandover" WHERE id=${id} FOR UPDATE`;
 if(!h||h.revision!==revision||h.status!=='PENDING')throw new Error('交接已处理或发生变化');
 if(decision==='ACCEPTED'){
  if(h.toUserId!==userId)throw new Error('只能由接收人确认');await assertLiveAssignees(db,[userId]);
  if((await handoverSnapshot(db,h.matterId)).fingerprint!==h.fingerprint)throw new Error('待办或责任清单已变化，请发起人刷新交接清单后重新确认');
  if(!h.emergency)await transfer(db,h.matterId,h.fromUserId,h.toUserId,true);
  else {for(const w of (await readWorkRows(db)).filter(w=>w.matterId===h.matterId&&w.assigneeId===userId&&w.state==='OPEN')){const table=w.kind==='Urgent'?'IntakeUrgentItem':'WorkResponsibility';await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET "acceptedAt"=NOW(),revision=revision+1 WHERE id=${w.id}`);}}
 }else {
  if(h.emergency){
   // 兜底出边：接收人失能（停用/失去办案权）时 ACCEPT 与普通 CANCEL 都走不通，
   // 由持全所责任交接权限者（即有权发起应急接管的同一批人）撤销；原主办仍有效则回转责任，否则仅解除锁定便于另发交接。
   if(scopeFor(role,'matters.transfer')!=='ALL')throw new Error('应急接管已生效，仅持全所责任交接权限者可撤销；请另行交接');
   if(!reason.trim())throw new Error('请填写撤销原因');
   try{await transfer(db,h.matterId,h.toUserId,h.fromUserId,false);}catch{/* 原主办已不可承接：责任保持现状，仅解除待接收锁定 */}
  } else {if(h.initiatedById!==userId&&h.toUserId!==userId)throw new Error('仅发起人或接收人可以退回交接');if(!reason.trim())throw new Error('请填写撤销或退回原因');}
 }
 await db.$executeRaw`UPDATE "MatterHandover" SET status=${decision}::"HandoverState",revision=revision+1,"reviewedAt"=NOW() WHERE id=${id}`;
 await auditTx(db,{userId,action:`MATTER_HANDOVER_${decision}`,targetType:'MatterHandover',targetId:id,detail:{matterId:h.matterId,reason}});
 await db.notification.create({data:{userId:h.initiatedById,type:'SYSTEM',title:decision==='ACCEPTED'?'案件交接已确认':'案件交接已退回',content:reason||'接收人已承接本案及固定清单事项',href:'/schedule',refType:'MatterHandover',refId:id}});return {matterId:h.matterId};
}
export async function refreshHandoverTx(db:Prisma.TransactionClient,userId:string,id:string,revision:number){
 const role=await actor(db,userId);const [h]=await db.$queryRaw<{matterId:string;initiatedById:string;toUserId:string;emergency:boolean;revision:number;status:string}[]>`SELECT * FROM "MatterHandover" WHERE id=${id} FOR UPDATE`;
 if(!h||h.status!=='PENDING'||h.revision!==revision)throw new Error('交接已变化');if(h.initiatedById!==userId&&!(h.emergency&&scopeFor(role,'matters.transfer')==='ALL'))throw new Error('仅发起人可更新交接清单');
 const current=await handoverSnapshot(db,h.matterId);await db.$executeRaw`UPDATE "MatterHandover" SET snapshot=${JSON.stringify(current.snapshot)}::jsonb,fingerprint=${current.fingerprint},revision=revision+1 WHERE id=${id}`;
 await auditTx(db,{userId,action:'MATTER_HANDOVER_REFRESH',targetType:'MatterHandover',targetId:id,detail:{matterId:h.matterId}});return {matterId:h.matterId};
}
