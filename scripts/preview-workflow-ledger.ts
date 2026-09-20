import {PERMISSIONS} from "../src/lib/roles/catalog";
import { registerReceiptTx,confirmReceiptTx } from "../src/server/finance/ledger-registration";
import { allocateLedgerTx } from "../src/server/finance/ledger-mutations";
import { fixtureReceivable } from "./workflow-finance-fixtures";
/** 本机独立库页面验收；复用当前会话签名，仅在测试库创建同 ID 的合成人员。退出后停用。 */
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
const source = new PrismaClient({log:[]});
let db: PrismaClient;
let previewUserId: string | undefined;
let colleagueId: string | undefined;
let child: ChildProcess | undefined;
async function main() {
  const database=process.env.WORKFLOW_TRIAL_DATABASE??'lawlink_workflow_trial_20260919_ef1a255e';
  if(!/^lawlink_workflow_trial_\d{8}_[a-f0-9]{8}$/.test(database))throw new Error('仅可预览独立测试库');
  const url=new URL(process.env.DATABASE_URL!);
  if(decodeURIComponent(url.pathname.slice(1))===database)throw new Error("源连接不能是测试库");
  // 只读取当前工作区用户标识及会话版本，不读取密码/证件/案件。
  const people=await source.user.findMany({where:{name:"叶森",active:true,systemRole:"SUPER_ADMIN"},select:{id:true,sessionVersion:true}});
  if(people.length!==1)throw new Error("不能唯一确定当前验收会话，请停止");
  previewUserId=people[0].id;
  url.pathname=`/${database}`;url.searchParams.set("schema","public");
  db=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
  const [identity]=await db.$queryRaw<{name:string}[]>`SELECT current_database() AS name`;
  if(identity.name!==database)throw new Error("测试库隔离校验失败");
  const existing=await db.user.findUnique({where:{id:previewUserId},select:{active:true,name:true,email:true}});
  if(existing && (existing.active || existing.name!=="独立测试库 · 财务验收" || !existing.email.endsWith("@example.invalid")))throw new Error("测试库已有其他人员，不覆盖");
  if(existing)await db.user.update({where:{id:previewUserId},data:{active:true,sessionVersion:people[0].sessionVersion}});
  else await db.user.create({data:{id:previewUserId,name:"独立测试库 · 财务验收",email:`preview-${randomUUID()}@example.invalid`,passwordHash:"NO-LOGIN",role:"FINANCE",sessionVersion:people[0].sessionVersion}});
  if(!/^lawlink_workflow_trial_\d{8}_[a-f0-9]{8}$/.test(database))throw new Error('仅可预览独立测试库');
  const role=await db.roleDefinition.create({data:{name:`preview-${randomUUID()}`,normalizedName:`preview-${randomUUID()}`,permissions:{create:PERMISSIONS.map(p=>({permissionKey:p.key,scope:(p.scopes as readonly string[]).includes('ALL')?'ALL':'OWN'}))}}});
  await db.user.update({where:{id:previewUserId},data:{role:'CUSTOM',roleDefinitionId:role.id}});
  const colleague=await db.user.create({data:{name:'合成协作律师',email:`colleague-${randomUUID()}@example.invalid`,passwordHash:'NO-LOGIN',role:'LAWYER'}});
  colleagueId=colleague.id;
  const matter=await db.matter.create({data:{internalCode:`UI-${randomUUID().slice(0,8).toUpperCase()}`,title:"仅供验收 · 十万元票款与应收",ownerId:previewUserId,members:{create:{userId:previewUserId,role:"LEAD"}}}});
  const first=await fixtureReceivable(db,matter.id,40000);
  await fixtureReceivable(db,matter.id,60000);
  const userId=previewUserId;
  const options={isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000};
  await db.commissionPlan.create({data:{matterId:matter.id,userId,percent:30,active:true}});
  const receipt=await db.$transaction(t=>registerReceiptTx(t,userId,{matterId:matter.id,amount:"40000",moneyKind:"LAWYER_FEE",occurredAt:new Date()}),options);
  await db.$transaction(t=>confirmReceiptTx(t,userId,receipt.id),options);
  const payment=await db.payment.findFirstOrThrow({where:{feeEntryId:receipt.id}});
  await db.$transaction(t=>allocateLedgerTx(t,userId,{paymentId:payment.id,revision:0,kind:"RECEIVABLE",items:[{targetId:first.id,amount:"40000"}]}),options);
  const invoice=await db.invoiceRequest.create({data:{matterId:matter.id,invoiceNo:"UI-TEST-100000",amount:100000,status:"ISSUED",requestedById:userId}});
  await db.$transaction(t=>allocateLedgerTx(t,userId,{paymentId:payment.id,revision:1,kind:"INVOICE",items:[{targetId:invoice.id,amount:"40000"}]}),options);
  const procedure=await db.matterProcedure.create({data:{matterId:matter.id,type:'FIRST_INSTANCE',order:1,status:'PENDING',leadLawyerId:userId}});
  await db.party.create({data:{matterId:matter.id,name:`合成当事人-${randomUUID().slice(0,8)}`,role:'CLIENT_PARTY',partyType:'NATURAL_PERSON'}});
  await db.task.create({data:{matterId:matter.id,title:'仅供验收 · 待承接与改期',dueAt:new Date()}});
  await db.hearing.create({data:{procedureId:procedure.id,title:'仅供验收 · 可取消开庭',startsAt:new Date(Date.now()+86400000)}});
  const intake=await db.intake.create({data:{title:'仅供验收 · 待补正收案',ownerUserId:userId,createdById:userId,status:'NEEDS_REVISION',category:'CIVIL_COMMERCIAL',clientType:'INDIVIDUAL',ourStanding:'PLAINTIFF',firstProcedureType:'FIRST_INSTANCE',coUserIds:[colleague.id]}});
  await db.party.create({data:{intakeId:intake.id,name:'合成补正委托人',role:'CLIENT_PARTY',partyType:'NATURAL_PERSON',standing:'PLAINTIFF'}});
  await db.approvalPermissionGroup.create({data:{name:`验收审批-${randomUUID()}`,members:{create:[{userId},{userId:colleague.id}]},rules:{create:[{action:'INTAKE_APPROVE',caseScope:'ALL_CASES',categories:[],sealTypes:[]},{action:'INVOICE_APPROVE',caseScope:'ALL_CASES',categories:[],sealTypes:[]}]}}});
  const approved=await db.invoiceRequest.create({data:{matterId:matter.id,amount:10000,status:'APPROVED',requestedById:colleague.id,processedById:userId,processedAt:new Date(),title:'仅供验收 · 批准后停止开票'}});
  console.log(`Intake: http://localhost:3100/intakes/${intake.id}`);
  console.log(`Matter: http://localhost:3100/matters/${matter.id}`);
  console.log(`Approval: http://localhost:3100/approvals?type=INVOICE_APPROVE&id=${approved.id}`);
  console.log(`Preview: http://localhost:3100/finance/reconciliation?matterId=${matter.id}`);
  await source.$disconnect();
  child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3100"],{stdio:"inherit",env:{...process.env,DATABASE_URL:url.toString(),DISABLE_CRON:"1",NEXTAUTH_URL:"http://localhost:3100",NEXT_DIST_DIR:"output/ledger-preview"}});
  child.on("exit",()=>{void cleanup();});
}
let closing=false;
async function cleanup() {
  if(closing)return;closing=true;
  child?.kill("SIGTERM");
  try {if(db && colleagueId)await db.user.updateMany({where:{id:colleagueId,email:{endsWith:"@example.invalid"},name:"合成协作律师"},data:{active:false}});if(db && previewUserId)await db.user.updateMany({where:{id:previewUserId,email:{endsWith:"@example.invalid"},name:"独立测试库 · 财务验收"},data:{active:false}});} finally {await db?.$disconnect();await source.$disconnect();}
}
process.on("SIGINT",()=>{void cleanup();});process.on("SIGTERM",()=>{void cleanup();});
main().catch(()=>{console.error("独立预览启动失败，未更改业务库");process.exitCode=1;void cleanup();});
