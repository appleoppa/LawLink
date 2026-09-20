import {assertNoPendingIntakeHandover} from "./handover";
/** 收案补正与送审轮次。所有写入在共用授权锁和 Serializable 事务中执行。 */
import {createHash,randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {resolveRoleUser} from '@/lib/roles/service';
import {scopeFor} from '@/lib/roles/catalog';
import {requireApprovalRoute} from '@/lib/approvals/service';
import {buildIntakeConflictQueries} from '@/lib/approvals/intake-detail';
import {decryptIdNumber} from '@/lib/clients/id-number-crypto';
import {runConflictCheck,conflictHitKey} from '@/server/conflicts/algorithm';
import {auditTx} from '@/server/audit';
export async function intakeWorkflowReady(db:Prisma.TransactionClient){const [r]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."IntakeRevision"') IS NOT NULL AS ready`;return r?.ready===true;}
export async function currentActor(db:Prisma.TransactionClient,userId:string,key:'matters.write'|'intakes.create'|'documents.write'|'schedule.write'){
 await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
 const user=await db.user.findUnique({where:{id:userId},select:{id:true,active:true,role:true}});if(!user?.active)throw new Error('账号已停用');
 const current=await resolveRoleUser(user.id,user.role,db);if(!current.enabled||(user.role==='CUSTOM'&&!scopeFor(current,key)))throw new Error('当前岗位无权处理');return current;
}
export async function assertIntakeEditor(db:Prisma.TransactionClient,userId:string,id:string,states=['INTAKE','NEEDS_REVISION'],key:'matters.write'|'intakes.create'|'documents.write'|'schedule.write'='matters.write'){
 await currentActor(db,userId,key);await db.$queryRaw`SELECT id FROM "Intake" WHERE id=${id} FOR UPDATE`;
 const intake=await db.intake.findUnique({where:{id}});if(!intake||(intake.createdById!==userId&&intake.ownerUserId!==userId))throw new Error('仅申请人或当前主办可以修改收案');
 if(!states.includes(intake.status))throw new Error('当前收案不可修改；待审批申请请先撤回');return intake;
}
export async function assertLiveAssignees(db:Prisma.TransactionClient,ids:string[]){
 for(const id of new Set(ids)){const u=await db.user.findUnique({where:{id},select:{active:true,role:true}});if(!u?.active)throw new Error('承办人员已停用或不存在，请重新指定');const role=await resolveRoleUser(id,u.role,db);if(!role.enabled||(u.role==='CUSTOM'&&!scopeFor(role,'matters.write')))throw new Error('承办人员已无办案权限，请重新指定');}
}
export const intakeFields=['title','category','causeId','causeFreeText','description','receivedAt','clientId','clientType','contactName','contactPhone','firstProcedureType','firstAgency','jurisdiction','ourStanding','claimAmount','claimDescription','barFiling','counterclaim','businessType','serviceScope','deliverables','counselType','serviceStart','serviceEnd','feeType','feeAmount','contingencyTerms','feeSchedule','feeNote','ownerUserId','coUserIds'] as const;
function ordered(value:unknown):unknown{if(Array.isArray(value))return value.map(ordered);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)]));return value;}
export function fingerprint(value:unknown){return createHash('sha256').update(JSON.stringify(ordered(JSON.parse(JSON.stringify(value))))).digest('hex');}
export async function intakeState(db:Prisma.TransactionClient,id:string){
 const i=await db.intake.findUniqueOrThrow({where:{id},include:{client:true,parties:{orderBy:[{role:'asc'},{ordinal:'asc'},{id:'asc'}]},documents:{where:{deletedAt:null},orderBy:{id:'asc'},select:{id:true,name:true,size:true,sha256:true,category:true}}}});
 const fields=Object.fromEntries(intakeFields.map(k=>[k,i[k]]));
 const parties=i.parties.map(({id:_id,intakeId:_intakeId,matterId:_matterId,createdAt:_createdAt,updatedAt:_updatedAt,...p})=>{void [_id,_intakeId,_matterId,_createdAt,_updatedAt];return p;});
 const queries=buildIntakeConflictQueries(i,decryptIdNumber);
 const snapshot={fields,parties,documents:i.documents,client:i.parties.some(p=>p.role==='CLIENT_PARTY')?null:i.client?{name:i.client.name,type:i.client.type,idType:i.client.idType,idNumber:i.client.idNumber}:null};
 const subjectFingerprint=fingerprint({queries,category:i.category,serviceScope:i.serviceScope,firstProcedureType:i.firstProcedureType,ourStanding:i.ourStanding,businessType:i.businessType});
 return {intake:i,snapshot,queries,subjectFingerprint,fingerprint:fingerprint(snapshot)};
}
export async function assertFreshIntakeCheck(db:Prisma.TransactionClient,id:string,requireConclusion=false){
 const state=await intakeState(db,id),check=await db.conflictCheck.findFirst({where:{intakeId:id},orderBy:{checkedAt:'desc'},include:{hits:true}});
 if(!check)throw new Error('请先运行本收案正式冲突检索');
 const [meta]=await db.$queryRaw<{subjectFingerprint:string|null}[]>`SELECT "subjectFingerprint" FROM "ConflictCheck" WHERE id=${check.id}`;
 if(meta.subjectFingerprint!==state.subjectFingerprint)throw new Error('主体、角色或服务范围已变化，请重新检索');
 if(requireConclusion&&check.conclusion!=='DIFFERENT')throw new Error('冲突核查尚未确认可承接');
 if(requireConclusion&&check.hits.length&&!check.note?.trim())throw new Error('有命中时必须填写排除冲突的复核理由');
 const current=await runConflictCheck(state.queries,{excludeIntakeId:id,db});
 const prior=new Set(check.hits.map(h=>`${conflictHitKey(h)}|${h.severity}|${h.reason}`));
 if(current.hits.some(h=>!prior.has(`${conflictHitKey(h)}|${h.severity}|${h.reason}`)))throw new Error('出现新的或变化的冲突命中，请重新检索并复核');
 return {...state,check};
}
export async function submitIntakeTx(db:Prisma.TransactionClient,userId:string,id:string){
 await assertNoPendingIntakeHandover(db,id);
 if(!await intakeWorkflowReady(db))throw new Error('收案轮次功能尚未启用');
 const i=await assertIntakeEditor(db,userId,id);
 await assertLiveAssignees(db,[i.ownerUserId??i.createdById,...i.coUserIds]);
 await requireApprovalRoute({action:'INTAKE_APPROVE',category:i.category,requesterId:i.createdById},db);
 const state=await assertFreshIntakeCheck(db,id);
 const [count]=await db.$queryRaw<{round:number}[]>`SELECT COALESCE(MAX(round),0)+1 AS round FROM "IntakeRevision" WHERE "intakeId"=${id}`;
 const people=await db.user.findMany({where:{id:{in:[i.ownerUserId??i.createdById,...i.coUserIds]}},select:{id:true,name:true}});
 const cause=i.causeId?await db.causeOfAction.findUnique({where:{id:i.causeId},select:{name:true}}):null;
 const snapshot={...state.snapshot,display:{people,cause: cause?.name??null},conflict:{id:state.check.id,queries:state.queries,hits:state.check.hits,conclusion:state.check.conclusion,note:state.check.note}};
 await db.$executeRaw`INSERT INTO "IntakeRevision" (id,"intakeId",round,snapshot,fingerprint,"checkId","submittedById") VALUES (${randomUUID()},${id},${count.round},${JSON.stringify(snapshot)}::jsonb,${state.fingerprint},${state.check.id},${userId})`;
 await db.intake.update({where:{id},data:{status:'PENDING_CONFIRMATION',declinedReason:null}});
 await db.$executeRaw`UPDATE "Intake" SET "workflowRevision"="workflowRevision"+1 WHERE id=${id}`;
 await auditTx(db,{userId,action:'INTAKE_SUBMIT_ROUND',targetType:'Intake',targetId:id,detail:{round:count.round,checkId:state.check.id,attachmentIds:state.intake.documents.map(d=>d.id)}});
 return {id,round:count.round};
}
export async function assertIntakeConvertible(db:Prisma.TransactionClient,id:string){
 await assertNoPendingIntakeHandover(db,id);
 if(!await intakeWorkflowReady(db))return;
 const state=await assertFreshIntakeCheck(db,id,true);
 await assertLiveAssignees(db,[state.intake.ownerUserId??state.intake.createdById,...state.intake.coUserIds]);
 const [round]=await db.$queryRaw<{fingerprint:string;checkId:string}[]>`SELECT fingerprint,"checkId" FROM "IntakeRevision" WHERE "intakeId"=${id} ORDER BY round DESC LIMIT 1`;
 if(!round||round.fingerprint!==state.fingerprint||round.checkId!==state.check.id)throw new Error('送审内容已变化，请撤回并重新提交');
}
export async function withdrawIntakeTx(db:Prisma.TransactionClient,userId:string,id:string,reason:string){
 if(!reason.trim())throw new Error('请填写撤回原因');await assertIntakeEditor(db,userId,id,['PENDING_CONFIRMATION']);
 await db.intake.update({where:{id},data:{status:'NEEDS_REVISION',declinedReason:reason.trim()}});
 await db.$executeRaw`UPDATE "Intake" SET "workflowRevision"="workflowRevision"+1 WHERE id=${id}`;
 await auditTx(db,{userId,action:'INTAKE_WITHDRAW',targetType:'Intake',targetId:id,detail:{reason:reason.trim()}});return {id};
}
export async function assertIntakeDocumentChange(db:Prisma.TransactionClient,userId:string,intakeId:string,documentId?:string){
 if(!await intakeWorkflowReady(db))return;
 await assertIntakeEditor(db,userId,intakeId,undefined,'documents.write');
 if(documentId){const [used]=await db.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM "IntakeRevision" WHERE "intakeId"=${intakeId} AND snapshot->'documents' @> ${JSON.stringify([{id:documentId}])}::jsonb`;if(Number(used.count))throw new Error('该材料已固定于送审轮次，请保留原件并上传补正材料');}
}
