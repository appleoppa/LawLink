"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  User,
  Calendar,
  Check,
  X,
  Loader2,
  AlertTriangle
} from "lucide-react";
import {
  approveArchiveRecord,
  rejectArchiveRecord,
  batchApproveArchiveRecords,
  batchRejectArchiveRecords
} from "@/server/archive/actions";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";

const CATEGORY_CN: Record<string, string> = {
  CIVIL_COMMERCIAL: "民商",
  CRIMINAL: "刑事",
  ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉",
  LEGAL_COUNSEL: "顾问",
  SPECIAL_PROJECT: "专项"
};

interface PendingRecord {
  id: string;
  archiveNo: string;
  summary: string;
  judgmentSummary: string | null;
  closedReason: string | null;
  completedAt: Date | null;
  archivedAt: Date;
  archivedBy: string;
  missingItems: string[];
  checklistJson: unknown;
  matter: {
    id: string;
    title: string;
    internalCode: string;
    firmCaseNo: string | null;
    category: string;
    primaryClient: { name: string } | null;
  };
}

export function PendingArchiveTable({ records }: { records: PendingRecord[] }) {
  const [dialog, setDialog] = useState<{
    type: "approve" | "reject" | "detail";
    record: PendingRecord;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"approve" | "reject" | null>(null);

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 py-16 text-center text-sm text-muted-foreground">
        当前没有待审批归档申请。律师提交归档后会出现在这里。
      </div>
    );
  }

  const allChecked = records.length > 0 && selected.size === records.length;
  const indeterminate = selected.size > 0 && !allChecked;

  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(records.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectedRecords = records.filter((r) => selected.has(r.id));

  return (
    <>
      {/* 批量操作 toolbar */}
      {selected.size > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            已选 <span className="font-mono font-medium">{selected.size}</span> /{" "}
            <span className="font-mono text-muted-foreground">{records.length}</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </Button>
            <Button
              size="sm"
              onClick={() => setBatchAction("approve")}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              批量通过
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBatchAction("reject")}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              批量驳回
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8">
                <Checkbox
                  checked={allChecked ? true : indeterminate ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="全选"
                />
              </th>
              <th className="px-3 py-2 text-left font-normal w-32">所内案号</th>
              <th className="px-3 py-2 text-left font-normal">案件</th>
              <th className="px-3 py-2 text-left font-normal w-20">类别</th>
              <th className="px-3 py-2 text-left font-normal w-24">委托方</th>
              <th className="px-3 py-2 text-left font-normal w-20">结案方式</th>
              <th className="px-3 py-2 text-left font-normal w-28">提交时间</th>
              <th className="px-3 py-2 text-left font-normal w-20">申请人</th>
              <th className="px-3 py-2 text-left font-normal w-16">缺项</th>
              <th className="px-3 py-2 text-right font-normal w-44">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {records.map((rec) => (
              <tr key={rec.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2.5">
                  <Checkbox
                    checked={selected.has(rec.id)}
                    onCheckedChange={() => toggleOne(rec.id)}
                    aria-label={`选择 ${rec.archiveNo}`}
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-[#9B7BF7]">
                  {rec.matter.firmCaseNo ?? "—"}
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={matterHref(rec.matter)}
                    className="hover:text-[#5B8DEF] transition-colors line-clamp-1"
                  >
                    <FileText className="h-3 w-3 inline mr-1 text-muted-foreground" />
                    {rec.matter.title}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {CATEGORY_CN[rec.matter.category] ?? rec.matter.category}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  <User className="h-3 w-3 inline mr-1 text-muted-foreground" />
                  {rec.matter.primaryClient?.name ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {rec.closedReason
                    ? CLOSED_REASON_CN[
                        rec.closedReason as keyof typeof CLOSED_REASON_CN
                      ]
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3 inline mr-1" />
                  {rec.archivedAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2.5 text-xs">{rec.archivedBy}</td>
                <td className="px-3 py-2.5">
                  {rec.missingItems.length > 0 ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 text-amber-500 text-[10px]"
                    >
                      {rec.missingItems.length} 项
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">齐</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDialog({ type: "detail", record: rec })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      查看
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      type="button"
                      onClick={() => setDialog({ type: "approve", record: rec })}
                      className="inline-flex items-center gap-0.5 text-xs text-emerald-600 hover:text-emerald-500"
                    >
                      <Check className="h-3 w-3" />
                      通过
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      type="button"
                      onClick={() => setDialog({ type: "reject", record: rec })}
                      className="inline-flex items-center gap-0.5 text-xs text-destructive hover:text-destructive/80"
                    >
                      <X className="h-3 w-3" />
                      驳回
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.type === "approve" && (
        <ApproveDialog
          record={dialog.record}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "reject" && (
        <RejectDialog record={dialog.record} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "detail" && (
        <DetailDialog record={dialog.record} onClose={() => setDialog(null)} />
      )}
      {batchAction === "approve" && (
        <BatchApproveDialog
          records={selectedRecords}
          onClose={(succeeded) => {
            setBatchAction(null);
            if (succeeded) setSelected(new Set());
          }}
        />
      )}
      {batchAction === "reject" && (
        <BatchRejectDialog
          records={selectedRecords}
          onClose={(succeeded) => {
            setBatchAction(null);
            if (succeeded) setSelected(new Set());
          }}
        />
      )}
    </>
  );
}

type BatchResult = {
  succeeded: string[];
  failed: { id: string; error: string }[];
};

function BatchApproveDialog({
  records,
  onClose
}: {
  records: PendingRecord[];
  onClose: (succeeded: boolean) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BatchResult | null>(null);
  const withMissing = records.filter((r) => r.missingItems.length > 0);
  const recordById = new Map(records.map((r) => [r.id, r]));

  function submit(ids?: string[]) {
    const targetIds = ids ?? records.map((r) => r.id);
    startTransition(async () => {
      try {
        const res = await batchApproveArchiveRecords({
          archiveIds: targetIds,
          note: note.trim() || undefined
        });
        setResult({ succeeded: res.succeeded, failed: res.failed });
        if (res.failed.length === 0) {
          toast.success(`已批量通过 ${res.succeeded.length} 条`);
        } else {
          toast.warning(
            `部分成功：${res.succeeded.length} 成功，${res.failed.length} 失败`
          );
        }
        router.refresh();
      } catch (err) {
        toast.error("批量通过失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-500" />
            批量通过 {records.length} 条归档申请
          </DialogTitle>
          <DialogDescription>
            通过后涉案件全部进入「已归档」只读状态，且通知申请人。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {withMissing.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                有 {withMissing.length} 条申请存在材料缺项（
                {withMissing
                  .slice(0, 3)
                  .map((r) => r.archiveNo)
                  .join("、")}
                {withMissing.length > 3 ? "…" : ""}）。确认知悉后再通过。
              </span>
            </div>
          )}
          {result === null && (
            <div className="space-y-1.5">
              <Label className="text-xs">统一审批备注（可选）</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="备注会写入每条归档记录"
                rows={2}
              />
            </div>
          )}
          {result !== null && (
            <BatchResultPanel result={result} recordById={recordById} />
          )}
        </div>
        <DialogFooter>
          {result === null ? (
            <>
              <Button variant="outline" onClick={() => onClose(false)} disabled={isPending}>
                取消
              </Button>
              <Button
                onClick={() => submit()}
                disabled={isPending}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                确认通过 {records.length} 条
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose(true)}>
                完成
              </Button>
              {result.failed.length > 0 && (
                <Button
                  onClick={() => submit(result.failed.map((f) => f.id))}
                  disabled={isPending}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  重试失败的 {result.failed.length} 条
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchResultPanel({
  result,
  recordById
}: {
  result: BatchResult;
  recordById: Map<string, PendingRecord>;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
          <div className="text-[10px] text-emerald-700">成功</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-700">{result.succeeded.length}</div>
        </div>
        <div
          className={cn(
            "rounded border px-3 py-2",
            result.failed.length > 0
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-muted/30"
          )}
        >
          <div className={cn("text-[10px]", result.failed.length > 0 ? "text-destructive" : "text-muted-foreground")}>失败</div>
          <div
            className={cn(
              "mt-0.5 font-mono text-lg",
              result.failed.length > 0 ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {result.failed.length}
          </div>
        </div>
      </div>
      {result.failed.length > 0 && (
        <div className="rounded border border-border bg-card">
          <div className="border-b border-border px-2 py-1.5 text-[10px] text-muted-foreground">
            失败条目
          </div>
          <ul className="max-h-40 divide-y divide-border overflow-y-auto">
            {result.failed.map((f) => {
              const rec = recordById.get(f.id);
              return (
                <li key={f.id} className="px-2 py-1.5">
                  <div className="font-mono text-[#9B7BF7]">{rec?.archiveNo ?? f.id}</div>
                  <div className="mt-0.5 text-destructive">{f.error}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function BatchRejectDialog({
  records,
  onClose
}: {
  records: PendingRecord[];
  onClose: (succeeded: boolean) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BatchResult | null>(null);
  const recordById = new Map(records.map((r) => [r.id, r]));

  function submit(ids?: string[]) {
    if (!note.trim()) {
      toast.warning("请填写驳回原因（将统一应用到所选记录）");
      return;
    }
    const targetIds = ids ?? records.map((r) => r.id);
    startTransition(async () => {
      try {
        const res = await batchRejectArchiveRecords({
          archiveIds: targetIds,
          note: note.trim()
        });
        setResult({ succeeded: res.succeeded, failed: res.failed });
        if (res.failed.length === 0) {
          toast.success(`已批量驳回 ${res.succeeded.length} 条`);
        } else {
          toast.warning(
            `部分成功：${res.succeeded.length} 成功，${res.failed.length} 失败`
          );
        }
        router.refresh();
      } catch (err) {
        toast.error("批量驳回失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="h-5 w-5 text-destructive" />
            批量驳回 {records.length} 条归档申请
          </DialogTitle>
          <DialogDescription>
            驳回原因将统一发送给每条申请的提交律师。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {result === null && (
            <>
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                <div className="text-muted-foreground mb-1">本次驳回：</div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {records.map((r) => (
                    <div key={r.id} className="font-mono text-[#9B7BF7]">
                      {r.archiveNo}
                      <span className="ml-2 text-muted-foreground">{r.matter.title}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  统一驳回原因 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="如：本批结案小结普遍过于简略，请补充裁判要旨与办案心得后重新提交"
                  rows={4}
                />
              </div>
            </>
          )}
          {result !== null && (
            <BatchResultPanel result={result} recordById={recordById} />
          )}
        </div>
        <DialogFooter>
          {result === null ? (
            <>
              <Button variant="outline" onClick={() => onClose(false)} disabled={isPending}>
                取消
              </Button>
              <Button variant="destructive" onClick={() => submit()} disabled={isPending}>
                {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                确认驳回 {records.length} 条
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose(true)}>
                完成
              </Button>
              {result.failed.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => submit(result.failed.map((f) => f.id))}
                  disabled={isPending}
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  重试失败的 {result.failed.length} 条
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({
  record,
  onClose
}: {
  record: PendingRecord;
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        await approveArchiveRecord({
          archiveId: record.id,
          note: note.trim() || undefined
        });
        toast.success(`已通过归档申请（${record.archiveNo}）`);
        onClose();
        router.refresh();
      } catch (err) {
        toast.error("审批失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-500" />
            通过归档申请
          </DialogTitle>
          <DialogDescription>
            通过后案件状态变为「已归档」，全部 server action 进入只读门禁。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="font-mono text-[#9B7BF7]">{record.archiveNo}</div>
            <div className="text-muted-foreground mt-0.5">
              {record.matter.internalCode} · {record.matter.title}
            </div>
          </div>
          {record.missingItems.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                此申请有 {record.missingItems.length} 项材料缺失，请确认知悉后再通过。
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">审批备注（可选）</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注会写入归档记录与时间线，律师可见"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={isPending}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            确认通过
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  record,
  onClose
}: {
  record: PendingRecord;
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!note.trim()) {
      toast.warning("请填写驳回原因");
      return;
    }
    startTransition(async () => {
      try {
        await rejectArchiveRecord({
          archiveId: record.id,
          note: note.trim()
        });
        toast.success(`已驳回（${record.archiveNo}）`);
        onClose();
        router.refresh();
      } catch (err) {
        toast.error("驳回失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="h-5 w-5 text-destructive" />
            驳回归档申请
          </DialogTitle>
          <DialogDescription>
            驳回后该归档申请失效，律师需根据原因调整后重新提交。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="font-mono text-[#9B7BF7]">{record.archiveNo}</div>
            <div className="text-muted-foreground mt-0.5">
              {record.matter.internalCode} · {record.matter.title}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              驳回原因 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：缺关键证据材料；办案小结过于简略；裁判文书未上传等"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={isPending}
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            确认驳回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  record,
  onClose
}: {
  record: PendingRecord;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#9B7BF7]" />
            归档申请详情
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-[#9B7BF7]">{record.archiveNo}</span>
            <span className="text-muted-foreground"> · 申请人 {record.archivedBy}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <Field
              label="案件"
              value={`${record.matter.internalCode} · ${record.matter.title}`}
            />
            <Field
              label="委托方"
              value={record.matter.primaryClient?.name ?? "—"}
            />
            <Field
              label="结案方式"
              value={
                record.closedReason
                  ? CLOSED_REASON_CN[
                      record.closedReason as keyof typeof CLOSED_REASON_CN
                    ]
                  : "—"
              }
            />
            <Field
              label="结案日期"
              value={
                record.completedAt
                  ? record.completedAt.toISOString().slice(0, 10)
                  : "—"
              }
            />
          </div>
          {record.judgmentSummary && (
            <Section title="裁判结果摘要">{record.judgmentSummary}</Section>
          )}
          <Section title="结案小结">{record.summary}</Section>
          {record.missingItems.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <div className="text-xs font-medium text-amber-700 mb-1">
                缺项材料（{record.missingItems.length}）
              </div>
              <div className="text-xs text-amber-700/80 break-all">
                {record.missingItems.join("、")}
              </div>
            </div>
          )}
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <Link
              href={matterHref(record.matter)}
              target="_blank"
              className="text-xs text-[#5B8DEF] hover:underline"
            >
              → 打开案件详情查看完整材料与卷宗
            </Link>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <div className="rounded-md border border-border/60 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}
