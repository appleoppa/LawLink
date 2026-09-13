"use client";

import type { TimelineEvent } from "@prisma/client";
import { Clock, FileText, Gavel, Coins, CalendarClock, ListChecks, Upload, Users } from "lucide-react";

const iconByType: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  MATTER_CREATED: FileText,
  PROCEDURE_ADDED: FileText,
  HEARING_SCHEDULED: Gavel,
  FEE_RECEIVED: Coins,
  // v0.43 项4：补齐案件动态
  DEADLINE_ADDED: CalendarClock,
  STAGE_ADDED: ListChecks,
  STAGE_REMOVED: ListChecks,
  TASK_ADDED: ListChecks,
  DOCUMENT_UPLOADED: Upload,
  TEAM_CHANGED: Users
};

const colorByType: Record<string, string> = {
  MATTER_CREATED: "#1E56C8",
  PROCEDURE_ADDED: "#007B7F",
  HEARING_SCHEDULED: "#96650B",
  FEE_RECEIVED: "#1A7F45",
  DEADLINE_ADDED: "#96650B",
  STAGE_ADDED: "#007B7F",
  STAGE_REMOVED: "#98A3AD",
  TASK_ADDED: "#6C3FC5",
  DOCUMENT_UPLOADED: "#1E56C8",
  TEAM_CHANGED: "#007B7F"
};

export function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  // v0.43：按发生时间倒序（最新动态在上）
  const sorted = [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
        <p className="text-sm text-muted-foreground">还没有时间线事件</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <ul className="relative space-y-4">
        <span
          aria-hidden
          className="absolute left-[15px] top-1 bottom-1 w-px bg-border"
        />
        {sorted.map((e) => {
          const Icon = iconByType[e.eventType] ?? Clock;
          const color = colorByType[e.eventType] ?? "#1E56C8";
          return (
            <li key={e.id} className="relative flex gap-3 pl-1">
              <div
                className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card"
                style={{ borderColor: `${color}50` }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color }} />
              </div>
              <div className="flex-1 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{e.title}</span>
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground tabular">
                  {new Date(e.occurredAt).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </div>
                {e.content && (
                  <p className="mt-1 text-xs text-muted-foreground">{e.content}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
