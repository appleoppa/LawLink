/** 调用方先完成收案/审批对象级授权；只返回固定轮次的可显示字段。 */
import {Prisma} from '@prisma/client';
import {intakeWorkflowReady} from './workflow';
import {formatDate,formatDateTime} from '@/lib/utils';
import {matterCategoryLabel,procedureTypeLabel,litigationStandingLabel,feeTypeLabel,barFilingLabel,clientTypeLabel,partyTypeLabel,conflictConclusionLabel} from '@/lib/enums';
import {conflictPartyRoleLabel} from '@/lib/approvals/intake-detail';
const labels:Record<string,string>={title:'案件名称',category:'案件类别',causeId:'案由',causeFreeText:'补充案由',description:'事实摘要',receivedAt:'收案日期',clientType:'客户类型',contactName:'联系人',contactPhone:'联系电话',firstProcedureType:'首程序',firstAgency:'办理机构',jurisdiction:'管辖地',ourStanding:'委托方诉讼地位',claimAmount:'标的金额',claimDescription:'非金钱标的',barFiling:'律协备案',counterclaim:'反诉',businessType:'业务类型',serviceScope:'服务范围',deliverables:'交付成果',counselType:'顾问类型',serviceStart:'服务开始',serviceEnd:'服务结束',feeType:'收费方式',feeAmount:'收费金额',contingencyTerms:'风险代理约定',feeSchedule:'付款安排',feeNote:'收费说明',ownerUserId:'主办',coUserIds:'共同承办',name:'姓名/名称',role:'本案角色',standing:'诉讼地位',partyType:'主体类型',idNumber:'证件号码',enterpriseSocialCode:'信用代码',enterpriseName:'登记名称',phone:'电话',address:'地址',legalRep:'法定代表人',notes:'备注'};
const mappings:Record<string,Record<string,string>>={category:matterCategoryLabel,firstProcedureType:procedureTypeLabel,ourStanding:litigationStandingLabel,standing:litigationStandingLabel,feeType:feeTypeLabel,barFiling:barFilingLabel,clientType:clientTypeLabel,partyType:partyTypeLabel,role:conflictPartyRoleLabel};
type Snapshot={fields:Record<string,unknown>;parties:Record<string,unknown>[];documents:{id:string;name:string;size:number|null;sha256:string|null}[];display?:{people:{id:string;name:string}[];cause:string|null};conflict:{conclusion:keyof typeof conflictConclusionLabel;note:string|null;queries:{role:string;name:string;idNumber:string}[];hits:{reason:string;matchedValue:string}[]}};
export async function readIntakeRounds(db:Prisma.TransactionClient,intakeId:string,includeFinance=true){
 if(!await intakeWorkflowReady(db))return [];
 const rows=await db.$queryRaw<{id:string;round:number;snapshot:Snapshot;submittedAt:Date;name:string}[]>`SELECT r.*,u.name FROM "IntakeRevision" r JOIN "User" u ON u.id=r."submittedById" WHERE r."intakeId"=${intakeId} ORDER BY round DESC`;
 return rows.map(r=>{
  const names=new Map(r.snapshot.display?.people.map(p=>[p.id,p.name])??[]);
  const fields=(o:Record<string,unknown>)=>Object.entries(o).filter(([k])=>labels[k]&&(includeFinance||!['feeType','feeAmount','contingencyTerms','feeSchedule','feeNote'].includes(k))).map(([k,v])=>({label:labels[k],value:v===null||v===undefined||v===''?'未填写':k==='causeId'?r.snapshot.display?.cause??'未填写':k==='ownerUserId'?names.get(String(v))??'未记录':k==='coUserIds'?(v as string[]).map(id=>names.get(id)??'未记录').join('、')||'无':typeof v==='boolean'?v?'是':'否':['receivedAt','serviceStart','serviceEnd'].includes(k)?formatDate(new Date(String(v))):mappings[k]?.[String(v)]??String(v)}));
  return {id:r.id,round:r.round,submittedAt:formatDateTime(r.submittedAt),name:r.name,fields:fields(r.snapshot.fields),parties:r.snapshot.parties.map(fields),documents:r.snapshot.documents,conflict:{conclusion:conflictConclusionLabel[r.snapshot.conflict.conclusion],note:r.snapshot.conflict.note,queries:r.snapshot.conflict.queries.map(q=>({name:q.name,role:conflictPartyRoleLabel[q.role as keyof typeof conflictPartyRoleLabel]??'其他',idNumber:q.idNumber})),hits:r.snapshot.conflict.hits.map(h=>({reason:h.reason,matchedValue:h.matchedValue}))}};
 });
}
