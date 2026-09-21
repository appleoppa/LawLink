'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogTitle,DialogHeader,DialogDescription} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';
import {IntakeWizard,type ClientOption} from '../../_components/intake-wizard';
import {getIntakeEditForm,withdrawIntake} from '@/server/intakes/revision-actions';
import {resubmitIntake,voidIntake} from '@/server/intakes/actions';
import {listClients} from '@/server/clients/actions';
import {listActiveColleagues} from '@/server/users/actions';
import { actionErrorMessage } from "@/lib/action-error";
export function RevisionControls({id,status}:{id:string;status:string}){
 const router=useRouter(),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[withdraw,setWithdraw]=useState(false),[voiding,setVoiding]=useState(false),[reason,setReason]=useState('');
 const [data,setData]=useState<Awaited<ReturnType<typeof getIntakeEditForm>>|null>(null),[clients,setClients]=useState<ClientOption[]>([]),[people,setPeople]=useState<Awaited<ReturnType<typeof listActiveColleagues>>>([]);
 async function edit(){setBusy(true);try{const [form,c,u]=await Promise.all([getIntakeEditForm(id),listClients({pageSize:100}),listActiveColleagues()]);setData(form);setClients(c.items.map(x=>({id:x.id,name:x.name,type:x.type})));setPeople(u);setOpen(true);}catch(e){toast.error(e instanceof Error ? actionErrorMessage(e) :'无法打开补正');}finally{setBusy(false);}}
 async function submit(){setBusy(true);try{await resubmitIntake(id);toast.success('本轮申请已固定并送审');router.refresh();}catch(e){toast.error(e instanceof Error ? actionErrorMessage(e) :'送审失败');}finally{setBusy(false);}}
 return <div className="flex flex-wrap gap-2">{['INTAKE','NEEDS_REVISION'].includes(status)&&<><button disabled={busy} className="btn btn-secondary btn-sm" onClick={()=>void edit()}>编辑收案资料</button><button disabled={busy} className="btn btn-primary btn-sm" onClick={()=>void submit()}>复核并送审</button></>}{status==='PENDING_CONFIRMATION'&&<button className="btn btn-secondary btn-sm" onClick={()=>setWithdraw(true)}>撤回补正</button>}
 {/* P2-6：草稿态唯一出边此前只有送审，弃置草稿永久滞留收案中页签——作废为终态出口，须填原因并先处置紧急事项 */}
 {status==='INTAKE'&&<button className="btn btn-outline btn-sm text-muted-foreground" onClick={()=>{setReason('');setVoiding(true);}}>作废草稿</button>}
 {data&&<IntakeWizard key={`${id}-${data.revision}`} open={open} onOpenChange={setOpen} editing={{id,...data}} clientOptions={clients} colleagues={people} onSubmitted={()=>router.refresh()}/>}
 <Dialog open={withdraw} onOpenChange={setWithdraw}><DialogContent><DialogHeader><DialogTitle>撤回补正</DialogTitle><DialogDescription>原送审内容保留。撤回成功后才能编辑资料和补充材料。</DialogDescription></DialogHeader><Textarea aria-label="撤回原因" value={reason} onChange={e=>setReason(e.target.value)}/><button disabled={busy||!reason.trim()} className="btn btn-primary" onClick={async()=>{setBusy(true);try{await withdrawIntake(id,reason);setWithdraw(false);router.refresh();}catch(e){toast.error(e instanceof Error ? actionErrorMessage(e) :'撤回失败');}finally{setBusy(false);}}}>撤回申请</button></DialogContent></Dialog>
 <Dialog open={voiding} onOpenChange={setVoiding}><DialogContent><DialogHeader><DialogTitle>作废收案草稿</DialogTitle><DialogDescription>作废后不再出现在「收案中」页签，记录与审计保留可追溯。如有紧急事项须先处置。</DialogDescription></DialogHeader><Textarea aria-label="作废原因" value={reason} onChange={e=>setReason(e.target.value)} placeholder="如：重复登记／当事人放弃委托"/><button disabled={busy||!reason.trim()} className="btn btn-outline" onClick={async()=>{setBusy(true);try{await voidIntake({id,reason});setVoiding(false);toast.success('草稿已作废');router.refresh();}catch(e){toast.error(e instanceof Error ? actionErrorMessage(e) :'作废失败');}finally{setBusy(false);}}}>确认作废</button></DialogContent></Dialog></div>;
}
