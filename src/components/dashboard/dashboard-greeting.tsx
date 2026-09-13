"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Calendar, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConflictSearchButton } from "./conflict-search-button";
import type { ScheduleItem } from "@/server/dashboard/actions";
import { matterHref } from "@/lib/matters/route";

function getGreeting(hour: number) {
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早安";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

const typeMeta = {
  deadline: { icon: AlertTriangle, color: "text-amber-600", label: "期限" },
  hearing: { icon: Calendar, color: "text-primary", label: "开庭" }
};

/** v0.47：工作台顶部问候区 + 右侧近期日程 */
export function DashboardGreeting({
  name,
  summary,
  scheduleItems
}: {
  name: string;
  summary: {
    todayDeadlineCount: number;
    weekHearingCount: number;
    nearTermCount: number;
    overdueDeadlineCount?: number;
    pendingApprovalCount?: number;
  };
  scheduleItems: ScheduleItem[];
}) {
  const router = useRouter();
  const today = new Date();
  const greeting = getGreeting(today.getHours());
  const dateLabel = today.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const focusItem = scheduleItems[0] ?? null;

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
      {/* 墨案批次④（02 效果图）：问候卡白→淡青渐变 + 右上 teal 光斑 */}
      <div
        className="ll-hero-surface relative flex min-h-[150px] flex-col justify-between overflow-hidden px-5 py-4"
        style={{ background: "linear-gradient(135deg, #FFFFFF 0%, #E9F2F1 100%)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(240px 180px at 88% 8%, rgba(0,166,166,0.20) 0%, rgba(0,166,166,0) 65%)"
          }}
        />
        <div className="relative z-[1]">
          <div className="mb-2 inline-flex items-center gap-2 text-[11.5px] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] tabular">
              {dateLabel.replace(/\//g, " / ")}
            </span>
          </div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
            {greeting}
            {name && <span className="text-primary">，{name}</span>}
          </h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            今天有 <Num>{summary.todayDeadlineCount}</Num> 件事需要处理；本周开庭{" "}
            <Num>{summary.weekHearingCount}</Num> 场
            {(summary.overdueDeadlineCount ?? 0) > 0 ? (
              <>
                ，<span className="font-mono text-[1.05rem] font-semibold tabular text-[#B42318]">{summary.overdueDeadlineCount}</span>
                <span className="text-[#B42318]"> 项期限已逾期</span>
              </>
            ) : null}
            ，待你审批的申请有 <Num>{summary.pendingApprovalCount ?? 0}</Num> 件。
          </p>
        </div>

        <div className="relative z-[1] mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => router.push("/matters?tab=intake&new=1")}
            className="gap-1.5 px-4"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            新建收案
          </Button>
          <ConflictSearchButton />
          {/* 墨案 02 效果图：操作区第三入口 */}
          <Button variant="ghost" onClick={() => router.push("/schedule")} className="gap-1.5">
            <Calendar className="h-4 w-4" strokeWidth={1.8} />
            进入日程
          </Button>
        </div>
      </div>

      <Link
        href={focusItem?.matterId
          ? matterHref({ id: focusItem.matterId, internalCode: focusItem.matterCode })
          : "/schedule"}
        className="ll-surface group relative flex min-h-[150px] min-w-0 flex-col justify-between overflow-hidden p-4 transition-colors hover:border-input hover:bg-muted/35"
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#B42318]/10 blur-sm" />
        <div className="relative z-[1]">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase text-muted-foreground">
            <span className="ll-dot bg-[#B42318] shadow-[0_0_0_3px_rgba(180,35,24,0.16)]" />
            今日焦点 · 全案最近期限
          </div>
          {focusItem ? (
            <>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-mono text-[44px] font-semibold leading-none tabular text-[#B42318]" style={{ letterSpacing: "-0.035em" }}>
                  {Math.max(focusItem.daysUntil, 0)}
                </span>
                <span className="text-[12px] text-muted-foreground">天</span>
              </div>
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                距 <b className="font-medium text-foreground">{focusItem.title}</b>
                {focusItem.date ? <span className="font-mono"> · {focusItem.date} {focusItem.time ?? ""}</span> : null}
              </div>
              <div
                className="mt-1.5 truncate text-[14.5px] font-bold text-foreground"
                style={{ fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif' }}
                title={focusItem.matter}
              >
                {focusItem.matter}
              </div>
              {focusItem.matterCode ? (
                <div className="mt-0.5 font-mono text-[10.5px] tracking-wide text-muted-foreground tabular">
                  {focusItem.matterCode}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-8 text-sm text-muted-foreground">暂无近期期限</div>
          )}
        </div>
        <div className="relative z-[1] flex items-center gap-1 text-[11.5px] font-medium text-primary">
          前往{focusItem?.matterId ? "案件" : "日程"}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>

      <div className="ll-surface min-w-0 p-3 lg:col-span-2 lg:hidden">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[12px] font-medium text-foreground">近期日程</h3>
          </div>
          <Link
            href="/schedule"
            className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            日历
            <ArrowRight className="h-3 w-3" strokeWidth={1.8} />
          </Link>
        </div>

        {scheduleItems.length > 0 ? (
          <ul className="h-[150px] space-y-1 overflow-y-auto pr-1">
            {scheduleItems.map((item) => (
              <ScheduleBriefItem key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <div className="flex h-[150px] items-center justify-center text-[12px] text-muted-foreground">
            暂无近期事项
          </div>
        )}
      </div>
    </section>
  );
}

function ScheduleBriefItem({ item }: { item: ScheduleItem }) {
  const meta = typeMeta[item.type];
  const Icon = meta.icon;
  const subject = item.clientName ?? item.matter;
  const content = (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className={meta.color} style={{ width: 12, height: 12 }} strokeWidth={1.8} />
      <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
        {meta.label}
      </span>
      <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular text-primary ring-1 ring-primary/15">
        {item.date} {item.time ?? "--:--"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
        {item.title}
        <span className="text-muted-foreground"> · {subject}</span>
      </span>
    </div>
  );
  const className = "block rounded-md px-1.5 py-1 transition-colors hover:bg-muted/70";

  return (
    <li>
      {item.matterId ? (
        <Link href={matterHref({ id: item.matterId, internalCode: item.matterCode })} className={className}>
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono text-[1.15rem] font-medium tabular text-foreground"
      style={{ letterSpacing: "-0.02em" }}
    >
      {children}
    </span>
  );
}
