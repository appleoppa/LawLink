'use client';
import {useState,useTransition} from 'react';import {useRouter} from 'next/navigation';import {toast} from 'sonner';
import {getClosureBoard,saveClosure} from '@/server/archive/closure-actions';import {ArchiveWizardDialog} from '@/app/(app)/matters/[id]/_components/archive-wizard';import {Button} from '@/components/ui/button';import {Input} from '@/components/ui/input';import {Textarea} from '@/components/ui/textarea';import {formatDate} from '@/lib/utils';import {shDayKey} from '@/lib/ui/sh-time';
export function MatterClosurePanel({matterId,data}:{matterId:string;data:Awaited<ReturnType<typeof getClosureBoard>>}){
 const router=useRouter(),[pending,start]=useTransition(),[open,setOpen]=useState(false),[reason,setReason]=useState(data?.plan?.reason??''),[date,setDate]=useState(data?.plan?shDayKey(new Date(data.plan.serviceCompletedAt)):shDayKey(new Date())),[owner,setOwner]=useState(data?.plan?.financeOwnerId??'');
 if(!data)return null;
 return <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">结案与归档核对 · {data.status==='ARCHIVED'?'卷宗已归档':data.blockers.length?'仍有待处置事项':'可核对送审'}</summary><div className="mt-4 space-y-4 text-sm">
 <div className="grid gap-2 sm:grid-cols-4"><span>程序与事项：{data.blockers.length?'未完成':'已处置'}</span><span>律师服务：{data.plan?`已说明 ${formatDate(data.plan.serviceCompletedAt)}`:'未确认'}</span><span>财务：{data.financeOpen?'有未结事项':'已结清'}</span><span>卷宗：{data.status==='ARCHIVED'?'已归档':'待归档'}</span></div>
 {data.blockers.length>0&&<ul className="list-disc pl-5 text-amber-700">{data.blockers.map(b=><li key={b}>{b}</li>)}</ul>}
 {data.finance&&<p>未结应收 ¥{data.finance.outstanding} · 未分配收款 ¥{data.finance.unallocated} · 未结分成 ¥{data.finance.commissionBalance} · 发票未关联收款 ¥{data.finance.invoiceOutstanding}</p>}
 {data.plan&&!data.plan.current&&(data.status==='ARCHIVED'
   ?<p className="text-muted-foreground">归档后清单随收尾业务自然变化，属正常现象；如需变更财务收尾人请办理收尾交接，原归档包不受影响。</p>
   :<p className="text-amber-700">清单已变化，请重新核对并保存收尾安排。已送审申请须退回后重新提交。</p>)}
 <p>未结款本身不阻止归档；未完事项须完成、取消，或在关联新案件落实后明确记录移交。原归档包保持固定，后续材料单独补充归档。</p>
 {data.canSave&&<div className="grid gap-3 sm:grid-cols-2"><label>服务完成日期<Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>财务收尾负责人<select className="block h-9 w-full rounded-md border px-2" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">无未结财务时可不指定</option>{data.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="sm:col-span-2">服务完成说明及收尾安排<Textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><Button variant="outline" disabled={pending} onClick={()=>start(async()=>{try{await saveClosure({matterId,revision:data.plan?.revision??null,financeOwnerId:owner||null,serviceCompletedAt:new Date(`${date}T00:00:00+08:00`),reason});toast.success('收尾核对已保存');router.refresh();}catch(e){toast.error(e instanceof Error?e.message:'保存失败');}})}>保存核对结果</Button></div>}
 {data.status==='ARCHIVED'&&data.canSupplement&&<Button variant="outline" onClick={()=>setOpen(true)}>提交补充归档</Button>}
 {data.archives.map(a=><div key={a.id} className="flex gap-3"><span>{a.archiveNo} · {a.status==='APPROVED'?'已批准':a.status==='REJECTED'?'已驳回':'待审批'}</span>{a.status==='APPROVED'&&<a className="underline" href={`/api/archive/${matterId}/export?archiveId=${a.id}`}>导出本次固定卷宗</a>}</div>)}
 <ArchiveWizardDialog matterId={matterId} open={open} onOpenChange={setOpen}/>
 </div></details>;
}
