"use client";
/**
 * 归档借阅面板（F-6）：我的借阅（查阅/归还）+ 待我审批（批准天数/驳回理由）
 * + 申请借阅（搜索归档号/案号/案名 → 事由）。审批人视图同页就地下钻。
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { confirmDialog, promptDialog } from "@/components/patterns/confirm-dialog";
import { formatDate } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";
import {
  createArchiveBorrow,
  decideArchiveBorrow,
  returnArchiveBorrow,
  searchArchiveForBorrow,
  type BorrowRow
} from "@/server/archive/borrow";

const STATUS_CN: Record<string, string> = {
  PENDING: "待审批", APPROVED: "借阅中", REJECTED: "已驳回", RETURNED: "已归还", EXPIRED: "已到期"
};

export function BorrowPanel({ mine, pending, canApply }: { mine: BorrowRow[]; pending: BorrowRow[]; canApply: boolean }) {
  const [open, setOpen] = useState(false);
  const active = mine.filter((r) => r.status === "APPROVED" && r.accessUntil && r.accessUntil.getTime() > Date.now());

  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <BookOpen className="ic" strokeWidth={1.8} />
          案卷借阅
        </div>
        {canApply ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>申请借阅</Button>
        ) : null}
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {mine.length === 0 && pending.length === 0 ? (
          <p className="t-xs t-mute" style={{ lineHeight: 1.7 }}>
            借阅已归档案卷：搜索归档号 / 案号 / 案名发起申请，审批通过后可在限期内在线查阅（只读），阅毕标记归还。
          </p>
        ) : null}

        {active.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <div className="t-xs t-faint" style={{ marginBottom: 4 }}>借阅中（到期自动失去查阅资格）</div>
            {active.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-1.5" style={{ padding: "5px 0" }}>
                <Link href={matterHref(r.archiveRecord.matter)} className="t-sm underline-offset-2 hover:underline" style={{ flex: 1, minWidth: 200 }}>
                  {r.archiveRecord.matter.internalCode} {r.archiveRecord.matter.title}
                </Link>
                <span className="offset-chip">{r.archiveRecord.archiveNo}</span>
                <span className="t-xs t-mute">至 {formatDate(r.accessUntil!)}</span>
                <ReturnButton id={r.id} />
              </div>
            ))}
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <div className="t-xs t-faint" style={{ marginBottom: 4 }}>待我审批</div>
            {pending.map((r) => (
              <DecideRow key={r.id} row={r} />
            ))}
          </div>
        ) : null}

        {mine.length > 0 ? (
          <div>
            <div className="t-xs t-faint" style={{ marginBottom: 4 }}>我的申请记录</div>
            {mine.slice(0, 8).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-1.5 t-xs t-mute" style={{ padding: "4px 0" }}>
                <span className="offset-chip">{STATUS_CN[r.status] ?? r.status}</span>
                <span style={{ flex: 1, minWidth: 180 }} className="truncate">{r.archiveRecord.matter.internalCode} {r.archiveRecord.matter.title}</span>
                <span>{formatDate(r.createdAt)}</span>
                {r.status === "REJECTED" && r.rejectReason ? <span style={{ color: "var(--red)" }} title={r.rejectReason}>驳回：{r.rejectReason.slice(0, 20)}…</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <BorrowApplyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ReturnButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm" variant="outline" disabled={isPending}
      onClick={() => startTransition(async () => {
        try {
          await returnArchiveBorrow(id);
          toast.success("已标记归还，查阅资格即时不生效");
        } catch (err) {
          toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
        }
      })}
    >
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}阅毕归还
    </Button>
  );
}

function DecideRow({ row }: { row: BorrowRow }) {
  const [isPending, startTransition] = useTransition();
  function decide(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        if (decision === "APPROVED") {
          const ok = await confirmDialog({
            title: `批准借阅：${row.archiveRecord.matter.title}`,
            description: "批准后申请人可在 30 天内在线只读查阅该案卷，到期自动失效。确认批准？",
            confirmText: "批准（30 天）"
          });
          if (!ok) return;
          await decideArchiveBorrow({ id: row.id, revision: row.revision, decision: "APPROVED", days: 30 });
          toast.success("已批准借阅");
        } else {
          const reason = await promptDialog({
            title: `驳回借阅：${row.archiveRecord.matter.title}`,
            description: "驳回理由会记入审计并对申请人可见。",
            label: "驳回理由",
            placeholder: "例如：该案卷涉及未了结的关联争议，暂不外借",
            required: true,
            maxLength: 500,
            confirmText: "驳回",
            danger: true
          });
          if (!reason?.trim()) return;
          await decideArchiveBorrow({ id: row.id, revision: row.revision, decision: "REJECTED", rejectReason: reason });
          toast.success("已驳回");
        }
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" style={{ padding: "5px 0" }}>
      <span className="t-sm" style={{ flex: 1, minWidth: 200 }}>
        {row.archiveRecord.matter.internalCode} {row.archiveRecord.matter.title}
        <span className="t-xs t-mute block truncate">{row.applicant.name}：{row.reason}</span>
      </span>
      <Button size="sm" variant="outline" disabled={isPending} onClick={() => decide("APPROVED")}>批准</Button>
      <Button size="sm" variant="outline" disabled={isPending} onClick={() => decide("REJECTED")}>驳回</Button>
    </div>
  );
}

function BorrowApplyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchArchiveForBorrow>>>([]);
  const [picked, setPicked] = useState<string>("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function search() {
    startTransition(async () => {
      try {
        const r = await searchArchiveForBorrow(q);
        setResults(r);
        if (r.length === 0) toast.info("未找到匹配的已归档案卷");
      } catch (err) {
        toast.error("检索失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function submit() {
    startTransition(async () => {
      try {
        await createArchiveBorrow({ archiveRecordId: picked, reason, scope: "WHOLE_VOLUME" });
        toast.success("借阅申请已提交，等待审批");
        setQ(""); setResults([]); setPicked(""); setReason("");
        onOpenChange(false);
      } catch (err) {
        toast.error("提交失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>申请借阅案卷</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="归档号 / 所内案号 / 案件名称" className="text-xs"
              onKeyDown={(e) => e.key === "Enter" && search()} />
            <Button size="sm" variant="outline" onClick={search} disabled={isPending} className="gap-1.5 shrink-0">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}检索
            </Button>
          </div>
          {results.length > 0 ? (
            <div className="space-y-1">
              {results.map((r) => (
                <label key={r.id} className="flex items-center gap-2 t-sm" style={{ padding: "4px 8px", borderRadius: 7, background: picked === r.id ? "var(--blue-bg)" : "var(--bg-sunken)", cursor: "pointer" }}>
                  <input type="radio" checked={picked === r.id} onChange={() => setPicked(r.id)} />
                  <span style={{ flex: 1 }}>{r.matter.internalCode} {r.matter.title}</span>
                  <span className="t-xs t-mute">{r.archiveNo} · {formatDate(r.archivedAt)}</span>
                </label>
              ))}
            </div>
          ) : null}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="借阅事由（必填，如：客户回头咨询再审准备）" className="text-xs" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={isPending || !picked || reason.trim().length < 5} className="gap-1.5">
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}提交申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
