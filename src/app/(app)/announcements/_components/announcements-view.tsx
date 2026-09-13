"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Pin, Plus, Pencil, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { AnnouncementDialog } from "./announcement-dialog";
import { archiveAnnouncement } from "@/server/announcements/actions";
import { toast } from "sonner";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  archivedAt: Date | null;
  author: { id: string; name: string };
};

export function AnnouncementsView({
  items,
  isManager,
  currentUserId
}: {
  items: AnnouncementItem[];
  isManager: boolean;
  currentUserId: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const router = useRouter();

  async function handleArchive(a: AnnouncementItem) {
    if (!confirm(`归档公告"${a.title}"？归档后不再显示但保留历史。`)) return;
    try {
      await archiveAnnouncement(a.id);
      toast.success("已归档");
      router.refresh();
    } catch (err) {
      toast.error("归档失败", { description: err instanceof Error ? err.message : "" });
    }
  }

  const active = items.filter((a) => !a.archivedAt);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl">
            <Megaphone className="h-5 w-5 text-primary" strokeWidth={1.8} />
            公告指引
          </h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            共 {active.length} 条公告 · 置顶公告会显示在全站顶部 公告栏
          </p>
        </div>
        {isManager && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            发布公告
          </Button>
        )}
      </header>

      {active.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-background py-8 text-center text-xs text-muted-foreground">
          暂无公告
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((a) => {
            const canEdit = isManager || a.author.id === currentUserId;
            const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
            return (
              <li key={a.id} className="ll-surface p-4">
                <header className="mb-1.5 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {a.pinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        <Pin className="h-2.5 w-2.5" />置顶
                      </span>
                    )}
                    <h3 className="text-sm font-medium">{a.title}</h3>
                    {expired && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        已过期
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(a);
                          setDialogOpen(true);
                        }}
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleArchive(a)}
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        <Archive className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </header>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
                  {a.content}
                </p>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {a.author.name} · 发布于 {formatDate(a.publishedAt)}
                  {a.expiresAt && ` · 过期于 ${formatDate(a.expiresAt)}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AnnouncementDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}
