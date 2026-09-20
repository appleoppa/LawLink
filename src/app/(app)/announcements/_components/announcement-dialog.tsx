"use client";

import { FormDialogContent as DialogContent, FormDialogBody } from "@/components/patterns/form-dialog";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  createAnnouncement,
  updateAnnouncement
} from "@/server/announcements/actions";
import { shDayKey } from "@/lib/ui/sh-time";

type Editing = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  expiresAt: Date | null;
} | null;

function toDateInput(d: Date | null): string {
  return d ? shDayKey(d) : "";
}

export function AnnouncementDialog({
  open,
  onOpenChange,
  editing
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Editing;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      if (editing) {
        setTitle(editing.title);
        setContent(editing.content);
        setPinned(editing.pinned);
        setExpiresAt(toDateInput(editing.expiresAt));
      } else {
        setTitle("");
        setContent("");
        setPinned(false);
        setExpiresAt("");
      }
    }
  }, [open, editing]);

  function handleSave() {
    if (!title.trim() || !content.trim()) {
      toast.error("标题和内容必填");
      return;
    }
    startTransition(async () => {
      try {
        const payload = {
          title,
          content,
          pinned,
          expiresAt: expiresAt ? new Date(`${expiresAt}T00:00+08:00`) : null
        };
        if (editing) {
          await updateAnnouncement({ ...payload, id: editing.id });
          toast.success("已更新");
        } else {
          await createAnnouncement(payload);
          toast.success("已发布");
        }
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("保存失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑公告" : "发布公告"}</DialogTitle>
          <DialogDescription className="text-xs">
            置顶公告会显示在全站顶部 公告栏，设置过期日期后 公告栏 自动消失（列表仍保留）。
          </DialogDescription>
        </DialogHeader>
        <FormDialogBody>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">标题 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">内容 *</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="支持普通文本换行"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={pinned}
                onCheckedChange={(c) => setPinned(c === true)}
              />
              置顶（顶部 公告栏）
            </label>
            <div className="space-y-1.5">
              <Label className="text-xs">过期日期（可选）</Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
        </div>

        </FormDialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {editing ? "更新" : "发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
