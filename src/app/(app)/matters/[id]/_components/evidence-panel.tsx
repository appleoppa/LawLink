"use client";

/**
 * 证据链区块（P2 材料出处链 UI 入口）。
 *
 * 逐条列出案件下的证据项（客观事实/主张/分析/争议焦点/待核实），
 * 每条可挂来源材料 + 页码；来源是"纯引用"：材料删除后引用悬空
 * （显示"来源已删除"），证据项本身保留。
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSearch, Loader2, Plus, Unlink } from "lucide-react";
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

const KIND_STYLE: Record<EvidenceKind, string> = {
  FACT: "border-[#B7D8D6] bg-[#E4F1F0] text-[#005054]",
  CLAIM: "border-[#1E56C8]/30 bg-[#1E56C8]/8 text-[#1E56C8]",
  ANALYSIS: "border-[var(--violet-line)] bg-[var(--violet-bg)] text-[var(--violet)]",
  ISSUE: "border-[#B42318]/30 bg-[#B42318]/8 text-[#B42318]",
  TODO_VERIFY: "border-[#96650B]/35 bg-[#96650B]/10 text-[#7A5205]"
};

const KIND_KEYS = Object.keys(evidenceKindLabel) as EvidenceKind[];

export function EvidencePanel({
  matterId,
  items,
  documents,
  canManage
}: {
  matterId: string;
  items: EvidenceItemRow[];
  documents: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"ALL" | EvidenceKind>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 新建表单
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EvidenceKind>("FACT");
  const [content, setContent] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState<string>("none");
  const [sourcePage, setSourcePage] = useState("");

  const visible = useMemo(
    () => (filter === "ALL" ? items : items.filter(i => i.kind === filter)),
    [items, filter]
  );
  const countByKind = useMemo(() => {
    const m = new Map<EvidenceKind, number>();
    for (const i of items) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
    return m;
  }, [items]);

  function resetForm() {
    setTitle(""); setKind("FACT"); setContent("");
    setSourceDocumentId("none"); setSourcePage("");
  }

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
        toast.success("证据项已添加");
        setCreateOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error("添加失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <section className="ll-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--bd-hair)] px-4 py-3">
        <span className="panel-title">
          <FileSearch className="h-3.5 w-3.5 text-primary" />
          证据链
          <span className="font-mono text-[11px] tabular text-muted-foreground">{items.length}</span>
        </span>
        <div className="flex items-center gap-1">
          <div className="mr-1 flex flex-wrap items-center gap-1">
            <FilterChip label="全部" active={filter === "ALL"} onClick={() => setFilter("ALL")} count={items.length} />
            {KIND_KEYS.map(k => (
              <FilterChip
                key={k}
                label={evidenceKindLabel[k]}
                active={filter === k}
                onClick={() => setFilter(k)}
                count={countByKind.get(k) ?? 0}
              />
            ))}
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3 w-3" />
              添加
            </Button>
          )}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted-foreground">
          {items.length === 0 ? "尚未记录证据项" : "该分类下暂无证据项"}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map(item => (
            <li key={item.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-1.5 py-px text-[10px] ${KIND_STYLE[item.kind]}`}
                >
                  {evidenceKindLabel[item.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] tabular text-muted-foreground/70">
                  {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap pl-1 text-xs leading-relaxed text-muted-foreground">
                {item.content}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1 text-[11px] text-muted-foreground">
                {item.sourceDocumentId ? (
                  item.sourceDocumentName ? (
                    <span className="rounded-full border border-[#B7D8D6] bg-[#E4F1F0] px-1.5 py-px text-[#005054]">
                      来源：{item.sourceDocumentName}
                      {item.sourcePage ? <span className="font-mono tabular"> 第 {item.sourcePage} 页</span> : null}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#96650B]/35 bg-[#96650B]/10 px-1.5 py-px text-[#7A5205]" title="证据项保留，来源材料已被删除">
                      <Unlink className="h-3 w-3" />
                      来源已删除（引用保留）
                    </span>
                  )
                ) : (
                  <span>未挂来源材料</span>
                )}
                {item.createdByName ? <span>· 记录人 {item.createdByName}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={o => { if (!o) { setCreateOpen(false); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加证据项</DialogTitle>
            <DialogDescription>
              逐条记录事实、主张或分析，并可引用来源材料与页码。来源被删除后证据项仍保留（引用悬空）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">标题 <span className="text-destructive">*</span></Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="如：微信记录显示 3 月 2 日已付款" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">性质 <span className="text-destructive">*</span></Label>
                <Select value={kind} onValueChange={v => setKind(v as EvidenceKind)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KIND_KEYS.map(k => (
                      <SelectItem key={k} value={k}>{evidenceKindLabel[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">内容 <span className="text-destructive">*</span></Label>
              <Textarea value={content} onChange={e => setContent(e.target.value)} rows={4} maxLength={5000} placeholder="记清楚时间、主体、来源与待办；引用材料时注明页码" />
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">来源材料</Label>
                <Select value={sourceDocumentId} onValueChange={setSourceDocumentId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不挂来源</SelectItem>
                    {documents.map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="max-w-[280px] truncate">{d.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">页码</Label>
                <Input
                  type="number" min={1} max={10000}
                  value={sourcePage}
                  onChange={e => setSourcePage(e.target.value)}
                  disabled={sourceDocumentId === "none"}
                  placeholder="—"
                />
              </div>
            </div>
            {sourceDocumentId === "none" && (
              <p className="text-[11px] text-muted-foreground">填写页码须先选择来源材料。</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }} disabled={isPending}>取消</Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FilterChip({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-[#E4F1F0] px-2 py-0.5 text-[10.5px] text-[#005054] shadow-[inset_0_0_0_1px_#B7D8D6]"
          : "rounded-full px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      {label}
      <span className="ml-1 font-mono tabular opacity-70">{count}</span>
    </button>
  );
}
