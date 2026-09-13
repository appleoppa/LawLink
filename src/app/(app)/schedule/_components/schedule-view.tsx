"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gavel,
  AlertTriangle,
  List,
  Plus,
  Grid3X3,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn, daysUntil } from "@/lib/utils";
import type { ScheduleItem } from "@/server/schedule/query";
import { deadlineCategoryLabel, procedureTypeLabel } from "@/lib/enums";
import { CalendarSubscriptionDialog } from "./calendar-subscription-dialog";
import { AddTaskDialog } from "./add-task-dialog";
import { matterHref } from "@/lib/matters/route";

/* 墨案 09：事件配色——开庭蓝、法定期限红、临期琥珀、任务 teal；红只属于逾期/法定 */
const TYPE_META = {
  hearing: { icon: Gavel, label: "开庭", color: "#1E56C8" },
  deadline: { icon: AlertTriangle, label: "期限", color: "#96650B" },
  task: { icon: ClipboardList, label: "事项", color: "#007B7F" }
} as const;

/** 期限紧迫度：逾期或 3 日内 → 红；其余临期 → 琥珀 */
function deadlineTone(item: ScheduleItem): "red" | "amber" {
  const days = daysUntil(new Date(item.occurredAt));
  return days <= 3 ? "red" : "amber";
}

const EV_TONE = {
  "hearing:": { bg: "#EAF0FE", fg: "#1E56C8" },
  "deadline:red": { bg: "#FBECE9", fg: "#B42318" },
  "deadline:amber": { bg: "#FBF1DC", fg: "#96650B" },
  "task:": { bg: "#E4F1F0", fg: "#005054" }
} as const;

function evTone(item: ScheduleItem) {
  if (item.type === "deadline") return EV_TONE[`deadline:${deadlineTone(item)}`];
  return item.type === "hearing" ? EV_TONE["hearing:"] : EV_TONE["task:"];
}

const typeMeta = TYPE_META;

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const VISIBLE_ITEMS_PER_DAY = 3;

export function ScheduleView({
  items,
  matters
}: {
  items: ScheduleItem[];
  matters: { id: string; internalCode: string; title: string }[];
}) {
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const [monthOffset, setMonthOffset] = useState(0);

  const [detailItem, setDetailItem] = useState<ScheduleItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);

  const itemsWithDate = useMemo(
    () =>
      items.map((it) => ({
        ...it,
        dateKey: dateKey(new Date(it.occurredAt))
      })),
    [items]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function openAddDialog(date?: Date | null) {
    setAddDate(date ?? today);
    setAddOpen(true);
  }

  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h1 className="ll-page-title">日程</h1>
          <p className="ll-page-sub">开庭、法定期限、会议与任务统一呈现 · 红色只用于逾期与阻断</p>
        </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <CalendarSubscriptionDialog />
            <Button size="sm" variant="secondary" onClick={() => openAddDialog()} className="btn btn-secondary btn-sm h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
              添加日程
            </Button>
            <div className="ll-segmented">
              <button
                type="button"
                onClick={() => setView("calendar")}
                className={cn("ll-seg", view === "calendar" && "ll-seg-active text-primary")}
              >
                <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.8} />
                月历
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn("ll-seg", view === "list" && "ll-seg-active text-primary")}
              >
                <List className="h-3.5 w-3.5" strokeWidth={1.8} />
                列表
              </button>
            </div>
          </div>
      </header>

      {view === "list" ? (
        <ListView items={itemsWithDate} today={today} />
      ) : (
        <CalendarView
          items={itemsWithDate}
          monthOffset={monthOffset}
          onOffsetChange={setMonthOffset}
          onSelectItem={setDetailItem}
          onAddDay={openAddDialog}
          onSwitchToList={() => setView("list")}
        />
      )}
      <ScheduleItemDialog item={detailItem} onOpenChange={(open) => !open && setDetailItem(null)} />
      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        date={addDate}
        matters={matters}
      />
    </div>
  );
}

function ListView({
  items,
  today
}: {
  items: (ScheduleItem & { dateKey: string })[];
  today: Date;
}) {
  // 按日分组
  const groups = useMemo(() => {
    const map = new Map<string, (ScheduleItem & { dateKey: string })[]>();
    for (const it of items) {
      if (!map.has(it.dateKey)) map.set(it.dateKey, []);
      map.get(it.dateKey)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="ll-surface border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">未来 90 天没有日程</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([key, group]) => {
        const d = new Date(key);
        const isToday = key === dateKey(today);
        const days = daysUntil(d);
        return (
          <section
            key={key}
            className="ll-surface overflow-hidden"
          >
            <header
              className={cn(
                "ll-panel-head",
                isToday && "bg-accent"
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("text-base font-semibold", isToday && "text-primary")}>
                  {d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.toLocaleDateString("zh-CN", { weekday: "long" })}
                </span>
                {isToday ? (
                  <Badge className="bg-primary text-primary-foreground text-[10px]">今天</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {days === 1 ? "明天" : days > 0 ? `${days} 天后` : `${-days} 天前`}
                  </span>
                )}
              </div>
              <span className="font-mono text-xs tabular text-muted-foreground">
                {group.length} 项
              </span>
            </header>
            <ul className="divide-y divide-border">
              {group.map((it) => (
                <Row key={it.id} item={it} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({ item }: { item: ScheduleItem }) {
  const meta = typeMeta[item.type];
  const Icon = meta.icon;
  const time = formatTime(item.occurredAt);
  const subject = displaySubject(item);

  return (
    <li className="px-5 py-3 transition-colors hover:bg-popover">
      <Link href={matterHref(item.matter)} className="flex items-start gap-3">
        <span className="w-12 shrink-0 font-mono text-sm tabular text-muted-foreground">
          {time}
        </span>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.color }} />
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{item.title}</span>
            <Badge variant="outline" className="text-[9px]" style={{ borderColor: `${meta.color}50`, color: meta.color }}>
              {meta.label}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className={cn(item.clientName ? "" : "font-mono")}>{subject}</span>
            {item.procedureLabel && (
              <>
                <span>·</span>
                <span>
                  {procedureTypeLabel[item.procedureLabel as keyof typeof procedureTypeLabel] ??
                    item.procedureLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function CalendarCellItem({
  item,
  onSelect
}: {
  item: ScheduleItem;
  onSelect: (item: ScheduleItem) => void;
}) {
  const tone = evTone(item);
  const subject = displaySubject(item);
  const hasTime = new Date(item.occurredAt).getHours() !== 0 || new Date(item.occurredAt).getMinutes() !== 0;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item);
      }}
      title={`${typeMeta[item.type].label}：${hasTime ? formatTime(item.occurredAt) + " " : ""}${item.title} · ${subject}`}
      /* 墨案 09：月历事件 = 彩色胶囊（时间等宽 + 标题，单行截断） */
      className={cn(
        "flex w-full min-w-0 items-center gap-[5px] rounded-[5px] px-[7px] py-[2.5px] text-left text-[10.5px] font-medium leading-4 transition-colors hover:brightness-95",
        item.completed && "line-through opacity-50"
      )}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      <span className="shrink-0 font-mono text-[9.5px] tabular opacity-75">
        {hasTime ? formatTime(item.occurredAt) : "—"}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
    </button>
  );
}

function CalendarView({
  items,
  monthOffset,
  onOffsetChange,
  onSelectItem,
  onAddDay,
  onSwitchToList
}: {
  items: (ScheduleItem & { dateKey: string })[];
  monthOffset: number;
  onOffsetChange: (n: number) => void;
  onSelectItem: (item: ScheduleItem) => void;
  onAddDay: (date: Date) => void;
  onSwitchToList: () => void;
}) {
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = ((new Date(year, month, 1).getDay() + 6) % 7); // 0=周一

  // 墨案 09：跨月补日——首行用上月尾巴、末行用下月开头，非空格
  type Cell = { date: Date; key: string; out: boolean };
  const cells: Cell[] = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i);
    cells.push({ date: d, key: dateKey(d), out: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({ date: d, key: dateKey(d), out: false });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    const d = new Date(year, month + 1, nextDay++);
    cells.push({ date: d, key: dateKey(d), out: true });
  }

  // 按 key 聚合 items
  const itemsByKey = useMemo(() => {
    const map = new Map<string, (ScheduleItem & { dateKey: string })[]>();
    for (const it of items) {
      if (!map.has(it.dateKey)) map.set(it.dateKey, []);
      map.get(it.dateKey)!.push(it);
    }
    return map;
  }, [items]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);

  const todayItems = [...(itemsByKey.get(todayKey) ?? [])].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );
  // 即将到来：全类型混排（mockup 即将到来卡）
  const upcoming = items
    .filter((item) => new Date(item.occurredAt) >= today)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_296px]">
      <section className="ll-surface overflow-hidden">
        {/* 卡头：月份导航 + 图例（效果图 09 cal-head） */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E8ECEA] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[16px] font-bold tracking-[-0.01em]">
              {year} 年 {month + 1} 月
            </span>
            <div className="flex gap-1">
              <button type="button" onClick={() => onOffsetChange(monthOffset - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E8ECEA] bg-card text-muted-foreground transition-colors hover:bg-[#F2F5F4] hover:text-foreground"
                aria-label="上一月">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onOffsetChange(0)}
                className="h-7 rounded-[7px] border border-[#E8ECEA] bg-card px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-[#F2F5F4] hover:text-foreground">
                今天
              </button>
              <button type="button" onClick={() => onOffsetChange(monthOffset + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E8ECEA] bg-card text-muted-foreground transition-colors hover:bg-[#F2F5F4] hover:text-foreground"
                aria-label="下一月">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#1E56C8]" />开庭</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#B42318]" />法定期限</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#96650B]" />临期提醒</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#007B7F]" />任务</span>
          </div>
        </div>

        {/* 星期表头（右对齐细线，周末弱化） */}
        <div className="grid grid-cols-7 border-b border-[#E8ECEA] bg-[#FAFBFA]">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={w} className={cn("px-2.5 py-2 text-right text-[11px] font-semibold", i === 0 || i === 6 ? "text-[#98A3AD]" : "text-muted-foreground")}>
              周{w}
            </div>
          ))}
        </div>

        {/* 日期格：扁平细线网格（无卡片间距） */}
        <div className="grid grid-cols-7">
          {cells.map((cell, idx) => {
            const dayItems = itemsByKey.get(cell.key) ?? [];
            const visibleItems = dayItems.slice(0, VISIBLE_ITEMS_PER_DAY);
            const isToday = cell.key === todayKey;
            return (
              <div
                key={idx}
                className={cn(
                  "group relative min-h-[108px] border-b border-[#E8ECEA] border-r border-[#E8ECEA] p-[7px_8px] transition-colors",
                  (idx + 1) % 7 === 0 && "border-r-0",
                  cell.out && "bg-[#FAFBFA]",
                  !cell.out && "hover:bg-[#F7FAF9]",
                  isToday && "bg-[#EFF6F5]"
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "font-mono text-[12px] font-semibold tabular",
                      cell.out ? "text-[#B3BDC2]" : isToday ? "text-[#005054]" : "text-foreground/80"
                    )}
                  >
                    {cell.out ? `${cell.date.getMonth() + 1}-${cell.date.getDate()}` : cell.date.getDate()}
                  </span>
                  {!cell.out && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddDay(cell.date);
                      }}
                      className="flex h-[18px] w-[18px] items-center justify-center rounded text-[#98A3AD] opacity-0 transition-opacity hover:bg-[#E9EDEB] hover:text-[#005054] group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`添加 ${cell.date.getMonth() + 1} 月 ${cell.date.getDate()} 日的日程`}
                      title="添加日程"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex min-h-0 flex-col">
                  {visibleItems.map((it) => (
                    <CalendarCellItem key={it.id} item={it} onSelect={onSelectItem} />
                  ))}
                  {dayItems.length > VISIBLE_ITEMS_PER_DAY && (
                    <span className="mt-1 px-1 text-[10px] text-[#98A3AD]">
                      +{dayItems.length - VISIBLE_ITEMS_PER_DAY} 隐藏
                    </span>
                  )}
                  {isToday && dayItems.length === 0 && (
                    <span className="mt-1 text-[10px] text-[#98A3AD]">今天 · 无日程</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <ScheduleSideRail
        items={items}
        todayItems={todayItems}
        upcoming={upcoming}
        onSelectItem={onSelectItem}
        onSwitchToList={onSwitchToList}
      />
    </div>
  );
}

function ScheduleSideRail({
  items,
  todayItems,
  upcoming,
  onSelectItem,
  onSwitchToList
}: {
  items: (ScheduleItem & { dateKey: string })[];
  todayItems: (ScheduleItem & { dateKey: string })[];
  upcoming: (ScheduleItem & { dateKey: string })[];
  onSelectItem: (item: ScheduleItem) => void;
  onSwitchToList: () => void;
}) {
  // 墨案 09 效果图：期限预警阶梯（四级分桶，红只属于逾期档）
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const openDeadlines = items.filter((it) => it.type === "deadline" && !it.completed);
  const ladderBuckets = [
    { label: "已逾期", days: (t: number) => t < 0, ladder: "l-red", on: 4, color: "#B42318" },
    { label: "3 日内到期", days: (t: number) => t >= 0 && t <= 3, ladder: "l-red", on: 3, color: "#B42318" },
    { label: "7 日内到期", days: (t: number) => t > 3 && t <= 7, ladder: "l-amber", on: 3, color: "#96650B" },
    { label: "30 日内到期", days: (t: number) => t > 7 && t <= 30, ladder: "l-blue", on: 2, color: "#1E56C8" }
  ].map((b) => ({
    ...b,
    list: openDeadlines.filter((it) => b.days(Math.floor((it.occurredAt.getTime() - nowMs) / dayMs)))
  }));
  const ladderTotal = ladderBuckets.reduce((n, b) => n + b.list.length, 0);
  const todayTitle = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const tomorrow = new Date(nowMs + dayMs);
  const tomorrowFirst = items
    .filter((it) => new Date(it.occurredAt).toDateString() === tomorrow.toDateString())
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())[0];

  return (
    <aside className="min-w-0 space-y-3.5 xl:sticky xl:top-16">
      {/* 今日卡（效果图 09：空态也要有气质） */}
      <section className="ll-surface overflow-hidden">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title text-[13px]">今日 · {todayTitle}</h3>
        </header>
        {todayItems.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-[#98A3AD]" strokeWidth={1.8} />
            <p className="text-[12.5px] text-muted-foreground">今天没有安排</p>
            {tomorrowFirst && (
              <p className="text-[11px] text-[#98A3AD]">
                明天 {formatTime(tomorrowFirst.occurredAt)} {tomorrowFirst.title}
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border px-4">
            {todayItems.map((item) => (
              <ScheduleSideItem key={item.id} item={item} onSelectItem={onSelectItem} showDate={false} />
            ))}
          </ul>
        )}
      </section>

      <section className="ll-surface overflow-hidden">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title text-[13px]">
            <AlertTriangle className="h-3.5 w-3.5 text-[#96650B]" strokeWidth={1.8} />
            期限预警阶梯
          </h3>
          <span className="text-[10.5px] text-muted-foreground">未来 30 天 · {ladderTotal} 项</span>
        </header>
        <div className="divide-y divide-border">
          {ladderBuckets.map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={b.list.length === 0}
              onClick={() => b.list[0] && onSelectItem(b.list[0])}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:opacity-60"
            >
              <span
                className="w-6 shrink-0 text-right font-mono text-lg font-semibold tabular"
                style={{ color: b.list.length > 0 ? b.color : "var(--t-faint)" }}
              >
                {b.list.length}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">{b.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {b.list[0] ? `${b.list[0].title} · ${formatMonthDay(b.list[0].occurredAt)}` : "—"}
                </span>
              </span>
              <span className={`ladder ${b.ladder}`} aria-hidden>
                {Array.from({ length: 4 }, (_, i) => (
                  <i key={i} className={i < b.on ? "on" : undefined} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ll-surface overflow-hidden">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title text-[13px]">即将到来</h3>
          <button type="button" onClick={onSwitchToList} className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
            列表视图 →
          </button>
        </header>
        {upcoming.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无即将到来的日程</p>
        ) : (
          <ul className="divide-y divide-border px-4">
            {upcoming.map((item) => (
              <ScheduleSideItem key={item.id} item={item} onSelectItem={onSelectItem} showDate />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function ScheduleSideItem({
  item,
  onSelectItem,
  showDate
}: {
  item: ScheduleItem;
  onSelectItem: (item: ScheduleItem) => void;
  showDate: boolean;
}) {
  const meta = typeMeta[item.type];
  const Icon = meta.icon;
  const subject = displaySubject(item);

  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => onSelectItem(item)}
        className="flex w-full min-w-0 gap-3 rounded-sm text-left transition-colors hover:text-primary"
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] tabular text-muted-foreground">
              {showDate ? formatMonthDay(item.occurredAt) : formatTime(item.occurredAt)}
            </span>
            <span className="truncate text-[13px] font-medium">{item.title}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {subject}
            {item.procedureLabel ? ` · ${formatProcedureLabel(item.procedureLabel)}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

function ScheduleItemDialog({
  item,
  onOpenChange
}: {
  item: ScheduleItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(item);
  const meta = item ? typeMeta[item.type] : typeMeta.task;
  const Icon = meta.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="rounded-md p-1.5"
                  style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{ borderColor: `${meta.color}55`, color: meta.color }}
                >
                  {meta.label}
                </Badge>
                {item.completed && (
                  <Badge variant="secondary" className="text-[10px]">
                    已完成
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-base leading-6">{item.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <DetailLine label="时间" value={`${formatFullDate(item.occurredAt)} ${formatTime(item.occurredAt)}`} />
              <DetailLine label="客户" value={item.clientName ?? "未填写客户"} />
              <DetailLine
                label="关联案件"
                value={
                  <Link
                    href={matterHref(item.matter)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {item.matter.title}
                  </Link>
                }
              />
              {item.procedureLabel && (
                <DetailLine label="程序" value={formatProcedureLabel(item.procedureLabel)} />
              )}
              {item.type === "deadline" && item.category && (
                <DetailLine label="期限类型" value={deadlineCategoryLabel[item.category as keyof typeof deadlineCategoryLabel] ?? "类型待核实"} />
              )}
              {item.type === "deadline" && item.remindDays !== undefined && (
                <DetailLine label="提醒" value={`提前 ${item.remindDays} 天`} />
              )}
              {item.type === "task" && item.priority !== undefined && (
                <DetailLine label="优先级" value={priorityLabel(item.priority)} />
              )}
              {item.description && (
                <div className="space-y-1 border-t border-border pt-2">
                  <div className="text-[11px] text-muted-foreground">详情</div>
                  <p className="whitespace-pre-wrap text-sm leading-6">{item.description}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button asChild>
                <Link href={matterHref(item.matter)}>查看案件</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{value}</span>
    </div>
  );
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(value: Date) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatFullDate(value: Date) {
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });
}

function formatMonthDay(value: Date) {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}

function formatProcedureLabel(value: string) {
  return procedureTypeLabel[value as keyof typeof procedureTypeLabel] ?? value;
}

function priorityLabel(value: number) {
  if (value >= 2) return "紧急";
  if (value === 1) return "高";
  return "普通";
}

function displaySubject(item: ScheduleItem) {
  return item.clientName ?? item.matter.internalCode;
}
