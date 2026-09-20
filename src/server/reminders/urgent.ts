import {randomUUID,createHash} from 'node:crypto';import {Prisma} from '@prisma/client';import {z} from 'zod';
import {currentActor,assertLiveAssignees} from '@/server/intakes/workflow';import {responsibilityReady,readWorkRows} from './responsibility';import {auditTx} from '@/server/audit';import {shDayKey} from '@/lib/ui/sh-time';
export const urgentInput=z.object({intakeId:z.string().cuid(),title:z.string().trim().min(1).max(200),dueAt:z.coerce.date(),kind:z.enum(['TASK','DEADLINE','HEARING']),assigneeId:z.string().cuid(),basis:z.string().trim().min(1).max(1000)});
export async function createUrgentTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof urgentInput>){
 const d=urgentInput.parse(input);await currentActor(db,userId,'schedule.write');if(!await responsibilityReady(db))throw new Error('收案紧急事项尚未启用');
 const i=await db.intake.findUniqueOrThrow({where:{id:d.intakeId}});if(!['INTAKE','NEEDS_REVISION','PENDING_CONFIRMATION'].includes(i.status))throw new Error('只能在办理中的收案登记紧急事项');
 const team=[i.createdById,i.ownerUserId,...i.coUserIds];if(!team.includes(userId)||!team.includes(d.assigneeId))throw new Error('仅本收案经办可登记并承担紧急事项');await assertLiveAssignees(db,[d.assigneeId]);const id=randomUUID();
 await db.$executeRaw`INSERT INTO "IntakeUrgentItem" (id,"intakeId",title,"dueAt",kind,"assigneeId","acceptedAt",reason) VALUES (${id},${d.intakeId},${d.title},${d.dueAt},${d.kind},${d.assigneeId},${d.assigneeId===userId?new Date():null},${d.basis})`;
 await db.notification.create({data:{userId:d.assigneeId,type:'SYSTEM',priority:'URGENT',title:'收案紧急事项',content:`${d.title}；${d.basis}`,href:`/intakes/${d.intakeId}`,refType:'IntakeUrgentItem',refId:id}});
 await auditTx(db,{userId,action:'INTAKE_URGENT_CREATE',targetType:'IntakeUrgentItem',targetId:id,detail:{intakeId:d.intakeId,kind:d.kind,dueAt:d.dueAt.toISOString(),assigneeId:d.assigneeId,basis:d.basis}});return {id};
}
export async function assertNoOpenIntakeUrgency(db:Prisma.TransactionClient,id:string){if(!await responsibilityReady(db))return;const [r]=await db.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM "IntakeUrgentItem" WHERE "intakeId"=${id} AND state='OPEN'`;if(Number(r.count))throw new Error('仍有收案紧急事项，请逐项说明办结、取消或交接处置，并告知责任人后再拒绝接案');}
export async function transferIntakeUrgency(db:Prisma.TransactionClient,intakeId:string,matterId:string){if(await responsibilityReady(db))await db.$executeRaw`UPDATE "IntakeUrgentItem" SET "matterId"=${matterId},revision=revision+1 WHERE "intakeId"=${intakeId}`;}
/** 站内补扫，发送对象按当前责任核对；不向外部渠道发送。 */
export async function scanAdditionalWorkReminders(db:Prisma.TransactionClient,now=new Date()){
 if(!await responsibilityReady(db))return 0;let count=0;const today=new Date(`${shDayKey(now)}T00:00:00+08:00`);
 for(const w of (await readWorkRows(db)).filter(w=>w.state==='OPEN'&&w.active&&(w.kind==='Task'||w.kind==='Urgent'))){if(!w.dueAt)continue;const day=new Date(`${shDayKey(w.dueAt)}T00:00:00+08:00`),offset=Math.round((today.getTime()-day.getTime())/86400000);if(![-3,-1,0,1].includes(offset))continue;
 const id=`workreminder_${createHash('sha256').update(JSON.stringify([w.id,w.dueAt.toISOString(),w.assigneeId,shDayKey(now)])).digest('hex')}`;
 const current=w.kind==='Urgent'?Prisma.sql`SELECT i.id FROM "IntakeUrgentItem" i WHERE i.id=${w.id} AND i.revision=${w.revision} AND i.state='OPEN' AND i."assigneeId"=${w.assigneeId} AND i."dueAt"=${w.dueAt} FOR SHARE`:Prisma.sql`SELECT r.id FROM "WorkResponsibility" r JOIN "Task" t ON t.id=r."taskId" WHERE r.id=${w.id} AND r.revision=${w.revision} AND r.state='OPEN' AND r."assigneeId"=${w.assigneeId} AND t."dueAt"=${w.dueAt} FOR SHARE OF r,t`;
 count+=await db.$executeRaw(Prisma.sql`WITH current_item AS (${current}), valid_user AS (SELECT u.id FROM "User" u LEFT JOIN "RoleDefinition" r ON r.id=u."roleDefinitionId" WHERE u.id=${w.assigneeId} AND u.active AND (u.role<>'CUSTOM' OR (r.active AND EXISTS(SELECT 1 FROM "RolePermission" rp WHERE rp."roleId"=r.id AND rp."permissionKey"='matters.write')))) INSERT INTO "Notification" (id,"userId",type,priority,title,content,href,"refType","refId") SELECT ${id},${w.assigneeId},'SYSTEM',${offset>=0?'URGENT':'HIGH'}::"NotificationPriority",${`${offset>0?'事项已逾期':offset===0?'事项今日到期':'事项即将到期'}${w.acceptedAt?'':' · 待承接'}`},${w.title},${w.matterId?`/matters/${w.matterId}`:`/intakes/${w.intakeId}`},${w.kind==='Urgent'?'IntakeUrgentItem':'WorkResponsibility'},${w.id} FROM current_item,valid_user ON CONFLICT (id) DO NOTHING`);

 }return count;
}
