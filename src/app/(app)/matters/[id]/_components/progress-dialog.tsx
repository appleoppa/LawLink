"use client";

/**
 * 案卷工作台「＋记录」：沟通与研判（2026-09-15 入口统一，原「登记进展 / 写研判笔记」）：
 * - 办案记录（事务记录）：沟通、送达、会见等事实登记，按渠道归类；
 * - 研判：人工判断内容，带 `研判笔记` 标签（数据标签不变）独立陈列，可按环节归档。
 * 期限、任务、开庭仍走各自的专用表单，本弹窗只提供入口。
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Landmark, ListChecks, Loader2 } from "lucide-react";
import { createNote } from "@/server/notes/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioChips } from "@/components/ui/radio-chips";
import { Segmented } from "@/components/patterns/moan";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JUDGMENT_NOTE_TAG, stageNoteTag } from "./procedure-workflow-panel";
import { shDayKey, shTime } from "@/lib/ui/sh-time";

type Mode = "record" | "judgment";
const CHANNELS = [
  { value: "COURT", label: "法院沟通/送达" },
  { value: "PHONE", label: "电话" },
  { value: "WECHAT", label: "微信" },
  { value: "EMAIL", label: "邮件" },
  { value: "MEETING", label: "面谈/会见" },
  { value: "OTHER", label: "其他" }
] as const;

/** 记录时间默认「现在的上海墙钟」；datetime-local 值统一按 +08:00 解释，非上海浏览器不偏移 */
function nowSh() {
  const now = new Date();
  return `${shDayKey(now)}T${shTime(now)}`;
}
function parseSh(value: string): Date {
  return new Date(`${value}:00+08:00`);
}

export function ProgressDialog({
  open,
  onOpenChange,
  matterId,
  initialMode = "record",
  initialStage,
  stageNames,
  onAddTask,
  onAddDeadline,
  onAddHearing
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  initialMode?: Mode;
  initialStage?: string;
  stageNames: string[];
  onAddTask?: () => void;
  onAddDeadline?: () => void;
  onAddHearing?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [channel, setChannel] = useState<string>("COURT");
  const [withWhom, setWithWhom] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowSh());
  const [content, setContent] = useState("");
  const [stage, setStage] = useState(initialStage ?? "");

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStage(initialStage ?? "");
    setChannel("COURT");
    setWithWhom("");
    setOccurredAt(nowSh());
    setContent("");
  }, [open, initialMode, initialStage]);

  function submit() {
    if (!content.trim()) {
      toast.warning(mode === "judgment" ? "请填写研判内容" : "请填写记录内容");
      return;
    }
    startTransition(async () => {
      try {
        await createNote({
          matterId,
          channel: (mode === "judgment" ? "OTHER" : channel) as "OTHER",
          withWhom: mode === "judgment" ? "" : withWhom,
          occurredAt: parseSh(occurredAt),
          content: content.trim(),
          tags: mode === "judgment" ? [JUDGMENT_NOTE_TAG, ...(stage ? [stageNoteTag(stage)] : [])] : stage ? [stageNoteTag(stage)] : []
        });
        toast.success(mode === "judgment" ? "研判已保存" : "记录已保存");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  const jump = (fn?: () => void) =>
    fn
      ? () => {
          onOpenChange(false);
          fn();
        }
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{mode === "judgment" ? "添加记录 · 研判" : "添加记录 · 沟通"}</DialogTitle>
          <DialogDescription>
            {mode === "judgment" ? "我的判断与分析，独立陈列，不与事实记录混排；保存后写入审计。" : "记录已发生的沟通、送达、会见等事实，自动带时间与操作人。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <Segmented
            items={[
              { key: "record", label: "沟通" },
              { key: "judgment", label: "研判" }
            ]}
            value={mode}
            onChange={setMode}
          />

          {mode === "record" ? (
            <>
              <div className="space-y-1.5">
                <Label>类型</Label>
                <RadioChips items={CHANNELS.map((c) => ({ value: c.value, label: c.label }))} value={channel} onChange={setChannel} size="sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>对象</Label>
                  <Input value={withWhom} onChange={(e) => setWithWhom(e.target.value)} placeholder="如：长宁法院 · 书记员" maxLength={80} />
                </div>
                <div className="space-y-1.5">
                  <Label>发生时间</Label>
                  <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
                </div>
              </div>
            </>
          ) : null}

          {stageNames.length > 0 ? (
            <div className="space-y-1.5">
              <Label>归档到环节（可选）</Label>
              <Select value={stage || "__none__"} onValueChange={(v) => setStage(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不归档到环节</SelectItem>
                  {stageNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>{mode === "judgment" ? "研判内容" : "记录内容"}</Label>
            <Textarea
              rows={mode === "judgment" ? 7 : 4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={5000}
              placeholder={mode === "judgment" ? "第一行作为标题，如：诉讼方案 v2 · 争议焦点与举证思路" : "如：签收法院送达材料 2 份（开庭传票、举证通知）"}
            />
          </div>

          {mode === "record" && (onAddTask || onAddDeadline || onAddHearing) ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-[8px] bg-[var(--bg-sunken)] px-2.5 py-2">
              <span className="t-xs t-mute mr-1">改记事项：</span>
              {onAddTask ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={jump(onAddTask)}>
                  <ListChecks />
                  任务
                </button>
              ) : null}
              {onAddDeadline ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={jump(onAddDeadline)}>
                  <CalendarClock />
                  期限
                </button>
              ) : null}
              {onAddHearing ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={jump(onAddHearing)}>
                  <Landmark />
                  开庭
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            保存
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
