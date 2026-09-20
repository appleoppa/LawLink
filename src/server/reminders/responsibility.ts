/** 事项责任与生命周期；创建触发器覆盖人工、导入与规则生成入口。 */
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {matterAssociationFilter} from '@/lib/permissions';
import {currentActor,assertLiveAssignees} from '@/server/intakes/workflow';
import {retireScheduleReminders} from './schedule';
import {auditTx} from '@/server/audit';
export async function responsibilityReady(db:Prisma.TransactionClient){const [r]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."WorkResponsibility"') IS NOT NULL AS ready`;return r?.ready===true;}
export type WorkRow={id:string;targetId:string;kind:'Task'|'Deadline'|'Hearing'|'Urgent';matterId:string|null;intakeId:string|null;title:string;dueAt:Date|null;assigneeId:string;name:string;active:boolean;proposedAssigneeId:string|null;proposedName:string|null;acceptedAt:Date|null;state:'OPEN'|'DONE'|'CANCELLED';revision:number;reason:string|null};
/** 已有对象权限由调用方进一步按 matterId/intakeId/assignee 限定。 */
export async function readWorkRows(db:Prisma.TransactionClient){
 if(!await responsibilityReady(db))return [] as WorkRow[];
 return db.$queryRaw<WorkRow[]>`SELECT w.id,COALESCE(w."taskId",w."deadlineId",w."hearingId") AS "targetId",CASE WHEN w."taskId" IS NOT NULL THEN 'Task' WHEN w."deadlineId" IS NOT NULL THEN 'Deadline' ELSE 'Hearing' END AS kind,COALESCE(t."matterId",p."matterId") AS "matterId",NULL::text AS "intakeId",COALESCE(t.title,d.title,h.title) AS title,COALESCE(t."dueAt",d."dueAt",h."startsAt") AS "dueAt",w."assigneeId",u.name,(u.active AND (u.role<>'CUSTOM' OR (r.active IS TRUE AND EXISTS(SELECT 1 FROM "RolePermission" rp WHERE rp."roleId"=r.id AND rp."permissionKey"='matters.write')))) AS active,w."proposedAssigneeId",v.name AS "proposedName",w."acceptedAt",w.state::text,w.revision,w.reason FROM "WorkResponsibility" w LEFT JOIN "Task" t ON t.id=w."taskId" LEFT JOIN "Deadline" d ON d.id=w."deadlineId" LEFT JOIN "Hearing" h ON h.id=w."hearingId" LEFT JOIN "MatterProcedure" p ON p.id=COALESCE(d."procedureId",h."procedureId") JOIN "User" u ON u.id=w."assigneeId" LEFT JOIN "RoleDefinition" r ON r.id=u."roleDefinitionId" LEFT JOIN "User" v ON v.id=w."proposedAssigneeId"
 UNION ALL SELECT i.id,i.id,'Urgent',i."matterId",i."intakeId",i.title,i."dueAt",i."assigneeId",u.name,(u.active AND (u.role<>'CUSTOM' OR (r.active IS TRUE AND EXISTS(SELECT 1 FROM "RolePermission" rp WHERE rp."roleId"=r.id AND rp."permissionKey"='matters.write')))),i."proposedAssigneeId",v.name,i."acceptedAt",i.state::text,i.revision,i.reason FROM "IntakeUrgentItem" i JOIN "User" u ON u.id=i."assigneeId" LEFT JOIN "RoleDefinition" r ON r.id=u."roleDefinitionId" LEFT JOIN "User" v ON v.id=i."proposedAssigneeId"`;
}
export const workChangeInput=z.object({id:z.string().min(1),revision:z.number().int().nonnegative(),action:z.enum(['ACCEPT','PROPOSE','DECLINE','RESCHEDULE','COMPLETE','CANCEL','REOPEN']),reason:z.string().trim().max(1000).default(''),assigneeId:z.string().min(1).optional(),dueAt:z.coerce.date().optional()}).superRefine((v,c)=>{if(v.action!=='ACCEPT'&&!v.reason)c.addIssue({code:'custom',message:'请填写变更或处理原因'});if(v.action==='PROPOSE'&&!v.assigneeId)c.addIssue({code:'custom',message:'请选择接收人'});if(v.action==='RESCHEDULE'&&!v.dueAt)c.addIssue({code:'custom',message:'请填写新日期'});});
export async function changeWorkTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof workChangeInput>){
 const d=workChangeInput.parse(input);await currentActor(db,userId,'schedule.write');
 if(!await responsibilityReady(db))throw new Error('事项责任功能尚未启用');
 const row=(await readWorkRows(db)).find(r=>r.id===d.id);if(!row)throw new Error('事项不存在');
 const table=row.kind==='Urgent'?'IntakeUrgentItem':'WorkResponsibility';
 await db.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id=${row.id} FOR UPDATE`);
 if(row.revision!==d.revision)throw new Error('事项已变化，请刷新');
 // 归档案件：正常变更通道关闭，但保留 CANCEL 兜底——否则混合迁移状态下遗留的
 // OPEN 事项既不能办结也不能作废，提醒永不停（2026-09-19 审计）。
 if(row.matterId&&await db.matter.count({where:{id:row.matterId,status:'ARCHIVED'}})&&d.action!=='CANCEL')throw new Error('归档案件的办案事项不可变更，仅可作废');
 const recipient=(d.action==='ACCEPT'||d.action==='DECLINE')&&row.proposedAssigneeId===userId;
 if(!recipient){
  if(row.matterId){if(!await db.matter.count({where:{id:row.matterId,deletedAt:null,...matterAssociationFilter(userId)}}))throw new Error('无权处理此案件事项');}
  else {const intake=row.intakeId?await db.intake.findUnique({where:{id:row.intakeId},select:{createdById:true,ownerUserId:true,coUserIds:true}}):null;if(!intake||![intake.createdById,intake.ownerUserId,...intake.coUserIds].includes(userId))throw new Error('无权处理此收案事项');}
 }
 if(d.action==='REOPEN'){if(row.state==='OPEN')throw new Error('事项仍在办理');}
 else if(row.state!=='OPEN')throw new Error('事项已结束，请先重开');
 if(d.action==='ACCEPT'&&userId!==(row.proposedAssigneeId??row.assigneeId))throw new Error('只有指定责任人可以承接');
 if(d.action==='DECLINE'&&userId!==row.proposedAssigneeId)throw new Error('只有待接收人可以退回交接');
 if(d.action==='PROPOSE'){
  await assertLiveAssignees(db,[d.assigneeId!]);if(d.assigneeId===row.assigneeId)throw new Error('接收人与原责任人相同');
  if(row.matterId&&!await db.matter.count({where:{id:row.matterId,...matterAssociationFilter(d.assigneeId!)}}))throw new Error('请先将接收人加入本案团队');
  if(!row.matterId){const intake=await db.intake.findUniqueOrThrow({where:{id:row.intakeId!}});if(![intake.createdById,intake.ownerUserId,...intake.coUserIds].includes(d.assigneeId!))throw new Error('接收人须为本收案经办');}
 }
 const nextOwner=d.action==='ACCEPT'?(row.proposedAssigneeId??row.assigneeId):row.assigneeId;
 if(d.action==='ACCEPT'||d.action==='REOPEN')await assertLiveAssignees(db,[nextOwner]);
 const nextState=d.action==='COMPLETE'?'DONE':d.action==='CANCEL'?'CANCELLED':d.action==='REOPEN'?'OPEN':row.state;
 const proposed=d.action==='PROPOSE'?d.assigneeId!:['ACCEPT','DECLINE','CANCEL','COMPLETE'].includes(d.action)?null:row.proposedAssigneeId;
 const accepted=d.action==='ACCEPT'?new Date():['RESCHEDULE','REOPEN'].includes(d.action)?null:row.acceptedAt;
 await db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET "assigneeId"=${nextOwner},"proposedAssigneeId"=${proposed},"acceptedAt"=${accepted},state=${nextState}::"WorkItemState",reason=${d.reason||row.reason},"closedAt"=${nextState==='OPEN'?null:new Date()},revision=revision+1 WHERE id=${row.id}`);
 if(row.kind==='Task')await db.task.update({where:{id:row.targetId},data:{assigneeId:nextOwner,completed:nextState!=='OPEN',completedAt:nextState==='OPEN'?null:new Date(),...(d.action==='RESCHEDULE'?{dueAt:d.dueAt}: {})}});
 if(row.kind==='Deadline')await db.deadline.update({where:{id:row.targetId},data:{completed:nextState!=='OPEN',completedAt:nextState==='OPEN'?null:new Date(),...(d.action==='RESCHEDULE'?{dueAt:d.dueAt,confirmStatus:'ADJUSTED',adjustedAt:new Date(),adjustedById:userId}: {})}});
 if(row.kind==='Hearing'&&d.action==='RESCHEDULE'){const h=await db.hearing.findUniqueOrThrow({where:{id:row.targetId}});await db.hearing.update({where:{id:row.targetId},data:{startsAt:d.dueAt,endsAt:h.endsAt?new Date(d.dueAt!.getTime()+h.endsAt.getTime()-h.startsAt.getTime()):null}});}
 if(row.kind==='Urgent'&&d.action==='RESCHEDULE')await db.$executeRaw`UPDATE "IntakeUrgentItem" SET "dueAt"=${d.dueAt!} WHERE id=${row.id}`;
 if(row.kind==='Deadline'||row.kind==='Hearing')await retireScheduleReminders(db,row.kind,row.targetId);
 if(row.kind==='Urgent')await db.notification.updateMany({where:{refType:'IntakeUrgentItem',refId:row.id},data:{read:true,readAt:new Date(),content:'事项已调整，请以当前记录为准'}});
 if(['CANCEL','COMPLETE','RESCHEDULE'].includes(d.action)&&row.assigneeId!==userId)await db.notification.create({data:{userId:row.assigneeId,type:'SYSTEM',priority:'HIGH',title:'负责事项已调整',content:`${row.title}；${d.reason}`,href:'/schedule',refType:'WorkResponsibility',refId:row.id}});
 if(d.action==='PROPOSE')await db.notification.create({data:{userId:d.assigneeId!,type:'SYSTEM',priority:'HIGH',title:'事项待承接',content:row.title,href:'/schedule',refType:'WorkResponsibility',refId:row.id}});
 await auditTx(db,{userId,action:`WORK_ITEM_${d.action}`,targetType:row.kind,targetId:row.targetId,detail:{reason:d.reason,previousRevision:row.revision,previousAssigneeId:row.assigneeId,assigneeId:nextOwner,proposedAssigneeId:proposed,previousDate:row.dueAt?.toISOString(),newDate:d.dueAt?.toISOString()}});
 return row;
}
/** 供旧入口、日历及通知统一排除已经取消/完成的开庭。 */
export async function closedHearingIds(db:Prisma.TransactionClient){if(!await responsibilityReady(db))return [] as string[];const rows=await db.$queryRaw<{id:string}[]>`SELECT "hearingId" AS id FROM "WorkResponsibility" WHERE "hearingId" IS NOT NULL AND state<>'OPEN'`;return rows.map(r=>r.id);}
