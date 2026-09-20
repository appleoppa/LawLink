"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioChips } from "@/components/ui/radio-chips";
import { formatDate } from "@/lib/utils";
import { moneyKinds, moneyKindLabels, type MoneyKind } from "@/lib/finance/ledger-labels";
import { registerExpense, registerBilling, registerReceipt, confirmReceipt, rejectReceipt, signBilling, confirmDueCondition, type getFinanceLedger } from "@/server/finance/ledger-actions";
type Data=Awaited<ReturnType<typeof getFinanceLedger>>;
type Part={title:string;amount:string;dueState:"UNKNOWN"|"DATE_SET"|"CONDITIONAL";dueDate:string;dueCondition:string};
const newPart=():Part=>({title:"第一期",amount:"",dueState:"UNKNOWN",dueDate:"",dueCondition:""});
const date=(v:string)=>new Date(`${v}T00:00:00+08:00`);
const yuan=(v:string)=>`¥${Number(v).toLocaleString("zh-CN",{minimumFractionDigits:2})}`;
export function RegistrationWorkspace({data,canWrite,canConfirm,selectedMatterId}:{data:Data;canWrite:boolean;canConfirm:boolean;selectedMatterId?:string}) {
  const router=useRouter();
  const [mode,setMode]=useState<"billing"|"receipt"|"expense"|"sign"|"reject"|"condition"|null>(null);
  const [dialogOpen,setDialogOpen]=useState(false);
  const [target,setTarget]=useState("");
  const [matterId,setMatterId]=useState(selectedMatterId??"");
  const [title,setTitle]=useState("");
  const [amount,setAmount]=useState("");
  const [moneyKind,setMoneyKind]=useState<MoneyKind>("LAWYER_FEE");
  const [day,setDay]=useState(formatDate(new Date()));
  const [draft,setDraft]=useState(false);
  const [parts,setParts]=useState<Part[]>([newPart()]);
  const [counterparty,setCounterparty]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const matters=new Map(data.matters.map(m=>[m.id,m]));
  // 归档案件默认只读；本案指定的财务收尾人（tailWritable）仍可确认/退回实收
  const canChange=(id:string)=>matters.get(id)?.status!=="ARCHIVED"||matters.get(id)?.tailWritable===true;
  function open(next:NonNullable<typeof mode>,id="") {
    setDialogOpen(true);setMode(next);setTarget(id);setMatterId(selectedMatterId??"");setTitle("");setAmount("");setMoneyKind(next==="expense"?"OTHER":"LAWYER_FEE");setDay(formatDate(new Date()));setDraft(false);setNote("");setCounterparty("");setParts([newPart()]);
    if(next==="sign") {const b=data.billings.find(b=>b.id===id)!;setMatterId(b.matterId);setTitle(b.title);setMoneyKind(b.moneyKind);setAmount(b.contractAmount);setParts(Number(b.contractAmount)===0?[]:[{...newPart(),amount:b.contractAmount}]);}
  }
  async function run(work:()=>Promise<{ok:boolean;message?:string}>,success:string) {
    setBusy(true);try{const result=await work();if(!result.ok)throw new Error(result.message);toast.success(success);setDialogOpen(false);
      // M-3e（D 批）：从案件入口进入时，保存成功后留在案件上下文并回原案页，不再停在全局对账页
      if(selectedMatterId){toast.info("即将返回案件");router.push(`/matters/${selectedMatterId}`);return;}router.refresh();}catch(e){toast.error(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}
  }
  const installments=()=>parts.map(p=>({...p,dueDate:p.dueState==="DATE_SET" && p.dueDate?date(p.dueDate):undefined}));
  function submit(e:React.FormEvent) {
    e.preventDefault();
    if(mode==="expense")void run(()=>registerExpense({matterId,amount,moneyKind,occurredAt:date(day),note,payerOrPayee:counterparty}),"支出已登记");
    if(mode==="receipt")void run(()=>registerReceipt({matterId,amount,moneyKind,occurredAt:date(day),note,payerOrPayee:counterparty}),"实收已登记，等待财务确认到账");
    if(mode==="billing")void run(()=>registerBilling({matterId,title,amount,moneyKind,signedAt:draft?undefined:date(day),installments:draft?[]:installments()}),draft?"收费草稿已保存":"收费及分期应收已创建");
    if(mode==="sign") {const b=data.billings.find(b=>b.id===target)!;void run(()=>signBilling({id:target,revision:b.revision,signedAt:date(day),installments:installments()}),"已确认签署并生成应收");}
    if(mode==="reject")void run(()=>rejectReceipt(target,note),"已退回并通知登记人");
    if(mode==="condition") {const r=data.receivables.find(r=>r.id===target)!;void run(()=>confirmDueCondition({id:target,revision:r.revision,satisfiedAt:date(day),note}),"已确认条件成就日期");}
  }
  const fields=mode==="billing"||mode==="sign";
  return <>
    {canWrite?<div className="flex gap-2"><button className="btn btn-secondary btn-sm" onClick={()=>open("billing")}>新增收费安排</button><button className="btn btn-secondary btn-sm" onClick={()=>open("receipt")}>登记实收</button><button className="btn btn-secondary btn-sm" onClick={()=>open("expense")}>登记支出</button></div>:null}
    {data.pending.length?<section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">待确认实收</h2><p className="text-sm text-muted-foreground">以下登记尚未计入实收、分成或应收核销。</p><ul className="divide-y">{data.pending.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{matters.get(p.matterId)?.internalCode} · {moneyKindLabels[p.moneyKind]} · {yuan(p.amount)} · {p.name}登记 · {formatDate(p.occurredAt)}{p.payerOrPayee?` · 付款人：${p.payerOrPayee}`:""}{p.note?<span className="block pt-1 text-muted-foreground">{p.note}</span>:null}</span>{canConfirm && canChange(p.matterId)?<span className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>void run(()=>confirmReceipt(p.id),"到账已确认，实收与计提已入账")}>确认到账</button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>open("reject",p.id)}>退回</button></span>:null}</li>)}</ul></section>:null}
    {data.billings.some(b=>b.status==="DRAFT"&&!b.sourceBillingId)?<section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">待签署收费安排</h2><ul className="divide-y">{data.billings.filter(b=>b.status==="DRAFT"&&!b.sourceBillingId).map(b=><li className="flex justify-between gap-3 py-3 text-sm" key={b.id}><span>{b.title} · {yuan(b.contractAmount)} · 草稿未生成应收</span>{canWrite && canChange(b.matterId)?<button className="btn btn-secondary btn-sm" onClick={()=>open("sign",b.id)}>确认签署</button>:null}</li>)}</ul></section>:null}
    {canWrite && data.receivables.some(r=>r.dueState==="CONDITIONAL"&&!r.conditionSatisfiedAt&&r.status!=="CANCELLED")?<section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">待成就条件</h2>{data.receivables.filter(r=>r.dueState==="CONDITIONAL"&&!r.conditionSatisfiedAt&&r.status!=="CANCELLED").map(r=><div className="flex justify-between gap-3 py-3 text-sm" key={r.id}><span>{r.title} · {r.dueCondition}</span>{canChange(r.matterId)?<button className="btn btn-secondary btn-sm" onClick={()=>open("condition",r.id)}>条件已成就</button>:null}</div>)}</section>:null}
    <Dialog open={dialogOpen} onOpenChange={open=>{if(!busy)setDialogOpen(open);}}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>{{billing:"新增收费安排",receipt:"登记实收",expense:"登记支出",sign:"确认签署与分期",reject:"退回实收",condition:"确认到期条件"}[mode??"billing"]}</DialogTitle><DialogDescription>{mode==="receipt"?"登记后须由有权财务确认到账，才计入实收。":fields?"签署时按收费总额生成分期应收；各期合计须等于总额。":"填写实际日期及依据，操作将记录审计。"}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4">
      {mode==="billing"||mode==="receipt"||mode==="expense"?<><Label htmlFor="register-matter">案件{selectedMatterId?"（案件入口锁定）":""}</Label><select id="register-matter" className="w-full rounded border bg-background p-2" value={matterId} onChange={e=>setMatterId(e.target.value)} required disabled={Boolean(selectedMatterId)}><option value="">请选择案件</option>{data.matters.filter(m=>m.status!=="ARCHIVED"||m.tailWritable===true).map(m=><option key={m.id} value={m.id}>{m.internalCode} · {m.title}{m.status==="ARCHIVED"?"（归档收尾）":""}</option>)}</select><Label>款项性质</Label><RadioChips items={moneyKinds.map(value=>({value,label:moneyKindLabels[value]}))} value={moneyKind} onChange={v=>setMoneyKind(v as MoneyKind)}/></>:null}
      {fields?<><Label htmlFor="billing-title">收费名称</Label><Input id="billing-title" value={title} onChange={e=>setTitle(e.target.value)} required disabled={mode==="sign"}/></>:null}
      {fields||mode==="receipt"||mode==="expense"?<><Label htmlFor="register-amount">{fields?"收费总额":mode==="expense"?"本次支出":"本次实收"}（元）</Label><Input id="register-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required disabled={mode==="sign"}/></>:null}
      {mode==="billing"?<RadioChips items={[{value:"signed",label:"已签署"},{value:"draft",label:"未签署草稿"}]} value={draft?"draft":"signed"} onChange={v=>setDraft(v==="draft")}/>:null}
      {mode!=="reject"&&!draft?<><Label htmlFor="register-day">{fields?"签署日期":mode==="condition"?"条件成就日期":mode==="expense"?"支出日期":"到账日期"}</Label><Input id="register-day" type="date" value={day} onChange={e=>setDay(e.target.value)} required/></>:null}
      {fields&&!draft?<fieldset className="space-y-3"><legend className="mb-2 font-semibold">分期应收</legend>{parts.map((p,i)=><div key={i} className="space-y-2 rounded border p-3"><Label htmlFor={`part-title-${i}`}>第 {i+1} 期名称</Label><Input id={`part-title-${i}`} value={p.title} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,title:e.target.value}:v))} required/><Label htmlFor={`part-amount-${i}`}>金额（元）</Label><Input id={`part-amount-${i}`} inputMode="decimal" value={p.amount} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,amount:e.target.value}:v))} required/><RadioChips items={[{value:"UNKNOWN",label:"未约定日期"},{value:"DATE_SET",label:"确定日期"},{value:"CONDITIONAL",label:"条件成就时"}]} value={p.dueState} onChange={v=>setParts(parts.map((part,n)=>n===i?{...part,dueState:v as Part["dueState"]}:part))}/>{p.dueState==="DATE_SET"?<><Label htmlFor={`part-date-${i}`}>到期日</Label><Input id={`part-date-${i}`} type="date" required value={p.dueDate} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,dueDate:e.target.value}:v))}/></>:null}{p.dueState==="CONDITIONAL"?<><Label htmlFor={`part-condition-${i}`}>到期条件</Label><Input id={`part-condition-${i}`} required value={p.dueCondition} onChange={e=>setParts(parts.map((v,n)=>n===i?{...v,dueCondition:e.target.value}:v))}/></>:null}<button type="button" className="text-sm text-destructive" onClick={()=>setParts(parts.filter((_,n)=>n!==i))}>移除此期</button></div>)}<button type="button" className="btn btn-secondary btn-sm" onClick={()=>setParts([...parts,{...newPart(),title:`第${parts.length+1}期`}])}>添加一期</button><p className="text-xs text-muted-foreground">零收费安排请移除所有分期。</p></fieldset>:null}
      {mode==="receipt"||mode==="expense"?<><Label htmlFor="register-counterparty">{mode==="receipt"?"付款人":"收款人"}</Label><Input id="register-counterparty" value={counterparty} onChange={e=>setCounterparty(e.target.value)} maxLength={80}/></>:null}
      {mode==="receipt"||mode==="expense"||mode==="reject"||mode==="condition"?<><Label htmlFor="register-note">{mode==="receipt"||mode==="expense"?"备注":mode==="reject"?"退回原因":"条件成就依据"}</Label><Textarea id="register-note" value={note} onChange={e=>setNote(e.target.value)} required={mode!=="receipt"&&mode!=="expense"} maxLength={mode==="receipt"||mode==="expense"?500:1000}/></>:null}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy?"保存中…":"确认保存"}</button>
    </form></DialogContent></Dialog>
  </>;
}
