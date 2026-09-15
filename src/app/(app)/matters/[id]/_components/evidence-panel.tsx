"use client";

/**
 * 证据要点（P2 材料出处链）。
 *
 * 2026-09-14 起不再单设「证据链」模块：证据要点（客观事实/主张/分析/争议焦点/待核实）
 * 直接挂在材料行上展示与添加（案卷工作台·办案进程）；未挂材料的要点在「全部环节」材料末尾列出。
 * 来源是"纯引用"：材料删除后引用悬空（显示"来源已删除"），证据要点本身保留。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { createEvidenceItem } from "@/server/evidence/actions";
import { evidenceKindLabel } from "@/lib/enums";
import { formatDate } from "@/lib/utils";

type EvidenceKind = keyof typeof evidenceKindLabel;

export type EvidenceItemRow = {
  id: string;
  title: string;
  content: string;
  kind: EvidenceKind;
  sourceDocumentId: string | null;
  sourceDocumentName: string | null;
  sourcePage: number | null;
  createdByName: string | null;
  createdAt: Date | string;
};

export const EVIDENCE_KIND_STYLE: Record<EvidenceKind, string> = {
  FACT: "border-[#B7D8D6] bg-[#E4F1F0] text-[#005054]",
  CLAIM: "border-[#1E56C8]/30 bg-[#1E56C8]/8 text-[#1E56C8]",
  ANALYSIS: "border-[var(--violet-line)] bg-[var(--violet-bg)] text-[var(--violet)]",
  ISSUE: "border-[#B42318]/30 bg-[#B42318]/8 text-[#B42318]",
  TODO_VERIFY: "border-[#96650B]/35 bg-[#96650B]/10 text-[#7A5205]"
};

const KIND_KEYS = Object.keys(evidenceKindLabel) as EvidenceKind[];

/** 证据要点列表（材料行展开 / 未挂材料的要点） */
export function EvidencePoints({ items, showSource = false }: { items: EvidenceItemRow[]; showSource?: boolean }) {
  return (
    <ul className="dos-ev-list">
      {items.map((item) => (
        <li key={item.id} className="dos-ev">
          <div className="dos-ev-top">
            <span className={`rounded-full border px-1.5 py-px text-[10px] ${EVIDENCE_KIND_STYLE[item.kind]}`}>{evidenceKindLabel[item.kind]}</span>
            <span className="dos-ev-title">{item.title}</span>
            {item.sourcePage ? <span className="dos-ev-page">第 {item.sourcePage} 页</span> : null}
          </div>
          <p className="dos-ev-text">{item.content}</p>
          <div className="dos-ev-meta">
            {showSource ? (
              item.sourceDocumentId ? (
                item.sourceDocumentName ? (
                  <span>来源：{item.sourceDocumentName}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#7A5205]" title="证据要点保留，来源材料已被删除">
                    <Unlink className="h-3 w-3" />
                    来源已删除（引用保留）
                  </span>
                )
              ) : (
                <span>未挂来源材料</span>
              )
            ) : null}
            {item.createdByName ? <span>记录人 {item.createdByName}</span> : null}
            <span className="font-mono">{formatDate(new Date(item.createdAt))}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 添加证据要点：从材料行进入时来源材料已预选 */
export function EvidenceItemDialog({
  open,
  onOpenChange,
  matterId,
  documents,
  defaultDocumentId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  documents: { id: string; name: string }[];
  defaultDocumentId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EvidenceKind>("FACT");
  const [content, setContent] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState<string>(defaultDocumentId ?? "none");
  const [sourcePage, setSourcePage] = useState("");
  const fixedDoc = defaultDocumentId ? documents.find((d) => d.id === defaultDocumentId) ?? null : null;

  function submit() {
    if (!title.trim()) { toast.warning("请填写标题"); return; }
    if (!content.trim()) { toast.warning("请填写内容"); return; }
    const page = sourcePage ? Number(sourcePage) : null;
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 10000)) {
      toast.warning("页码须为 1–10000 的整数");
      return;
    }
    startTransition(async () => {
      try {
        await createEvidenceItem({
          matterId,
          title: title.trim(),
          content: content.trim(),
          kind,
          sourceDocumentId: sourceDocumentId === "none" ? null : sourceDocumentId,
          sourcePage: page
        });
        toast.success("证据要点已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("添加失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isPending) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加证据要点</DialogTitle>
          <DialogDescription>
            {fixedDoc ? `记录「${fixedDoc.name}」证明的事实、主张或分析，可注明页码。` : "逐条记录事实、主张或分析，并可引用来源材料与页码。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="如：微信记录显示 3 月 2 日已付款" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">性质 <span className="text-destructive">*</span></Label>
              <Select value={kind} onValueChange={(v) => setKind(v as EvidenceKind)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>{evidenceKindLabel[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">内容 <span className="text-destructive">*</span></Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} maxLength={5000} placeholder="记清楚时间、主体、证明对象；引用材料时注明页码" />
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">来源材料</Label>
              <Select value={sourceDocumentId} onValueChange={setSourceDocumentId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不挂来源</SelectItem>
                  {documents.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="max-w-[280px] truncate">{d.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">页码</Label>
              <Input type="number" min={1} max={10000} value={sourcePage} onChange={(e) => setSourcePage(e.target.value)} disabled={sourceDocumentId === "none"} placeholder="—" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>取消</Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
