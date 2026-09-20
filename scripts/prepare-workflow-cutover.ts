/** 只读生成本地切换方案；--trial 仅在新建合成库执行，绝不写入来源库。 */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Prisma, PrismaClient} from '@prisma/client';
import {insertFinanceRowTx} from '../src/server/finance/allocation-internals';
import {seedWorkflowDemo} from './seed-workflow-demo';

const schema='prisma/schema.prisma';
const migration='docs/BUSINESS-WORKFLOW-FINANCE-MIGRATION-20260919.sql';
const output='docs/BUSINESS-WORKFLOW-LOCAL-CUTOVER-20260919.sql';
const preserved=new Set(['User','UserIdentityDocument','RoleDefinition','RolePermission','Team','TeamMember','CauseOfAction','CustomFieldDef','DeadlineRule','StageTemplate','SystemSetting','DocumentTemplate','SealTypeConfig','SealPurposeConfig','ApprovalPermissionGroup','ApprovalPermissionMember','ApprovalPermissionRule','AuditLog','ExternalCallLog','FirmFile','Announcement','ExternalContact']);
const special=new Set(['Document','Notification','JobQueue']);
const business=new Set(['Client','Contact','Intake','Matter','MatterMember','MatterClient','MatterProcedure','MatterStage','Task','Hearing','Deadline','ProcedureMemo','Party','ProcedureParty','RelatedEntity','MatterLink','ConflictCheck','ConflictHit','Note','InvoiceRequest','Receivable','Payment','Allocation','FinanceCorrection','Engagement','EngagementMatter','EvidenceItem','Billing','FeeEntry','CommissionPlan','TimelineEvent','ArchiveRecord','DocumentFolder','SealRequest','SmsMessage','PreservationCase','PreservationTarget','PreservationProperty','PreservationPropertyRenewal','ExpressTracking','ReviewRecord']);
const models=Prisma.dmmf.datamodel.models;
const ident=(value:string)=>`"${value.replaceAll('"','""')}"`;
const literal=(value:string)=>`'${value.replaceAll("'","''")}'`;
const table=(name:string)=>ident(models.find(m=>m.name===name)!.dbName??name);
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const source=new PrismaClient({log:[]});
let trial:PrismaClient|undefined;
function cli(args:string[],url:string){const r=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args],{env:{...process.env,DATABASE_URL:url},encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error('独立库 SQL 执行失败，原始连接信息不回显');return r.stdout;}
function body(database:string){
  for(const m of models)assert(preserved.has(m.name)||business.has(m.name)||special.has(m.name),`未分类模型 ${m.name}`);
  const deleting=new Set([...business,'Document']);
  const order:string[]=[];
  while(deleting.size){
    const next=[...deleting].find(name=>!models.some(m=>m.name!==name&&deleting.has(m.name)&&m.fields.some(f=>f.kind==='object'&&f.type===name&&(f.relationFromFields?.length??0)>0)));
    assert(next,'业务外键存在循环，禁止盲目级联清理');order.push(next);deleting.delete(next);
  }
  const notification=`"refType" ~ '^(Matter|Intake|Task|Deadline|Hearing|DueReminder:|WorkResponsibility|Invoice|SealRequest|Archive|Document|FeeEntry|Finance|Payment|Receivable|Conflict|Preservation|Express)' OR href ~ '^/(matters|intakes|finance|inbox|approvals|archive)(/|[?]|$)'`;
  const predicates=new Map<string,string>(order.map(name=>[name,name==='Document'?`NOT EXISTS (SELECT 1 FROM "DocumentTemplate" t WHERE t."docxBlobId"="Document".id)`:'TRUE']));
  predicates.set('Notification',notification);predicates.set('JobQueue','TRUE');
  const keep=[...preserved].sort().map(name=>({name,query:`SELECT * FROM ${table(name)}`}));
  keep.push({name:'DocumentTemplateBlobs',query:'SELECT d.* FROM "Document" d JOIN "DocumentTemplate" t ON t."docxBlobId"=d.id'});
  const snapshot=(name:string,query:string)=>`SELECT ${literal(name)} AS name, count(*) AS n, md5(COALESCE(string_agg(row_to_json(x)::text,E'\\n' ORDER BY row_to_json(x)::text),'')) AS hash FROM (${query}) x`;
  const preservedQuery=keep.map(k=>snapshot(k.name,k.query)).join('\nUNION ALL\n');
  const sql=`-- 本地模拟业务重建；账号、配置、模板、审计及磁盘文件保留。\n-- 基线 schema SHA256: ${digest(schema)}\n-- 财务及工作流迁移 SHA256: ${digest(migration)}\n-- 停止应用写入并备份本地库后，另行取得执行确认。\nBEGIN;\nSET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='120s';\nDO $$ BEGIN IF current_database()<>${literal(database)} THEN RAISE EXCEPTION '目标库不匹配'; END IF; IF to_regclass('public."WorkResponsibility"') IS NOT NULL THEN RAISE EXCEPTION '新流程已经存在，禁止重复清空'; END IF; END $$;\nLOCK TABLE ${models.map(m=>table(m.name)).join(', ')} IN SHARE ROW EXCLUSIVE MODE;\nDO $$ BEGIN IF EXISTS (SELECT 1 FROM "Document" d JOIN "DocumentTemplate" t ON t."docxBlobId"=d.id WHERE d."matterId" IS NOT NULL OR d."intakeId" IS NOT NULL OR d."procedureId" IS NOT NULL OR d."folderId" IS NOT NULL OR d."stageId" IS NOT NULL) THEN RAISE EXCEPTION '模板原件挂靠业务对象，须先单独处置'; END IF; END $$;\nCREATE TEMP TABLE cutover_preserved ON COMMIT DROP AS ${preservedQuery};\n${[...predicates].map(([name,predicate])=>`DELETE FROM ${table(name)} WHERE ${predicate};`).join('\n')}\nDO $$ BEGIN IF EXISTS ((${preservedQuery}) EXCEPT SELECT * FROM cutover_preserved) OR EXISTS (SELECT * FROM cutover_preserved EXCEPT (${preservedQuery})) THEN RAISE EXCEPTION '保留对象核对失败'; END IF; END $$;\n`;
  const migrationBody=readFileSync(migration,'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  return {sql:sql+`\n-- 同一事务安装新模型，失败回滚清理。\n${migrationBody}\nCOMMIT;\n`,predicates};
}
async function main(){
  assert(process.env.DATABASE_URL,'缺少连接配置');const url=new URL(process.env.DATABASE_URL);
  assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'本脚本仅支持本机数据库');
  const [current]=await source.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."WorkResponsibility"') IS NOT NULL AS ready`;
  assert(!current.ready,'本机已切换到新流程，此脚本仅用于切换前准备，禁止重复清理');
  assert(readFileSync(migration,'utf8').includes(`基线 schema SHA256: ${digest(schema)}`),'迁移与当前模型不一致');
  const [{name}]=await source.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
  assert(!/^lawlink_workflow_trial_/.test(name),'来源必须是本机业务库，不能误用测试库');
  const plan=body(name);writeFileSync(output,plan.sql);
  const impact=[];
  for(const [model,predicate] of plan.predicates){const [r]=await source.$queryRawUnsafe<{n:bigint}[]>(`SELECT count(*) AS n FROM ${table(model)} WHERE ${predicate}`);impact.push({model,deleteCount:Number(r.n)});}
  const keep=[];for(const model of [...preserved].sort()){const [r]=await source.$queryRawUnsafe<{n:bigint}[]>(`SELECT count(*) AS n FROM ${table(model)}`);keep.push({model,count:Number(r.n)});}
  const report={database:name,sqlSha256:digest(output),impact,preserved:keep};
  writeFileSync('docs/BUSINESS-WORKFLOW-LOCAL-CUTOVER-IMPACT-20260919.json',JSON.stringify(report,null,2)+'\n');
  console.log(`Read-only plan generated: ${impact.find(x=>x.model==='Matter')?.deleteCount} matters, ${impact.find(x=>x.model==='Intake')?.deleteCount} intakes; ${keep.find(x=>x.model==='User')?.count} users preserved.`);
  if(!process.argv.includes('--trial'))return;
  const database=`lawlink_workflow_trial_${new Date().toISOString().slice(0,10).replaceAll('-','')}_${randomBytes(4).toString('hex')}`;
  await source.$executeRawUnsafe(`CREATE DATABASE ${ident(database)} TEMPLATE template0`);url.pathname=`/${database}`;url.searchParams.set('schema','public');
  const baseline=join(tmpdir(),`${database}-baseline.sql`);writeFileSync(baseline,cli(['migrate','diff','--from-empty','--to-schema-datamodel',schema,'--script'],url.toString()));cli(['db','execute','--schema',schema,'--file',baseline],url.toString());
  trial=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
  const user=await trial.user.create({data:{name:'重建保留验证',email:`${database}@example.invalid`,passwordHash:'NO-LOGIN',active:true,role:'LAWYER'}});
  const doc=await trial.document.create({data:{name:'合成模板原文件',path:'no-file-test-only',uploadedById:user.id,tags:[]}});
  await trial.documentTemplate.create({data:{name:'保留模板',category:'BLANK',docxBlobId:doc.id,variables:[]}});
  await trial.systemSetting.create({data:{key:'cutover-preserve-test',value:{test:true}}});
  const c=await trial.client.create({data:{name:'合成客户',type:'INDIVIDUAL',tags:[]}});
  const i=await trial.intake.create({data:{title:'合成收案',ownerUserId:user.id,createdById:user.id,clientId:c.id}});
  const m=await trial.matter.create({data:{title:'合成案件',internalCode:'CUTOVER-TEST',ownerId:user.id,intakeId:i.id,primaryClientId:c.id}});
  await trial.task.create({data:{matterId:m.id,title:'合成旧任务'}});
  const baselineBill=await trial.$transaction(tx=>insertFinanceRowTx(tx,'Billing',{matterId:m.id,title:'切换前登记校验',contractAmount:new Prisma.Decimal(123),status:'ACTIVE',signedAt:new Date()}));
  assert.equal((await trial.billing.findUniqueOrThrow({where:{id:baselineBill.id}})).contractAmount.toFixed(2),'123.00');
  await trial.document.create({data:{matterId:m.id,name:'合成旧案材料',path:'no-file-test-only',uploadedById:user.id,tags:[]}});
  await trial.notification.create({data:{userId:user.id,type:'SYSTEM',title:'旧案通知',refType:'Matter',refId:m.id,href:`/matters/${m.id}`}});
  await trial.notification.create({data:{userId:user.id,type:'SYSTEM',title:'账号通知',refType:'User',refId:user.id,href:'/settings/profile'}});
  const actual=join(tmpdir(),`${database}-cutover.sql`);writeFileSync(actual,body(database).sql);cli(['db','execute','--schema',schema,'--file',actual],url.toString());
  assert.equal(await trial.matter.count(),0);assert.equal(await trial.intake.count(),0);assert.equal(await trial.client.count(),0);assert.equal(await trial.task.count(),0);
  assert.equal(await trial.user.count(),1);assert.equal(await trial.documentTemplate.count(),1);assert.equal(await trial.document.count(),1);assert.equal(await trial.systemSetting.count(),1);assert.equal(await trial.notification.count(),1);
  const fresh=await trial.matter.create({data:{title:'新流程验证',internalCode:'CUTOVER-FRESH',ownerId:user.id}});
  const done=await trial.task.create({data:{matterId:fresh.id,title:'新登记已完成',completed:true}});
  const [work]=await trial.$queryRaw<{state:string}[]>`SELECT state FROM "WorkResponsibility" WHERE "taskId"=${done.id}`;assert.equal(work.state,'DONE');
  await trial.task.create({data:{matterId:fresh.id,title:'新登记待承接'}});assert.equal(await trial.notification.count({where:{id:{startsWith:'assignment_'}}}),1);
  const samples=await seedWorkflowDemo(trial,user.id);
  assert.equal(samples.matterIds.length,3);
  assert.equal(await trial.feeEntry.count({where:{matterId:{in:samples.matterIds},type:'RECEIVED',confirmState:'PENDING'}}),1);
  assert.equal(await trial.payment.count({where:{matterId:{in:samples.matterIds}}}),0);
  const countBefore=await trial.matter.count();
  await assert.rejects(()=>seedWorkflowDemo(trial!,user.id),/演示样本已存在/);
  assert.equal(await trial.matter.count(),countBefore);
  assert.equal(await trial.user.count(),1);
  await assert.rejects(()=>trial!.$transaction(tx=>insertFinanceRowTx(tx,'Billing',{matterId:fresh.id,title:'拒绝旧入口',contractAmount:new Prisma.Decimal(1),status:'DRAFT'})),/新财务/);
  await trial.user.update({where:{id:user.id},data:{active:false}});
  writeFileSync('docs/BUSINESS-WORKFLOW-LOCAL-CUTOVER-TRIAL-20260919.json',JSON.stringify({database,sqlSha256:report.sqlSha256,passed:['模拟业务清空','账号与配置逐行摘要保持','模板与原文件保持','账号通知保持、业务通知清理','同一事务完成新模型安装','全新已完成事项状态正确','全新待办生成承接提醒','切换前基线写入正确、新模型拒绝旧入口','全新演示数据经正式登记服务生成，收款待确认','重复生成拒绝且无残留，不改变账号或配置'],sourceDatabaseUnchanged:true},null,2)+'\n');
  console.log(`PASS: local cutover rehearsal in ${database}; source database unchanged.`);
}
main().catch(e=>{console.error(e instanceof Prisma.PrismaClientKnownRequestError?`数据库校验失败 ${e.code}: ${String(e.meta?.message??'').replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')}`:e.message);process.exitCode=1;}).finally(async()=>{await trial?.$disconnect();await source.$disconnect();});
