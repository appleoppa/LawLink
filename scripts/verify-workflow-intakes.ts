/** 独立合成库：补正轮次、资料冻结、冲突时效与权限，不访问业务库。 */
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Prisma,PrismaClient} from '@prisma/client';
import {intakeState,submitIntakeTx,withdrawIntakeTx,assertIntakeConvertible,assertIntakeDocumentChange,assertFreshIntakeCheck} from '../src/server/intakes/workflow';
import {runMatterReviewTx,decideMatterReviewTx,readMatterReview} from '../src/server/conflicts/matter-review';
import {runConflictCheck} from '../src/server/conflicts/algorithm';
import {readIntakeRounds} from '../src/server/intakes/revision-history';
const init=new PrismaClient({log:[]}),database=process.env.WORKFLOW_TRIAL_DATABASE??'lawlink_workflow_trial_20260919_ef1a255e',prefix=`intakes-${randomUUID().slice(0,8)}`;let db:PrismaClient;let stage='connect';const results:string[]=[];let users:string[]=[];
const tx=<T>(f:(t:Prisma.TransactionClient)=>Promise<T>)=>db.$transaction(f,{isolationLevel:'Serializable',timeout:20000});
const bad=async(name:string,fn:()=>Promise<unknown>,pattern:RegExp)=>{await assert.rejects(fn,pattern);results.push(name);};
async function main(){assert.match(database,/^lawlink_workflow_trial_\d{8}_[a-f0-9]{8}$/);const url=new URL(process.env.DATABASE_URL!);assert.notEqual(url.pathname,`/${database}`);url.pathname=`/${database}`;db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});assert.equal((await db.$queryRaw<{name:string}[]>`SELECT current_database() AS name`)[0].name,database);
 const people=await Promise.all(['owner','approver','stranger'].map(role=>db.user.create({data:{name:prefix+role,email:`${prefix}-${role}@example.invalid`,passwordHash:'NO-LOGIN',role:'LAWYER'}})));users=people.map(u=>u.id);const [owner,approver,stranger]=users;
 await db.approvalPermissionGroup.create({data:{name:prefix,members:{create:{userId:approver}},rules:{create:{action:'INTAKE_APPROVE',caseScope:'ALL_CASES',categories:[],sealTypes:[]}}}});
 const intake=await db.intake.create({data:{title:prefix,category:'NON_LITIGATION',createdById:owner,ownerUserId:owner,parties:{create:{role:'CLIENT_PARTY',name:prefix+'委托方',partyType:'COMPANY',enterpriseSocialCode:'SYNTHETIC-'+prefix}}}});
 const doc=await db.document.create({data:{intakeId:intake.id,name:'原送审合同',path:'synthetic-no-file',uploadedById:owner,size:50,sha256:'a'.repeat(64)}});
 async function check(){return tx(async t=>{const state=await intakeState(t,intake.id),result=await runConflictCheck(state.queries,{excludeIntakeId:intake.id,db:t});const c=await t.conflictCheck.create({data:{intakeId:intake.id,queryPayload:{queries:state.queries},conclusion:result.hits.length?'PENDING':'DIFFERENT',hits:{create:result.hits.map(({hitType,targetType,targetId,matchedName,matchedField,matchedValue,matchedRatio,severity,reason})=>({hitType,targetType,targetId,matchedName,matchedField,matchedValue,matchedRatio,severity,reason}))}}});await t.$executeRaw`UPDATE "ConflictCheck" SET "subjectFingerprint"=${state.subjectFingerprint} WHERE id=${c.id}`;return c;});}
 stage='submission';await bad('没有正式检索不能送审',()=>tx(t=>submitIntakeTx(t,owner,intake.id)),/先运行/);await check();
 await bad('非申请人非主办不能送审',()=>tx(t=>submitIntakeTx(t,stranger,intake.id)),/仅申请人/);
 const pair=await Promise.allSettled([tx(t=>submitIntakeTx(t,owner,intake.id)),tx(t=>submitIntakeTx(t,owner,intake.id))]);assert.equal(pair.filter(r=>r.status==='fulfilled').length,1);results.push('并发送审只产生一个轮次');
 await bad('待审批不能追加材料',()=>tx(t=>assertIntakeDocumentChange(t,owner,intake.id)),/先撤回/);await tx(t=>assertIntakeConvertible(t,intake.id));results.push('完整有效轮次通过转案前复核');
 const first=(await readIntakeRounds(db,intake.id))[0];assert(first.documents.some(d=>d.id===doc.id));
 await tx(t=>withdrawIntakeTx(t,owner,intake.id,'补充备注'));await bad('原送审材料不能改写',()=>tx(t=>assertIntakeDocumentChange(t,owner,intake.id,doc.id)),/原件/);
 await db.intake.update({where:{id:intake.id},data:{description:'本轮补充备注'}});await tx(t=>assertFreshIntakeCheck(t,intake.id));results.push('仅补充备注不使主体检索失效');await tx(t=>submitIntakeTx(t,owner,intake.id));assert.equal((await readIntakeRounds(db,intake.id)).length,2);assert.deepEqual((await readIntakeRounds(db,intake.id))[1],first);results.push('第二轮不覆盖首轮字段和材料');
 await db.intake.update({where:{id:intake.id},data:{description:'模拟并发篡改'}});await bad('送审后资料变化阻止转案',()=>tx(t=>assertIntakeConvertible(t,intake.id)),/内容已变化/);await tx(t=>withdrawIntakeTx(t,owner,intake.id,'修改范围'));await db.intake.update({where:{id:intake.id},data:{serviceScope:'新服务范围'}});await bad('服务范围变化要求重检',()=>tx(t=>submitIntakeTx(t,owner,intake.id)),/范围已变化/);await check();
 await db.user.update({where:{id:owner},data:{active:false}});await bad('停用承办人不得重新提交',()=>tx(t=>submitIntakeTx(t,owner,intake.id)),/停用/);await db.user.update({where:{id:owner},data:{active:true}});
 const other=await db.matter.create({data:{title:prefix+'后出现冲突',internalCode:prefix+'other',ownerId:stranger,parties:{create:{role:'OPPOSING_PARTY',name:prefix+'委托方',partyType:'COMPANY'}}}});await bad('检索后新入库命中阻止送审',()=>tx(t=>submitIntakeTx(t,owner,intake.id)),/新的或变化/);
 const newCheck=await check();await tx(t=>submitIntakeTx(t,owner,intake.id));await bad('命中未复核不得转案',()=>tx(t=>assertIntakeConvertible(t,intake.id)),/尚未确认/);await db.conflictCheck.update({where:{id:newCheck.id},data:{conclusion:'DIFFERENT',note:'核对为同名不同主体',decidedById:owner,decidedAt:new Date()}});await tx(t=>assertIntakeConvertible(t,intake.id));results.push('完整复核意见可通过转案门槛');
 stage='matter-review';const m=await db.matter.create({data:{title:prefix,internalCode:prefix,ownerId:owner,parties:{create:{role:'CLIENT_PARTY',name:prefix+'委托方',partyType:'COMPANY'}}}});
 await bad('无关人员不能运行案件复核',()=>tx(t=>runMatterReviewTx(t,stranger,m.id)),/本案经办/);
 const review=await tx(t=>runMatterReviewTx(t,owner,m.id));assert.equal((await readMatterReview(db,m.id))?.needsReview,true);await tx(t=>decideMatterReviewTx(t,owner,m.id,review.id,'DIFFERENT','核对为不同主体'));assert.equal((await readMatterReview(db,m.id))?.needsReview,false);results.push('案件命中经人工复核后可消除待复核提示');
 await db.party.create({data:{matterId:m.id,role:'THIRD_PARTY',name:prefix+'法院新增第三人'}});assert.equal((await readMatterReview(db,m.id))?.needsReview,true);await bad('新增主体不能沿用旧结论',()=>tx(t=>decideMatterReviewTx(t,owner,m.id,review.id,'DIFFERENT','沿用')),/范围已变化/);results.push('新增法院主体可记录并触发复核');
 const foreign=await db.conflictCheck.findMany({where:{hits:{some:{targetId:other.id}}}});assert(foreign.length>0);
 const output=join(tmpdir(),`${prefix}.json`);writeFileSync(output,JSON.stringify({database,results},null,2));console.log(`PASS: ${results.length} intake and conflict checks; ${output}`);
}
main().catch(e=>{console.error(`FAIL ${stage}: ${e instanceof Prisma.PrismaClientKnownRequestError?e.code:e.message}`);process.exitCode=1;}).finally(async()=>{if(db){await db.user.updateMany({where:{id:{in:users}},data:{active:false}});await db.$disconnect();}await init.$disconnect();});
