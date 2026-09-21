"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
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
import { createTask } from "@/server/tasks/actions";
import { civilKey, shParts, WEEKDAY_CN } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type MatterPickerItem = { id: string; internalCode: string; title: string };

export function AddTaskDialog({
  open,
  onOpenChange,
  date,
  matters
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: Date | null;
  matters: MatterPickerItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [matterId, setMatterId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<0 | 1 | 2>(0);
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState("09:00");

  useEffect(() => {
    if (!open) return;
    setMatterId("");
    setTitle("");
    setDescription("");
    setPriority(0);
    setAllDay(false);
    setTime("09:00");
  }, [open]);

  function submit() {
    if (!matterId) {
      toast.warning("请选择关联案件");
      return;
    }
    if (!title.trim()) {
      toast.warning("请填写事项标题");
      return;
    }
    if (!date) {
      toast.warning("缺少日期");
      return;
    }

    // 合成 dueAt（上海时区）：date 是 sh-time「本地正午」载体，不能用浏览器本地 setHours——
    // 境外浏览器会把所选时刻/全天边界挪到别的日历日；统一以 +08:00 拼接
    const key = civilKey(date);
    const [hhStr, mmStr] = time.split(":");
    const timePart = allDay ? "23:59" : `${hhStr ?? "09"}:${mmStr ?? "00"}`;
    const dueAt = new Date(`${key}T${timePart}:00+08:00`);

    startTransition(async () => {
      try {
        await createTask({
          matterId,
          title: title.trim(),
          description,
          dueAt,
          priority,
          assigneeId: "",
          stageId: ""
        });
        toast.success("任务已创建");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("创建失败", {
          description: actionErrorMessage(err)
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            新建任务
          </DialogTitle>
          <DialogDescription className="text-xs">
            {date
              ? (() => {
                  const p = shParts(date);
                  return `${p.y}年${p.m}月${p.d}日 星期${WEEKDAY_CN[p.w] ?? p.w}`;
                })()
              : "—"}
          </DialogDescription>
        </DialogHeader>
        <FormDialogBody>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              关联案件 <span className="text-destructive">*</span>
            </Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {matters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {m.internalCode}
                    </span>
                    <span className="ml-2">{m.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              事项标题 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="如：起草起诉状 / 提交证据清单"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" />
              时间
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                step={300}
                value={time}
                disabled={allDay}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 font-mono text-sm tabular disabled:opacity-50"
              />
              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                全天
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">描述（可选）</Label>
            <Textarea
              rows={2}
              placeholder="事项详情、相关材料等"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">优先级</Label>
            <div className="flex gap-2">
              {[
                { value: 0, label: "普通" },
                { value: 1, label: "高" },
                { value: 2, label: "紧急" }
              ].map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value as 0 | 1 | 2)}
                  className={
                    priority === p.value
                      ? "rounded-md border border-primary bg-primary/15 px-3 py-1 text-xs text-primary"
                      : "rounded-md border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:bg-muted hover:text-foreground"
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        </FormDialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button onClick={submit} disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
