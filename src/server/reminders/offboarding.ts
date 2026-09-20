import {Prisma} from '@prisma/client';import {readWorkRows,responsibilityReady} from './responsibility';import {auditTx} from '@/server/audit';
/** 管理后台仅展示未交接数量，不借系统管理身份开放案件正文。 */
export async function responsibilityCounts(db:Prisma.TransactionClient){
 const result=new Map<string,number>();if(!await responsibilityReady(db))return result;
 const add=(id:string)=>result.set(id,(result.get(id)??0)+1);
 for(const w of await readWorkRows(db))if(w.state==='OPEN')add(w.assigneeId);
 for(const m of await db.matter.findMany({where:{deletedAt:null,status:{not:'ARCHIVED'}},select:{ownerId:true}}))add(m.ownerId);
 for(const i of await db.intake.findMany({where:{status:{in:['INTAKE','NEEDS_REVISION','PENDING_CONFIRMATION']}},select:{ownerUserId:true,createdById:true}}))add(i.ownerUserId??i.createdById);
 return result;
}
export async function recordOffboardingRisk(db:Prisma.TransactionClient,actorId:string,userIds:string[]){
 if(!await responsibilityReady(db))return;const counts=await responsibilityCounts(db);
 const receivers=await db.user.findMany({where:{active:true,role:'CUSTOM',roleDefinition:{active:true,permissions:{some:{permissionKey:'matters.transfer',scope:'ALL'}}}},select:{id:true}});
 // 内置五岗位均不含 matters.transfer，默认全新安装可能没有任何合格接收人（P1-5 最小版）：
 // 不能静默空集——通知在任 SUPER_ADMIN 显示配置故障，并记审计留痕；完整接管链在 B 批交付。
 const admins=receivers.length?[]:await db.user.findMany({where:{active:true,systemRole:'SUPER_ADMIN'},select:{id:true}});
 for(const id of userIds){const count=counts.get(id)??0;if(!count)continue;
  await auditTx(db,{userId:actorId,action:'RESPONSIBILITY_HANDOVER_REQUIRED',targetType:'User',targetId:id,detail:{openResponsibilityCount:count,receivers:receivers.length}});
  for(const receiver of receivers.filter(r=>!userIds.includes(r.id)))await db.notification.create({data:{userId:receiver.id,type:'SYSTEM',priority:'URGENT',title:'停用或撤权后有责任待交接',content:`有人员尚有 ${count} 项未结束责任，请在日程页核对接管。`,href:'/schedule',refType:'OffboardingRisk',refId:id}});
  if(!receivers.length)for(const admin of admins.filter(a=>!userIds.includes(a.id)))await db.notification.create({data:{userId:admin.id,type:'SYSTEM',priority:'URGENT',title:'人员责任待交接但本所无应急接管资格人',content:`有人员尚有 ${count} 项未结束责任，但当前没有任何持有「应急接管」权限的有效账号，责任将无人跟进。请在管理后台为合适人员配置 matters.transfer 权限后安排接管。`,href:'/admin/users',refType:'OffboardingRisk',refId:id}});
 }
}
