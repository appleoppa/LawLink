/** 案件动态冲突复核：保留事实记录，以当前主体及服务范围计算是否需要复核。 */
import {Prisma} from '@prisma/client';
import {matterAssociationFilter} from '@/lib/permissions';
import {buildIntakeConflictQueries} from '@/lib/approvals/intake-detail';
import {decryptIdNumber} from '@/lib/clients/id-number-crypto';
import {currentActor,fingerprint,intakeWorkflowReady} from '@/server/intakes/workflow';
import {runConflictCheck,conflictHitKey} from './algorithm';
import {auditTx} from '@/server/audit';
import { ActionError } from "@/lib/action-error";
export async function matterReviewState(db:Prisma.TransactionClient,id:string){
 const m=await db.matter.findUniqueOrThrow({where:{id},include:{parties:{orderBy:{id:'asc'}},primaryClient:true,procedures:{orderBy:{id:'asc'},select:{id:true,type:true,engagement:true,isExternalLead:true,procedureParties:{orderBy:{id:'asc'},select:{partyId:true,standing:true,ordinal:true}}}}}});
 const queries=buildIntakeConflictQueries({client:m.primaryClient,parties:m.parties},decryptIdNumber);
 const scopes=await db.$queryRaw`SELECT s.* FROM "BillingProcedureScope" s JOIN "Billing" b ON b.id=s."billingId" WHERE b."matterId"=${id} AND b.status='ACTIVE' ORDER BY s."billingId",s."procedureId"`;
 const subjectFingerprint=fingerprint({queries,category:m.category,serviceScope:m.serviceScope,procedures:m.procedures,scopes});return {m,queries,subjectFingerprint};
}
async function assertReviewer(db:Prisma.TransactionClient,userId:string,matterId:string){
 await currentActor(db,userId,'matters.write');
 if(!await db.matter.count({where:{id:matterId,deletedAt:null,status:{not:'ARCHIVED'},...matterAssociationFilter(userId)}}))throw new ActionError('仅本案经办可以复核在办案件');
 if(!await intakeWorkflowReady(db))throw new ActionError('动态冲突复核尚未启用');
}
export async function recordMatterReviewTx(db:Prisma.TransactionClient,userId:string,matterId:string,inheritedNote?:string){
 const state=await matterReviewState(db,matterId);
 if(!state.queries.length)throw new ActionError('请先登记本案当事人');
 const result=await runConflictCheck(state.queries,{excludeMatterId:matterId,excludeIntakeId:state.m.intakeId??undefined,db});
 const decided=Boolean(inheritedNote)||result.hits.length===0;
 const check=await db.conflictCheck.create({data:{queryPayload:{queries:state.queries},conclusion:decided?'DIFFERENT':'PENDING',note:inheritedNote??(decided?'系统检索未命中，仍须结合实际业务判断':null),decidedById:decided?userId:null,decidedAt:decided?new Date():null,hits:{create:result.hits.map(({hitType,targetType,targetId,matchedName,matchedField,matchedValue,matchedRatio,severity,reason})=>({hitType,targetType,targetId,matchedName,matchedField,matchedValue,matchedRatio,severity,reason}))}}});
 await db.$executeRaw`UPDATE "ConflictCheck" SET "matterId"=${matterId},"subjectFingerprint"=${state.subjectFingerprint} WHERE id=${check.id}`;
 await auditTx(db,{userId,action:'MATTER_CONFLICT_RUN',targetType:'ConflictCheck',targetId:check.id,detail:{matterId,hitCount:result.hits.length,inherited:Boolean(inheritedNote)}});return {id:check.id};
}
export async function runMatterReviewTx(db:Prisma.TransactionClient,userId:string,matterId:string){await assertReviewer(db,userId,matterId);return recordMatterReviewTx(db,userId,matterId);}
export async function decideMatterReviewTx(db:Prisma.TransactionClient,userId:string,matterId:string,checkId:string,conclusion:'DIFFERENT'|'SAME_SUBJECT'|'NEED_INFO',note:string){
 await assertReviewer(db,userId,matterId);if(!note.trim())throw new ActionError('请填写复核理由及处理措施');
 const state=await matterReviewState(db,matterId);
 const [row]=await db.$queryRaw<{id:string;subjectFingerprint:string}[]>`SELECT id,"subjectFingerprint" FROM "ConflictCheck" WHERE "matterId"=${matterId} ORDER BY "checkedAt" DESC,id DESC LIMIT 1`;
 if(!row||row.id!==checkId||row.subjectFingerprint!==state.subjectFingerprint)throw new ActionError('主体或范围已变化，请重新检索');
 const check=await db.conflictCheck.findUniqueOrThrow({where:{id:checkId},include:{hits:true}}),fresh=await runConflictCheck(state.queries,{excludeMatterId:matterId,excludeIntakeId:state.m.intakeId??undefined,db});
 const previous=new Set(check.hits.map(h=>`${conflictHitKey(h)}|${h.severity}|${h.reason}`));
 if(fresh.hits.some(h=>!previous.has(`${conflictHitKey(h)}|${h.severity}|${h.reason}`)))throw new ActionError('新增冲突命中，请重新检索');
 await db.conflictCheck.update({where:{id:checkId},data:{conclusion,note:note.trim(),decidedById:userId,decidedAt:new Date()}});
 await auditTx(db,{userId,action:'MATTER_CONFLICT_DECISION',targetType:'ConflictCheck',targetId:checkId,detail:{matterId,conclusion,note:note.trim()}});return {id:checkId};
}
/** 调用者已限定案件正文权限；不返回命中案件ID或全文。 */
export async function readMatterReview(db:Prisma.TransactionClient,matterId:string){
 if(!await intakeWorkflowReady(db))return null;
 const state=await matterReviewState(db,matterId);
 const ids=await db.$queryRaw<{id:string;subjectFingerprint:string}[]>`SELECT id,"subjectFingerprint" FROM "ConflictCheck" WHERE "matterId"=${matterId} ORDER BY "checkedAt" DESC,id DESC`;
 const rows=ids.length?await db.conflictCheck.findMany({where:{id:{in:ids.map(r=>r.id)}},orderBy:[{checkedAt:'desc'},{id:'desc'}],include:{hits:true,decidedBy:{select:{name:true}}}}):[];
 return {needsReview:!ids.length||ids[0].subjectFingerprint!==state.subjectFingerprint||rows[0]?.conclusion!=='DIFFERENT',checks:rows.map(r=>({id:r.id,checkedAt:r.checkedAt,conclusion:r.conclusion,note:r.note,decidedBy:r.decidedBy?.name,decidedAt:r.decidedAt,current:ids.find(x=>x.id===r.id)?.subjectFingerprint===state.subjectFingerprint,hits:r.hits.map(h=>({id:h.id,reason:h.reason,matchedName:h.matchedName,matchedValue:h.matchedValue,severity:h.severity}))}))};
}

/** 新范围正式进入办理前复核；事实登记和待办记录不受此门禁阻断。 */
export async function assertMatterReviewCurrent(db:Prisma.TransactionClient,matterId:string){
 const state=await matterReviewState(db,matterId);
 const [row]=await db.$queryRaw<{id:string;subjectFingerprint:string}[]>`SELECT id,"subjectFingerprint" FROM "ConflictCheck" WHERE "matterId"=${matterId} ORDER BY "checkedAt" DESC,id DESC LIMIT 1`;
 if(!row||row.subjectFingerprint!==state.subjectFingerprint)throw new ActionError('主体或代理范围已变化，请先在案件中完成动态冲突复核');
 const check=await db.conflictCheck.findUniqueOrThrow({where:{id:row.id},include:{hits:true}});if(check.conclusion!=='DIFFERENT')throw new ActionError('本案当前冲突复核尚未通过');
 const fresh=await runConflictCheck(state.queries,{excludeMatterId:matterId,excludeIntakeId:state.m.intakeId??undefined,db}),previous=new Set(check.hits.map(h=>`${conflictHitKey(h)}|${h.severity}|${h.reason}`));
 if(fresh.hits.some(h=>!previous.has(`${conflictHitKey(h)}|${h.severity}|${h.reason}`)))throw new ActionError('检索后新增相关命中，请重新复核再承接');
}
