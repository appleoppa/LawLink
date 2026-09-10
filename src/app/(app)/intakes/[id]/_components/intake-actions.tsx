"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { ArrowRight, XCircle, Loader2, Clock, RotateCcw, AlertCircle } from "lucide-react";
import type { IntakeStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  declineIntake,
  convertIntakeToMatter,
  markIntakeNeedsRevision,
  resubmitIntake
} from "@/server/intakes/actions";
import { matterHref } from "@/lib/matters/route";

export function IntakeActions({
  intakeId,
  status
}: {
  intakeId: string;
  status?: IntakeStatus;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [isPending, startTransition] = useTransition();
  const [dialogKind, setDialogKind] = useState<"decline" | "revision" | null>(null);
  const [reason, setReason] = useState("");

  const role = session?.user?.role;
  const canApprove = role === "ADMIN" || role === "PRINCIPAL_LAWYER";

  // 律师端：待补正状态 → 显示"重新提交"按钮
  function handleResubmit() {
    if (!confirm("确认重新提交审批？")) return;
    startTransition(async () => {
      try {
        await resubmitIntake(intakeId);
        toast.success("已重新提交审批");
        router.refresh();
      } catch (err) {
        toast.error("操作失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  if (status === "NEEDS_REVISION") {
    return (
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5" />
          待补正：补充材料后可重新提交
        </div>
        <Button size="sm" onClick={handleResubmit} disabled={isPending} className="gap-1.5">
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          重新提交
        </Button>
      </div>
    );
  }

  if (!canApprove) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        等待管理员/主任律师审批
      </div>
    );
  }

  function handleConvert() {
    if (!confirm("确认转为正式案件？将占用一个案件编号。")) return;
    startTransition(async () => {
      try {
        const res = await convertIntakeToMatter(intakeId);
        toast.success(`已转化为案件 ${res.internalCode}`);
        router.push(matterHref({ id: res.matterId, internalCode: res.internalCode }));
      } catch (err) {
        toast.error("转化失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  function openDialog(kind: "decline" | "revision") {
    setReason("");
    setDialogKind(kind);
  }

  function handleConfirm() {
    if (!reason.trim()) {
      toast.warning(dialogKind === "decline" ? "请填写不接案原因" : "请填写补正说明");
      return;
    }
    startTransition(async () => {
      try {
        if (dialogKind === "decline") {
          await declineIntake({ id: intakeId, reason });
          toast.success("已标记为不接案");
        } else {
          await markIntakeNeedsRevision({ id: intakeId, reason });
          toast.success("已标记待补正，律师可补充后重新提交");
        }
        setDialogKind(null);
        router.refresh();
      } catch (err) {
        toast.error("操作失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  const isDecline = dialogKind === "decline";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDialog("revision")}
          disabled={isPending}
          className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
        >
          <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
          需补正
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDialog("decline")}
          disabled={isPending}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <XCircle className="mr-1.5 h-3.5 w-3.5" />
          不接案
        </Button>
        <Button
          size="sm"
          onClick={handleConvert}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          转为正式案件
        </Button>
      </div>

      <Dialog open={dialogKind !== null} onOpenChange={(o) => !o && setDialogKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isDecline ? "标记不接案" : "标记待补正"}</DialogTitle>
            <DialogDescription>
              {isDecline
                ? "终态：此收案不会再转为正式案件。仍保留在历史中。"
                : "律师补充材料后可点击「重新提交审批」，区别于真正的不接案。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reason" className="text-xs">
              {isDecline ? "不接案原因" : "需补正项目"} *
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isDecline
                  ? "如：与已有客户存在阻塞性冲突 / 客户已撤回 / 不在业务范围内 ..."
                  : "如：缺身份证扫描件 / 委托代理合同未签字 / 利益冲突说明不充分 ..."
              }
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogKind(null)} disabled={isPending}>
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isPending || !reason.trim()}
              variant={isDecline ? "destructive" : "default"}
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isDecline ? "确认不接案" : "标记待补正"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
