"use client";

/**
 * 委托区块（P2 五对象第一步 UI 入口）。
 *
 * 展示本案关联的委托（含已终止的历史），支持：
 * - 新建委托（默认关联本案）；
 * - 关联客户名下已有委托（挂链，带生效区间）；
 * - 终止委托（填写原因；终止不触碰财务与程序状态——状态轴分离）。
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Handshake, Link2, Loader2, Plus, SquareSlash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  createEngagement,
  linkEngagementMatter,
  terminateEngagement,
  listActiveEngagementsForClient
} from "@/server/engagements/actions";

export type EngagementRow = {
  validFrom: Date | null;
  validTo: Date | null;
  engagement: {
    id: string;
    title: string;
    scopeText: string | null;
    feeNote: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    terminatedReason: string | null;
    client: { id: string; name: string };
  };
};

type ActiveEngagementOption = { id: string; title: string; startedAt: Date | null };

function fmtDate(v: Date | null) {
  return v ? new Date(v).toLocaleDateString("zh-CN") : "—";
}

export function EngagementPanel({
  matterId,
  client,
  engagements,
  canManage
}: {
  matterId: string;
  client: { id: string; name: string } | null;
  engagements: EngagementRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"create" | "link" | "terminate" | null>(null);
  const [isPending, startTransition] = useTransition();

  // 新建表单
  const [title, setTitle] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [feeNote, setFeeNote] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [linkThisMatter, setLinkThisMatter] = useState(true);

  // 挂链表单
  const [activeOptions, setActiveOptions] = useState<ActiveEngagementOption[] | null>(null);
  const [linkEngagementId, setLinkEngagementId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  // 终止表单
  const [terminateTarget, setTerminateTarget] = useState<EngagementRow | null>(null);
  const [terminateReason, setTerminateReason] = useState("");

  const activeEngagements = useMemo(() => engagements.filter(e => !e.engagement.endedAt), [engagements]);

  useEffect(() => {
    if (dialog !== "link" || !client) return;
    let cancelled = false;
    listActiveEngagementsForClient(client.id)
      .then(rows => { if (!cancelled) setActiveOptions(rows); })
      .catch(() => { if (!cancelled) setActiveOptions([]); });
    return () => { cancelled = true; };
  }, [dialog, client]);

  function resetForms() {
    setTitle(""); setScopeText(""); setFeeNote(""); setStartedAt(""); setLinkThisMatter(true);
    setLinkEngagementId(""); setValidFrom(""); setValidTo("");
    setTerminateTarget(null); setTerminateReason("");
  }

  function closeDialog() {
    setDialog(null);
    resetForms();
  }

  function submitCreate() {
    if (!client) return;
    if (!title.trim()) { toast.warning("请填写委托名称"); return; }
    startTransition(async () => {
      try {
        await createEngagement({
          clientId: client.id,
          title: title.trim(),
          scopeText: scopeText.trim() || undefined,
          feeNote: feeNote.trim() || undefined,
          startedAt: startedAt ? new Date(startedAt) : undefined,
          matterIds: linkThisMatter ? [matterId] : []
        });
        toast.success("委托已创建");
        closeDialog();
        router.refresh();
      } catch (err) {
        toast.error("创建失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function submitLink() {
    if (!linkEngagementId) { toast.warning("请选择要关联的委托"); return; }
    startTransition(async () => {
      try {
        await linkEngagementMatter({
          engagementId: linkEngagementId,
          matterId,
          validFrom: validFrom ? new Date(validFrom) : undefined,
          validTo: validTo ? new Date(validTo) : undefined
        });
        toast.success("已关联到本案");
        closeDialog();
        router.refresh();
      } catch (err) {
        toast.error("关联失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function submitTerminate() {
    if (!terminateTarget) return;
    if (!terminateReason.trim()) { toast.warning("请填写终止原因"); return; }
    startTransition(async () => {
      try {
        await terminateEngagement({ engagementId: terminateTarget.engagement.id, reason: terminateReason.trim() });
        toast.success("委托已终止");
        closeDialog();
        router.refresh();
      } catch (err) {
        toast.error("终止失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <section className="ll-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <Handshake className="h-3.5 w-3.5 text-primary" />
          委托
          <span className="font-mono text-[11px] tabular text-muted-foreground">
            {activeEngagements.length}/{engagements.length}
          </span>
        </span>
        {canManage && client && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setDialog("link")}>
              <Link2 className="h-3 w-3" />
              关联已有
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setDialog("create")}>
              <Plus className="h-3 w-3" />
              新建委托
            </Button>
          </div>
        )}
      </header>

      {engagements.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted-foreground">
          本案尚未关联委托
          {canManage && client ? "，可新建或关联客户已有委托" : ""}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {engagements.map((row, idx) => {
            const eng = row.engagement;
            const terminated = Boolean(eng.endedAt);
            return (
              <li key={eng.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-4 w-1 rounded-full ${terminated ? "bg-border" : "bg-primary"}`}
                      aria-hidden
                    />
                    <span className={`truncate text-[13px] font-medium ${terminated ? "text-muted-foreground line-through decoration-border" : ""}`}>
                      {eng.title}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-px text-[10px] ${
                        terminated
                          ? "border-border bg-muted text-muted-foreground"
                          : "border-[#B7D8D6] bg-[#E4F1F0] text-[#005054]"
                      }`}
                      title={terminated ? eng.terminatedReason ?? undefined : undefined}
                    >
                      {terminated ? "已终止" : "生效中"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {eng.client.name}
                      {row.validFrom || row.validTo ? (
                        <span className="font-mono tabular">
                          {" "}（{fmtDate(row.validFrom)} ~ {fmtDate(row.validTo)}）
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {eng.scopeText && (
                    <p className="mt-1 line-clamp-2 pl-3 text-xs leading-relaxed text-muted-foreground">
                      委托范围：{eng.scopeText}
                    </p>
                  )}
                  {eng.feeNote && (
                    <p className="mt-0.5 pl-3 text-xs text-muted-foreground">收费备注：{eng.feeNote}</p>
                  )}
                  {terminated && eng.terminatedReason && (
                    <p className="mt-0.5 pl-3 text-xs text-muted-foreground/80">
                      终止原因：{eng.terminatedReason}
                    </p>
                  )}
                  <p className="mt-1 pl-3 font-mono text-[10.5px] tabular text-muted-foreground/70">
                    委托起始 {fmtDate(eng.startedAt)}
                    {eng.endedAt ? ` · 终止于 ${fmtDate(eng.endedAt)}` : ""}
                    {" · "}
                    <span className="font-sans">序</span>
                    {String(idx + 1).padStart(2, "0")}
                  </p>
                </div>
                {canManage && !terminated && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-xs text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    onClick={() => { setTerminateTarget(row); setTerminateReason(""); setDialog("terminate"); }}
                  >
                    <SquareSlash className="h-3 w-3" />
                    终止
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 新建委托 */}
      <Dialog open={dialog === "create"} onOpenChange={o => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建委托</DialogTitle>
            <DialogDescription>
              委托面向客户「{client?.name}」，一个委托可覆盖多个案件事项。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">委托名称 <span className="text-destructive">*</span></Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="如：2026 年度常年法律顾问"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">委托范围</Label>
              <Textarea
                value={scopeText}
                onChange={e => setScopeText(e.target.value)}
                placeholder="如：合同审查、劳动用工咨询、重大事项专项意见"
                rows={3}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">收费备注</Label>
                <Input value={feeNote} onChange={e => setFeeNote(e.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">委托起始日</Label>
                <Input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={linkThisMatter} onCheckedChange={v => setLinkThisMatter(v === true)} />
              同时将本案关联到该委托
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>取消</Button>
            <Button onClick={submitCreate} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 关联已有委托 */}
      <Dialog open={dialog === "link"} onOpenChange={o => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联已有委托</DialogTitle>
            <DialogDescription>
              选择客户「{client?.name}」名下未终止的委托关联到本案；已终止的委托不可再关联。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">委托 <span className="text-destructive">*</span></Label>
              {activeOptions === null ? (
                <div className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取客户委托…
                </div>
              ) : activeOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">该客户暂无未终止的委托，可先新建。</p>
              ) : (
                <Select value={linkEngagementId} onValueChange={setLinkEngagementId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择委托" /></SelectTrigger>
                  <SelectContent>
                    {activeOptions.map(o => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.title}
                        {o.startedAt ? `（${fmtDate(o.startedAt)} 起）` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">关联生效日</Label>
                <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">关联截止日</Label>
                <Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>取消</Button>
            <Button onClick={submitLink} disabled={isPending || !linkEngagementId}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              关联
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 终止委托 */}
      <Dialog open={dialog === "terminate"} onOpenChange={o => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>终止委托「{terminateTarget?.engagement.title}」</DialogTitle>
            <DialogDescription>
              终止后不可再向该委托关联事项，历史关联与记录保留。款项结清情况不受影响，由核销体系独立表达。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">终止原因 <span className="text-destructive">*</span></Label>
            <Textarea
              value={terminateReason}
              onChange={e => setTerminateReason(e.target.value)}
              placeholder="如：委托事项全部办结，双方确认终止"
              rows={3}
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>取消</Button>
            <Button variant="destructive" onClick={submitTerminate} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              确认终止
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
