"use client";

/**
 * v0.27: 顶部公告 banner
 *
 * 显示 pinned + 未归档 + 未过期 的公告。多条时用左右切换。
 * 关闭只对当前 tab session 生效（不持久化，避免错过新公告）。
 */
import { useState } from "react";
import Link from "next/link";
import { Megaphone, ChevronLeft, ChevronRight, X } from "lucide-react";

type Banner = {
  id: string;
  title: string;
  content: string;
  publishedAt: Date;
};

export function AnnouncementBanner({ banners }: { banners: Banner[] }) {
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const visible = banners.filter((b) => !dismissed.includes(b.id));
  if (visible.length === 0) return null;

  const current = visible[Math.min(idx, visible.length - 1)];

  return (
    <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-2 sm:px-6">
        <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href="/announcements"
              className="truncate text-sm font-medium hover:underline"
            >
              {current.title}
            </Link>
            <span className="hidden text-xs text-amber-800 sm:inline">·</span>
            <span className="hidden truncate text-xs text-amber-800 sm:inline">
              {current.content.length > 80
                ? `${current.content.slice(0, 80)}…`
                : current.content}
            </span>
          </div>
        </div>
        {visible.length > 1 && (
          <div className="flex items-center gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => setIdx((i) => (i - 1 + visible.length) % visible.length)}
              className="rounded p-1 hover:bg-amber-100"
              aria-label="上一条"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <span className="font-mono">
              {Math.min(idx, visible.length - 1) + 1}/{visible.length}
            </span>
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % visible.length)}
              className="rounded p-1 hover:bg-amber-100"
              aria-label="下一条"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setDismissed((prev) => [...prev, current.id])}
          className="rounded p-1 hover:bg-amber-100"
          aria-label="关闭"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
