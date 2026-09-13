"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Archive,
  Pause,
  Play,
  Loader2,
  MoreHorizontal,
  Lock,
  Download,
  BadgeCheck,
  RotateCcw
} from "lucide-react";
import type { MatterStatus } from "@prisma/client";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  closeMatter,
  reopenMatter,
  holdMatter,
  completeMatterService,
  activateMatterService
} from "@/server/matters/lifecycle";
import { ArchiveWizardDialog } from "./archive-wizard";

export function LifecycleActions({
  matterId,
  status,
  serviceStatus,
  canArchive,
  canChangeStatus = true,
  extraItems = []
}: {
  matterId: string;
  status: MatterStatus;
  serviceStatus?: "SERVICE_ACTIVE" | "SERVICE_COMPLETED" | null;
  canArchive: boolean;
  /** 无主办/协办权限时只显示 extraItems（查看类入口） */
  canChangeStatus?: boolean;
  /** 墨案 04 页头「···」菜单：案件级入口（编辑信息、新增程序、财务明细等） */
  extraItems?: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; onSelect: () => void }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"close" | "hold" | "service" | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [text, setText] = useState("");

  const isArchived = status === "ARCHIVED";
  const serviceDone = serviceStatus === "SERVICE_COMPLETED";

  function open(d: "close" | "hold" | "service") {
    setText("");
    setDialog(d);
  }

  function handleSubmit() {
    if (dialog === "close" && !text.trim()) {
      toast.warning("请填写结案小结");
      return;
    }
    startTransition(async () => {
      try {
        if (dialog === "close") {
          await closeMatter({ id: matterId, summary: text });
          toast.success("案件已结案");
        } else if (dialog === "hold") {
          await holdMatter({ id: matterId, reason: text });
          toast.success("案件已暂停");
        } else if (dialog === "service") {
          await completeMatterService({ id: matterId, note: text });
          toast.success("律师服务已标记完成");
        }
        setDialog(null);
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handleReopenService() {
    if (!confirm("将律师服务恢复为「进行中」？程序与归档状态不变。")) return;
    startTransition(async () => {
      try {
        await activateMatterService(matterId);
        toast.success("服务已恢复进行中");
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handleReopen() {
    if (!confirm("将案件重新开放为'办理中'？")) return;
    startTransition(async () => {
      try {
        await reopenMatter(matterId);
        toast.success("案件已重新开放");
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  const extras = extraItems.map((it) => (
    <DropdownMenuItem key={it.key} onSelect={it.onSelect}>
      <it.icon className="mr-2 h-4 w-4 text-[var(--t-muted)]" />
      {it.label}
    </DropdownMenuItem>
  ));

  if (isArchived) {
    return (
      <>
        <span className="badge b-bronze" style={{ height: 29, padding: "0 10px" }}>
          <Lock className="h-3.5 w-3.5" />
          已归档（只读）
        </span>
        <a href={`/api/archive/${matterId}/export`} className="btn btn-secondary btn-sm" title="导出归档 ZIP（含材料 + 结构化数据 + 卷宗封皮目录）">
          <Download />
          导出 ZIP
        </a>
        {extras.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="更多操作">
                <MoreHorizontal />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">{extras}</DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={isPending} className="btn btn-secondary btn-sm btn-icon" aria-label="更多操作">
            {isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {extras}
          {extras.length > 0 && canChangeStatus ? <DropdownMenuSeparator /> : null}
          {canChangeStatus ? (<>
          {(status === "ON_HOLD" || status === "CLOSED") && (
            <DropdownMenuItem onSelect={handleReopen}>
              <Play className="mr-2 h-4 w-4" />
              重新开放
            </DropdownMenuItem>
          )}
          {status === "IN_PROGRESS" && (
            <DropdownMenuItem onSelect={() => open("hold")}>
              <Pause className="mr-2 h-4 w-4" />
              暂停办理
            </DropdownMenuItem>
          )}
          {status !== "CLOSED" && (
            <DropdownMenuItem onSelect={() => open("close")}>
              <CheckCircle2 className="mr-2 h-4 w-4 text-[var(--green)]" />
              结案
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {serviceDone ? (
            <DropdownMenuItem onSelect={handleReopenService}>
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复服务（服务轴）
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => open("service")}>
              <BadgeCheck className="mr-2 h-4 w-4 text-[var(--bronze)]" />
              完成服务（服务轴）
            </DropdownMenuItem>
          )}
          {canArchive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setArchiveOpen(true)}
                className="text-[var(--bronze)] focus:text-[var(--bronze)]"
              >
                <Archive className="mr-2 h-4 w-4" />
                归档（不可逆）
              </DropdownMenuItem>
            </>
          )}
          </>) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "close" ? "结案" : dialog === "hold" ? "暂停案件" : "完成律师服务"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "close" &&
                "结案后案件状态为'已结案'，仍可编辑。结案小结会进入时间线。"}
              {dialog === "hold" && "暂停后案件不再显示在'办理中'筛选。"}
              {dialog === "service" &&
                "服务轴与程序轴分离：标记服务完成不改案件办理状态，也不校验款项结清；可随时恢复。"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {dialog === "close" ? "结案小结" : dialog === "hold" ? "暂停原因" : "服务完成备注（可选）"}
              {dialog === "close" && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                dialog === "close"
                  ? "如：经一审判决支持原告诉请，对方未上诉，判决已生效"
                  : dialog === "hold"
                    ? "如：等待客户补充证据材料"
                    : "如：全部委托事项已办结，客户确认无需继续跟进"
              }
              rows={5}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={isPending}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {dialog === "close" ? "确认结案" : dialog === "hold" ? "确认暂停" : "确认完成服务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ArchiveWizardDialog
        matterId={matterId}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
      />
    </>
  );
}
