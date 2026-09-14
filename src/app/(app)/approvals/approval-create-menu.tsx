"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { approvalHref } from "@/lib/approvals/workspace";
import { FilePlus2, Receipt, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApprovalCreateOptions } from "@/server/approval-permissions/create-options";
import { IntakeWizard } from "@/app/(app)/intakes/_components/intake-wizard";
import { InvoiceCreateDialog } from "@/app/(app)/finance/_components/invoice-create-dialog";
import { SealRequestSheet } from "./seals/_components/seal-request-sheet";
import { useTopbarAction } from "@/components/layout/topbar-action";

export function ApprovalCreateMenu() {
  const params = useSearchParams();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [kind, setKind] = useState<"intake" | "invoice" | "seal" | null>(null);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getApprovalCreateOptions>> | null>(null);
  const [pending, start] = useTransition();
  const autoOpened = useRef(false);
  const launch = useCallback((value: NonNullable<typeof kind>) => {
    start(async () => { try { setOptions(await getApprovalCreateOptions()); setMenu(false); setKind(value); } catch (e) { toast.error(e instanceof Error ? e.message : "无法加载申请表"); } });
  }, []);
  const isNewSeal = params.get("new") === "seal";
  useEffect(() => { if (isNewSeal && !autoOpened.current) { autoOpened.current = true; launch("seal"); } }, [isNewSeal, launch]);
  useTopbarAction({ label: "发起申请", onClick: () => setMenu(true) }, []);
  return <>
    <Dialog open={menu} onOpenChange={setMenu}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>发起申请</DialogTitle><DialogDescription>选择事项。提交后可在“我的申请”持续跟进。</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-3">{([
        { kind: "intake", title: "收案申请", description: "登记案件与委托资料", icon: FilePlus2 },
        { kind: "invoice", title: "开票申请", description: "填写抬头与开票金额", icon: Receipt },
        { kind: "seal", title: "用章申请", description: "提交用印事项与材料", icon: Stamp },
      ] as const).map(item => <Button key={item.kind} disabled={pending} variant="outline" className="h-auto items-start gap-2 whitespace-normal rounded-xl p-4 text-left sm:flex-col" onClick={() => launch(item.kind)}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary"><item.icon size={19} /></span><span><span className="block text-[13px] font-medium">{item.title}</span><span className="mt-1 block text-[11px] font-normal leading-relaxed text-muted-foreground">{item.description}</span></span></Button>)}</div>
      <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm"><p>文书审核须先选定具体材料，归档申请须先完成案件归档检查。</p><p className="text-muted-foreground">在案件内选择材料送审或发起归档后，审批与后续记录均在此工作台处理。</p><Button variant="link" className="px-0" asChild><Link href="/matters">选择案件与材料</Link></Button></div>
    </DialogContent></Dialog>
    {options && <>
      <IntakeWizard open={kind === "intake"} onOpenChange={o => { if (!o) setKind(null); }} clientOptions={options.clients} colleagues={options.colleagues} onSubmitted={id => router.push(approvalHref("INTAKE_APPROVE", id) + "&tab=mine")} />
      <InvoiceCreateDialog open={kind === "invoice"} onOpenChange={o => { if (!o) setKind(null); }} canCreateUnlinkedInvoice={options.canCreateUnlinkedInvoice} onSubmitted={id => router.push(approvalHref("INVOICE_APPROVE", id) + "&tab=mine")} />
      <SealRequestSheet open={kind === "seal"} onOpenChange={o => { if (!o) setKind(null); }} configs={options.configs} matters={options.matters} preset={isNewSeal ? { draftDocId: params.get("draftDocId") ?? undefined, matterId: params.get("matterId") ?? undefined, documentTitle: params.get("documentTitle") ?? undefined } : null} onSubmitted={id => router.push(approvalHref("SEAL_APPROVE", id) + "&tab=mine")} />
    </>}
  </>;
}
