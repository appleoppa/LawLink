/** 服务结束核对与归档收尾；只接受当前事实，不推断历史完成。 */
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {resolveRoleUser} from '@/lib/roles/service';
import {scopeFor} from '@/lib/roles/catalog';
import {matterAssociationFilter} from '@/lib/permissions';
import {fingerprint} from '@/server/intakes/workflow';
import {readWorkRows} from '@/server/reminders/responsibility';
import {executionTerminations} from '@/server/approval-permissions/termination';
import {commissionPositions} from '@/server/finance/ledger-corrections';
import {readLedger} from '@/server/finance/ledger-storage';
import {auditTx} from '@/server/audit';
export async function closureReady(db:Prisma.TransactionClient){const [r]=await db.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public."ArchiveClosurePlan"') IS NOT NULL AS ready`;return r?.ready===true;}
export async function closureFacts(db:Prisma.TransactionClient,matterId:string){
 const procedures=await db.matterProcedure.findMany({where:{matterId,engagement:'ENGAGED',status:{not:'CONCLUDED'}},orderBy:{id:'asc'},select:{id:true,type:true,customLabel:true,status:true,leadLawyerId:true}});
 const work=(await readWorkRows(db)).filter(w=>w.matterId===matterId&&w.state==='OPEN').sort((a,b)=>a.id.localeCompare(b.id));
 const preservations=await db.preservationCase.findMany({where:{matterId,OR:[{status:{in:['ACTIVE','RENEWED']}},{targets:{some:{properties:{some:{status:{in:['ACTIVE','RENEWED']}}}}}}]},orderBy:{id:'asc'},select:{id:true,ownerId:true}});
 const handovers=await db.$queryRaw<{id:string}[]>`SELECT id FROM "MatterHandover" WHERE "matterId"=${matterId} AND status='PENDING' ORDER BY id`;
 const receipts=await db.feeEntry.findMany({where:{matterId,confirmState:'PENDING',type:'RECEIVED'},orderBy:{id:'asc'},select:{id:true,amount:true}});
 const invoices=await db.invoiceRequest.findMany({where:{matterId,status:{in:['PENDING','APPROVED']}},orderBy:{id:'asc'},select:{id:true,status:true}});
 const seals=await db.sealRequest.findMany({where:{matterId,status:{in:['PENDING','APPROVED']}},orderBy:{id:'asc'},select:{id:true,status:true}});
 const terminated=new Set((await executionTerminations(db)).filter(t=>t.status==='CONFIRMED').flatMap(t=>[t.invoiceId,t.sealId]));
 const pendingInvoices=invoices.filter(i=>!terminated.has(i.id)),pendingSeals=seals.filter(i=>!terminated.has(i.id));
 const corrections=await db.$queryRaw<{id:string}[]>`SELECT id FROM "FinanceCorrection" WHERE "matterId"=${matterId} AND status='PENDING' ORDER BY id`;
 const ledger=await readLedger(db,[matterId]);
 const positions=await commissionPositions(db,[matterId]);const commissionBalance=positions.reduce((s,p)=>s.plus(p.payable).plus(p.recoverable),new Prisma.Decimal(0));
 const finance={...ledger.summary,commissionBalance:commissionBalance.toFixed(2),invoiceOutstanding:ledger.invoices.reduce((sum,i)=>sum.plus(i.amount.minus(i.linked)),new Prisma.Decimal(0)).toFixed(2)};
 const blockers=[procedures.length&&`${procedures.length} 个代理程序未结束`,work.length&&`${work.length} 项任务、期限或开庭未处置`,preservations.length&&`${preservations.length} 项保全仍生效`,handovers.length&&`${handovers.length} 项交接待承接`,receipts.length&&`${receipts.length} 笔实收待确认`,pendingInvoices.length&&`${pendingInvoices.length} 项开票申请待审批或执行`,pendingSeals.length&&`${pendingSeals.length} 项用章申请待审批或执行`,corrections.length&&`${corrections.length} 项财务更正待处理`].filter(Boolean) as string[];
 // P1-4（2026-09-20 C 批）：一致性指纹只覆盖阻断性清单；实时财务数字独立展示（financeSnapshot）、
 // 允许归档后收尾漂移——此前财务进入指纹使「tail 收尾（放行）→ 补充归档（要求指纹一致）→
 // 重存收尾（ARCHIVED 禁改）」三 rule 互卡死锁，已归档案件从此无法补充归档且无出口。
 const snapshot={procedures,work,preservations,handovers,receipts,invoices:pendingInvoices,seals:pendingSeals,corrections};
 return {snapshot,fingerprint:fingerprint(snapshot),financeSnapshot:finance,blockers,financeOpen:[finance.outstanding,finance.unallocated,finance.commissionBalance,finance.invoiceOutstanding,finance.clientFundsReceived].some(n=>!new Prisma.Decimal(n).eq(0))};
}
export async function assertTailAuthority(db:Prisma.TransactionClient,userId:string,matterId:string){
 const u=await db.user.findUnique({where:{id:userId},select:{active:true,role:true}});if(!u?.active)throw new Error('收尾负责人账号无效');
 const role=await resolveRoleUser(userId,u.role,db);if(!role.enabled||scopeFor(role,'finance.tail')!=='ALL')throw new Error('归档后财务处理须独立的财务收尾权限');
 if(!await closureReady(db))throw new Error('归档收尾尚未启用');
 const [plan]=await db.$queryRaw<{financeOwnerId:string|null}[]>`SELECT "financeOwnerId" FROM "ArchiveClosurePlan" WHERE "matterId"=${matterId}`;
 if(plan?.financeOwnerId!==userId)throw new Error('只有本案指定的财务收尾负责人可以追加财务业务');
}
export const closureInput=z.object({matterId:z.string().cuid(),revision:z.number().int().nonnegative().nullable(),financeOwnerId:z.string().cuid().nullable(),serviceCompletedAt:z.coerce.date().refine(d=>d<=new Date(),'完成日期不能在未来'),reason:z.string().trim().min(1,'请说明服务完成及未结事项安排').max(2000)});
export async function saveClosureTx(db:Prisma.TransactionClient,userId:string,input:z.input<typeof closureInput>){
 const d=closureInput.parse(input);await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
 const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{role:true,active:true}}),role=await resolveRoleUser(userId,u.role,db);
 if(!u.active||!role.enabled||(u.role==='CUSTOM'&&!scopeFor(role,'archive.submit')))throw new Error('无提交归档权限');
 if(!await db.matter.count({where:{id:d.matterId,deletedAt:null,...matterAssociationFilter(userId)}}))throw new Error('仅本案经办可安排收尾');
 // P1-4（C 批）：归档审批通过后收尾安排随案卷冻结，服务完成事实不可再改；
 // 但收尾责任本身必须可交接——原收尾人离职/失能时若无出口，带未结财务的案件将无人能合法收尾。
 // 受限模式：仅允许更换收尾人（须填交接理由），资格＝matters.transfer 持有者或当前收尾人本人。
 const [mstate]=await db.$queryRaw<{status:string}[]>`SELECT status::text FROM "Matter" WHERE id=${d.matterId}`;
 const [plan]=await db.$queryRaw<{financeOwnerId:string|null;revision:number}[]>`SELECT "financeOwnerId",revision FROM "ArchiveClosurePlan" WHERE "matterId"=${d.matterId} FOR UPDATE`;
 if(mstate?.status==='ARCHIVED'){
  const role=await resolveRoleUser(userId,u.role,db);
  const canTransfer=role.role==='CUSTOM'&&scopeFor(role,'matters.transfer')==='ALL';
  if(!d.financeOwnerId)throw new Error('案件已归档，收尾安排已固定；仅可办理收尾责任交接（指定新收尾人）');
  if(!plan||!plan.financeOwnerId)throw new Error('本案原收尾安排未指定收尾人，无法办理交接');
  if(!canTransfer&&plan.financeOwnerId!==userId)throw new Error('归档后收尾交接须当前收尾人本人或持应急接管权限者办理');
  await db.$executeRaw`UPDATE "ArchiveClosurePlan" SET "financeOwnerId"=${d.financeOwnerId},reason=${d.reason},revision=revision+1,"updatedAt"=NOW() WHERE "matterId"=${d.matterId}`;
  await auditTx(db,{userId,action:'ARCHIVE_CLOSURE_HANDOVER',targetType:'Matter',targetId:d.matterId,detail:{previousFinanceOwnerId:plan.financeOwnerId,newFinanceOwnerId:d.financeOwnerId,reason:d.reason}});
  if(d.financeOwnerId!==userId)await db.notification.create({data:{userId:d.financeOwnerId,type:'SYSTEM',priority:'HIGH',title:'案件财务收尾责任已交接',content:d.reason,href:`/finance/reconciliation?matterId=${d.matterId}`,refType:'ArchiveClosurePlan',refId:d.matterId}});
  return {ok:true,handedOver:true};
 }
 if(!await closureReady(db))throw new Error('归档收尾尚未启用');
 if(d.financeOwnerId){const owner=await db.user.findUniqueOrThrow({where:{id:d.financeOwnerId},select:{active:true,role:true}}),r=await resolveRoleUser(d.financeOwnerId,owner.role,db);if(!owner.active||!r.enabled||scopeFor(r,'finance.tail')!=='ALL'||!scopeFor(r,'finance.read')||(scopeFor(r,'finance.read')!=='ALL'&&!await db.matter.count({where:{id:d.matterId,...matterAssociationFilter(d.financeOwnerId)}})))throw new Error('收尾负责人须有效并具有财务查看及独立收尾权限');}
 const facts=await closureFacts(db,d.matterId);if(facts.financeOpen&&!d.financeOwnerId)throw new Error('尚有未结财务，须明确有资格的收尾负责人');
 if((plan?.revision??null)!==d.revision)throw new Error('收尾安排已变化，请刷新');
 if(plan)await db.$executeRaw`UPDATE "ArchiveClosurePlan" SET "financeOwnerId"=${d.financeOwnerId},"serviceCompletedAt"=${d.serviceCompletedAt},reason=${d.reason},snapshot=${JSON.stringify(facts.snapshot)}::jsonb,fingerprint=${facts.fingerprint},revision=revision+1,"updatedAt"=NOW() WHERE "matterId"=${d.matterId}`;
 else await db.$executeRaw`INSERT INTO "ArchiveClosurePlan" (id,"matterId","financeOwnerId","serviceCompletedAt",reason,snapshot,fingerprint,"updatedAt") VALUES (${randomUUID()},${d.matterId},${d.financeOwnerId},${d.serviceCompletedAt},${d.reason},${JSON.stringify(facts.snapshot)}::jsonb,${facts.fingerprint},NOW())`;
 await auditTx(db,{userId,action:'ARCHIVE_CLOSURE_PLAN',targetType:'Matter',targetId:d.matterId,detail:{financeOwnerId:d.financeOwnerId,reason:d.reason,previousRevision:d.revision,fingerprint:facts.fingerprint}});
 if(d.financeOwnerId&&d.financeOwnerId!==userId)await db.notification.create({data:{userId:d.financeOwnerId,type:'SYSTEM',priority:'HIGH',title:'案件财务收尾责任已指定',content:d.reason,href:`/finance/reconciliation?matterId=${d.matterId}`,refType:'ArchiveClosurePlan',refId:d.matterId}});
 return {ok:true};
}
export async function assertClosureReady(db:Prisma.TransactionClient,matterId:string,expectedFingerprint?:string,options?:{supplement?:boolean}){
 if(!await closureReady(db))return null;
 const facts=await closureFacts(db,matterId);if(facts.blockers.length)throw new Error(`归档前请处置：${facts.blockers.join('；')}`);
 const [plan]=await db.$queryRaw<{financeOwnerId:string|null;serviceCompletedAt:Date;reason:string;fingerprint:string;revision:number}[]>`SELECT * FROM "ArchiveClosurePlan" WHERE "matterId"=${matterId}`;
 if(!plan)throw new Error('请先保存服务完成与财务收尾安排');
 // P1-4（C 批）：指纹只覆盖阻断性清单（财务已拆出）；补充归档不要求原收尾安排与当前一致——
 // 归档后 tail 收尾本就放行、财务必然漂移，原快照保持固定，本次补充另行冻结自己的快照。
 if(!options?.supplement&&plan.fingerprint!==facts.fingerprint)throw new Error('归档核对清单已变化，请重新保存收尾安排并送审');
 if(expectedFingerprint&&expectedFingerprint!==fingerprint({facts:facts.snapshot,plan}))throw new Error('归档核对清单已变化，请重新保存收尾安排并送审');
 if(facts.financeOpen&&!plan.financeOwnerId)throw new Error('尚有未结财务，请指定收尾负责人');
 if(plan.financeOwnerId)await assertTailAuthority(db,plan.financeOwnerId,matterId);
 return {facts:facts.snapshot,plan,fingerprint:fingerprint({facts:facts.snapshot,plan})};
}
