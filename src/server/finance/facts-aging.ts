import { Prisma } from "@prisma/client";
import { receivableBalance } from "@/lib/finance/ledger";
import type { FinanceFacts } from "./facts";
import type { AgingRow } from "./aging";
export function agingFromFacts(facts:FinanceFacts,now=new Date()) {
  const day=(d:Date)=>Math.floor((d.getTime()+8*3600000)/86400000);
  const items:AgingRow[]=facts.receivables.filter(r=>r.moneyKind==='LAWYER_FEE').map(r=>{
    const due=r.dueState==='DATE_SET'?r.dueDate:r.dueState==='CONDITIONAL'?r.conditionSatisfiedAt:null;
    return {id:r.id,title:r.title,outstanding:receivableBalance(r).toNumber(),dueDate:due?.toISOString()??null,overdueDays:due?day(now)-day(due):null,dueState:r.dueState,matter:{id:r.matter.id,internalCode:r.matter.internalCode,title:r.matter.title,clientName:r.matter.primaryClient?.name??null}};
  }).filter(r=>r.outstanding>0);
  const buckets=[{key:'notDue',label:'未到期',amount:0,count:0},{key:'d30',label:'逾期 1–30 天',amount:0,count:0},{key:'d60',label:'逾期 31–60 天',amount:0,count:0},{key:'d90',label:'逾期 61–90 天',amount:0,count:0},{key:'d90p',label:'逾期 90 天以上',amount:0,count:0},{key:'conditional',label:'条件待成就',amount:0,count:0},{key:'unknown',label:'未约定到期日',amount:0,count:0}];
  for(const row of items){const d=row.overdueDays;const b=d===null?buckets[row.dueState==='CONDITIONAL'?5:6]:d<=0?buckets[0]:d<=30?buckets[1]:d<=60?buckets[2]:d<=90?buckets[3]:buckets[4];b.amount=new Prisma.Decimal(b.amount).plus(row.outstanding).toNumber();b.count++;}
  const overdue=items.filter(r=>(r.overdueDays??0)>0).sort((a,b)=>(b.overdueDays??0)-(a.overdueDays??0));
  return {items,buckets,totalOutstanding:items.reduce((n,r)=>n.plus(r.outstanding),new Prisma.Decimal(0)).toNumber(),overdueAmount:overdue.reduce((n,r)=>n.plus(r.outstanding),new Prisma.Decimal(0)).toNumber(),worst:overdue[0]??null,matterCount:new Set(items.map(r=>r.matter.id)).size};
}
