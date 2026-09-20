"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock3, Gavel, Plus } from "lucide-react";
import { PageHeader, RiskLadder, Segmented } from "@/components/patterns/moan";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ScheduleItem } from "@/server/schedule/query";
import { deadlineCategoryLabel, procedureTypeLabel } from "@/lib/enums";
import { CalendarSubscriptionDialog } from "./calendar-subscription-dialog";
import { AddTaskDialog } from "./add-task-dialog";
import { matterHref } from "@/lib/matters/route";
import { SH_TZ, civilFromKey, civilKey, shDayKey, shDaysFromToday, shParts, shTime, shTodayCivil } from "@/lib/ui/sh-time";

/* 墨案 09：事件配色——开庭蓝、法定期限红、所内提醒琥珀、任务 teal */
const TYPE_META = {
  hearing: { icon: Gavel, label: "开庭", color: "#1E56C8" },
  deadline: { icon: AlertTriangle, label: "期限", color: "#B42318" },
  task: { icon: ClipboardList, label: "任务", color: "#007B7F" }
} as const;
const typeMeta = TYPE_META;

/** 法定期限（红）与所内提醒（琥珀，自定义期限）分开着色 */
function evClass(item: ScheduleItem) {
  if (item.type === "hearing") return "ev-court";
  if (item.type === "task") return "ev-task";
  return item.category && item.category !== "CUSTOM" ? "ev-dead-red" : "ev-dead-amber";
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const VISIBLE_ITEMS_PER_DAY = 2;
type View = "week" | "calendar" | "list";

export function ScheduleView({
  items,
  matters
}: {
  items: ScheduleItem[];
  matters: { id: string; internalCode: string; title: string }[];
}) {
  const params = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "list" ? "list" : params.get("view") === "week" ? "week" : "calendar");
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [detailItem, setDetailItem] = useState<ScheduleItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<Date | null>(null);

  const itemsWithDate = useMemo(() => items.map((it) => ({ ...it, dateKey: shDayKey(it.occurredAt) })), [items]);
  const itemsByKey = useMemo(() => {
    const map = new Map<string, (ScheduleItem & { dateKey: string })[]>();
    for (const it of itemsWithDate) {
      if (!map.has(it.dateKey)) map.set(it.dateKey, []);
      map.get(it.dateKey)!.push(it);
    }
    for (const list of map.values()) list.sort((x, y) => new Date(x.occurredAt).getTime() - new Date(y.occurredAt).getTime());
    return map;
  }, [itemsWithDate]);

  const today = shTodayCivil();

  function openAddDialog(date?: Date | null) {
    setAddDate(date ?? today);
    setAddOpen(true);
  }

  // 点击时现取「今天」：useTopbarAction 只在挂载时注册一次，闭包里的 today 跨天后是旧值
  useTopbarAction({ label: "新建任务", onClick: () => openAddDialog(shTodayCivil()) }, []);

  return (
    <div className="mo-schedule">
      <PageHeader
        title="日程"
        sub="开庭、法定期限、所内提醒与任务统一呈现 · 红色只用于逾期与法定期限"
        actions={
          <>
            <CalendarSubscriptionDialog />
            <Segmented
              items={[
                { key: "week", label: "周" },
                { key: "calendar", label: "月历" },
                { key: "list", label: "列表" }
              ]}
              value={view}
              onChange={setView}
            />
          </>
        }
      />

      <div className="cal-grid">
        <div className="min-w-0">
          {view === "calendar" ? (
            <CalendarView itemsByKey={itemsByKey} monthOffset={monthOffset} onOffsetChange={setMonthOffset} onSelectItem={setDetailItem} onAddDay={openAddDialog} />
          ) : view === "week" ? (
            <WeekView itemsByKey={itemsByKey} weekOffset={weekOffset} onOffsetChange={setWeekOffset} onSelectItem={setDetailItem} onAddDay={openAddDialog} />
          ) : (
            <ListView items={itemsWithDate} today={today} onSelectItem={setDetailItem} />
          )}
        </div>
        <ScheduleSideRail items={itemsWithDate} itemsByKey={itemsByKey} onSelectItem={setDetailItem} onSwitchToList={() => setView("list")} />
      </div>

      <ScheduleItemDialog item={detailItem} onOpenChange={(open) => !open && setDetailItem(null)} />
      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} date={addDate} matters={matters} />
    </div>
  );
}

function Legend() {
  const dot = (bg: string, label: string) => (
    <span className="t-xs t-mute" style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span className="dot" style={{ width: 8, height: 8, background: bg }} />
      {label}
    </span>
  );
  return (
    <div className="hidden flex-wrap gap-3 md:flex">
      {dot("var(--blue)", "开庭")}
      {dot("var(--red)", "法定期限")}
      {dot("var(--amber)", "所内提醒")}
      {dot("var(--teal)", "任务")}
    </div>
  );
}

function EventChip({ item, onSelect }: { item: ScheduleItem; onSelect: (item: ScheduleItem) => void }) {
  const hasTime = shTime(item.occurredAt) !== "00:00";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      title={`${typeMeta[item.type].label}：${hasTime ? `${formatTime(item.occurredAt)} ` : ""}${item.title} · ${displaySubject(item)}`}
      className={cn("ev w-full border-0 text-left font-[inherit]", evClass(item), item.completed && "line-through opacity-50")}
    >
      <span className="t">{hasTime ? formatTime(item.occurredAt) : "—"}</span>
      <span className="min-w-0 truncate">{item.type === "hearing" && !/^(开庭|庭审|询问)/.test(item.title) ? `开庭·${item.title}` : item.title}</span>
    </button>
  );
}

function CalendarView({
  itemsByKey,
  monthOffset,
  onOffsetChange,
  onSelectItem,
  onAddDay
}: {
  itemsByKey: Map<string, (ScheduleItem & { dateKey: string })[]>;
  monthOffset: number;
  onOffsetChange: (n: number) => void;
  onSelectItem: (item: ScheduleItem) => void;
  onAddDay: (date: Date) => void;
}) {
  const now = shTodayCivil();
  const cursor = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 12);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: { date: Date; key: string; out: boolean }[] = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i, 12);
    cells.push({ date: d, key: civilKey(d), out: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day, 12);
    cells.push({ date: d, key: civilKey(d), out: false });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month + 1, nextDay++, 12);
    cells.push({ date: d, key: civilKey(d), out: true });
  }
  const todayKey = shDayKey(new Date());

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <div className="cal-head">
          <span className="cal-month">{year} 年 {month + 1} 月</span>
          <div className="cal-nav">
            <button type="button" onClick={() => onOffsetChange(monthOffset - 1)} aria-label="上一月"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => onOffsetChange(0)} style={{ width: "auto", padding: "0 10px", fontSize: 12 }}>今天</button>
            <button type="button" onClick={() => onOffsetChange(monthOffset + 1)} aria-label="下一月"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <Legend />
      </div>
      <div className="dow">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="cells">
        {cells.map((cell) => {
          const dayItems = itemsByKey.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          return (
            <div key={cell.key} className={cn("cell group relative", cell.out && "out", isToday && "today")}>
              <div className="flex items-center justify-between">
                <span className="d">{cell.out ? `${cell.date.getMonth() + 1}-${cell.date.getDate()}` : cell.date.getDate()}</span>
                <button
                  type="button"
                  onClick={() => onAddDay(cell.date)}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded text-[var(--t-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-sunken)] hover:text-[var(--teal-deep)] focus:opacity-100 group-hover:opacity-100"
                  aria-label={`添加 ${cell.date.getMonth() + 1} 月 ${cell.date.getDate()} 日的任务`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {dayItems.slice(0, VISIBLE_ITEMS_PER_DAY).map((it) => <EventChip key={it.id} item={it} onSelect={onSelectItem} />)}
              {dayItems.length > VISIBLE_ITEMS_PER_DAY ? (
                <button type="button" className="more border-0 bg-transparent p-0 font-[inherit]" onClick={() => onSelectItem(dayItems[VISIBLE_ITEMS_PER_DAY])}>+{dayItems.length - VISIBLE_ITEMS_PER_DAY} 隐藏</button>
              ) : null}
              {isToday && dayItems.length === 0 ? <div className="more">今天 · 无日程</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  itemsByKey,
  weekOffset,
  onOffsetChange,
  onSelectItem,
  onAddDay
}: {
  itemsByKey: Map<string, (ScheduleItem & { dateKey: string })[]>;
  weekOffset: number;
  onOffsetChange: (n: number) => void;
  onSelectItem: (item: ScheduleItem) => void;
  onAddDay: (date: Date) => void;
}) {
  const base = shTodayCivil();
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7) + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const todayKey = shDayKey(new Date());
  const sunday = days[6];
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <div className="cal-head">
          <span className="cal-month">{monday.getMonth() + 1} 月 {monday.getDate()} 日 – {sunday.getMonth() + 1} 月 {sunday.getDate()} 日</span>
          <div className="cal-nav">
            <button type="button" onClick={() => onOffsetChange(weekOffset - 1)} aria-label="上一周"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => onOffsetChange(0)} style={{ width: "auto", padding: "0 10px", fontSize: 12 }}>本周</button>
            <button type="button" onClick={() => onOffsetChange(weekOffset + 1)} aria-label="下一周"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <Legend />
      </div>
      <div className="dow">
        {days.map((d, i) => (
          <div key={i} style={civilKey(d) === todayKey ? { color: "var(--teal-deep)" } : undefined}>
            {WEEKDAYS[i]} <span className="font-mono">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="cells">
        {days.map((d) => {
          const key = civilKey(d);
          const dayItems = itemsByKey.get(key) ?? [];
          return (
            <div key={key} className={cn("cell group", key === todayKey && "today")} style={{ minHeight: 420 }}>
              <button type="button" onClick={() => onAddDay(d)} className="more w-full border-0 bg-transparent p-0 text-left font-[inherit] opacity-0 group-hover:opacity-100">+ 添加任务</button>
              {dayItems.length === 0 ? <div className="more">无日程</div> : dayItems.map((it) => <EventChip key={it.id} item={it} onSelect={onSelectItem} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ items, today, onSelectItem }: { items: (ScheduleItem & { dateKey: string })[]; today: Date; onSelectItem: (item: ScheduleItem) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, (ScheduleItem & { dateKey: string })[]>();
    for (const it of items.filter((x) => civilFromKey(x.dateKey).getTime() >= today.getTime() - 7 * 86_400_000)) {
      if (!map.has(it.dateKey)) map.set(it.dateKey, []);
      map.get(it.dateKey)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items, today]);

  if (groups.length === 0) {
    return <div className="card"><div className="empty"><div className="mo-empty-title">近期没有日程</div><div className="mo-empty-desc">开庭、期限与任务登记后会按日期出现在这里。</div></div></div>;
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {groups.map(([key, group]) => {
        const d = civilFromKey(key);
        const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
        return (
          <div key={key}>
            <div className="flex items-center gap-2 border-b border-[var(--bd-hair)] bg-[#FAFBFA] px-3.5 py-2">
              <span className={cn("text-[12.5px] font-[650]", days === 0 && "text-[var(--teal-deep)]")}>{d.getMonth() + 1}月{d.getDate()}日</span>
              <span className="t-xs t-mute">{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
              <span className={cn("t-xs ml-auto", days < 0 ? "t-red" : "t-mute")}>{days === 0 ? "今天" : days === 1 ? "明天" : days > 0 ? `${days} 天后` : `${-days} 天前`}</span>
            </div>
            {group.map((it) => <SideItem key={it.id} item={it} onSelectItem={onSelectItem} lead={formatTime(it.occurredAt)} />)}
          </div>
        );
      })}
    </div>
  );
}

function SideItem({ item, onSelectItem, lead }: { item: ScheduleItem; onSelectItem: (item: ScheduleItem) => void; lead: string }) {
  const overdue = item.type === "deadline" && !item.completed && new Date(item.occurredAt).getTime() < Date.now();
  return (
    <button type="button" onClick={() => onSelectItem(item)} className="today-item w-full border-0 bg-transparent text-left font-[inherit]">
      <span className={cn("w-12 shrink-0 font-mono text-[12px]", overdue ? "t-red" : "t-mute")}>{lead}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("tt block truncate", item.completed && "line-through opacity-60")}>
          {item.type === "hearing" && !/^(开庭|庭审|询问)/.test(item.title) ? `开庭 · ${item.title}` : item.title}
          {item.type === "deadline" && item.category && item.category !== "CUSTOM" ? "（法定）" : ""}
        </span>
        <span className="tm block truncate">
          {[lead === formatTime(item.occurredAt) ? null : formatTime(item.occurredAt), displaySubject(item), item.procedureLabel ? formatProcedureLabel(item.procedureLabel) : null].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}

function ScheduleSideRail({
  items,
  itemsByKey,
  onSelectItem,
  onSwitchToList
}: {
  items: (ScheduleItem & { dateKey: string })[];
  itemsByKey: Map<string, (ScheduleItem & { dateKey: string })[]>;
  onSelectItem: (item: ScheduleItem) => void;
  onSwitchToList: () => void;
}) {
  const nowMs = Date.now();
  const dayMs = 86_400_000;
  const dayDiff = (d: Date) => shDaysFromToday(d);
  const open = items.filter((it) => (it.type === "deadline" || it.type === "task") && !it.completed);
  const buckets = [
    { label: "已逾期", test: (t: number) => t < 0, tone: "red" as const, level: 4 },
    { label: "3 日内到期", test: (t: number) => t >= 0 && t <= 3, tone: "red" as const, level: 3 },
    { label: "7 日内到期", test: (t: number) => t > 3 && t <= 7, tone: "amber" as const, level: 3 },
    { label: "30 日内到期", test: (t: number) => t > 7 && t <= 30, tone: "blue" as const, level: 2 }
  ].map((b) => ({ ...b, list: open.filter((it) => b.test(dayDiff(it.occurredAt))) }));
  const todayKey = shDayKey(new Date());
  const todayItems = itemsByKey.get(todayKey) ?? [];
  const tomorrowFirst = itemsByKey.get(shDayKey(nowMs + dayMs))?.[0];
  const upcoming = items.filter((it) => shDaysFromToday(it.occurredAt) >= 1 && !it.completed).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()).slice(0, 5);
  const todayTitle = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: SH_TZ });

  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 14 }} className="min-w-0 xl:sticky xl:top-[68px]">
      <div className="card">
        <div className="panel-head">
          <div className="panel-title" style={{ fontSize: 13 }}>
            <Clock3 className="ic" strokeWidth={1.8} />
            今日 · {todayTitle}
          </div>
          {todayItems.length ? <span className="mo-count">{todayItems.length}</span> : null}
        </div>
        {todayItems.length === 0 ? (
          <div style={{ padding: "8px 14px 12px" }}>
            <div className="empty" style={{ padding: "16px 10px" }}>
              <div className="empty-ic"><CheckCircle2 /></div>
              <div style={{ fontSize: 12.5, color: "var(--t-muted)" }}>今天没有安排</div>
              {tomorrowFirst ? <div className="t-xs t-faint" style={{ marginTop: 3 }}>明天 {formatTime(tomorrowFirst.occurredAt)} {tomorrowFirst.title}</div> : null}
            </div>
          </div>
        ) : (
          todayItems.map((it) => <SideItem key={it.id} item={it} onSelectItem={onSelectItem} lead={formatTime(it.occurredAt)} />)
        )}
      </div>

      <div className="card">
        <div className="panel-head">
          <div className="panel-title" style={{ fontSize: 13 }}>
            <AlertTriangle className="ic" strokeWidth={1.8} />
            期限预警阶梯
          </div>
          <span className="t-xs t-mute">未来 30 天</span>
        </div>
        {buckets.map((b) => (
          <button key={b.label} type="button" disabled={!b.list.length} onClick={() => b.list[0] && onSelectItem(b.list[0])} className="warn-row w-full border-0 bg-transparent text-left font-[inherit] disabled:cursor-default">
            <span className="warn-count" style={{ color: b.list.length ? (b.tone === "red" ? "var(--red)" : b.tone === "amber" ? "var(--amber)" : "var(--t-secondary)") : "var(--t-faint)" }}>{b.list.length}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="warn-label">{b.label}</div>
              <div className="t-xs t-mute truncate">{b.list.length ? b.list.slice(0, 2).map((it) => `${it.title} · ${displaySubject(it)}`).join("；") : "—"}</div>
            </div>
            <RiskLadder level={b.level} tone={b.tone} />
          </button>
        ))}
        <div className="panel-foot t-xs t-mute">提醒档位：T-3 / T-1 / T-0 / T+1，另加各规则建议提前档（管理后台 · 期限规则库）</div>
      </div>

      <div className="card">
        <div className="panel-head">
          <div className="panel-title" style={{ fontSize: 13 }}>
            <CalendarDays className="ic" strokeWidth={1.8} />
            即将到来
          </div>
          <button type="button" onClick={onSwitchToList} className="t-xs t-mute hover:text-[var(--t-primary)]">列表视图 →</button>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无即将到来的日程</div></div>
        ) : (
          upcoming.map((it) => {
            const d = dayDiff(it.occurredAt);
            return <SideItem key={it.id} item={it} onSelectItem={onSelectItem} lead={d === 1 ? "明天" : formatMonthDay(it.occurredAt)} />;
          })
        )}
      </div>
    </aside>
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
                    href={item.href??matterHref(item.matter)}
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
                <Link href={item.href??matterHref(item.matter)}>查看案件</Link>
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

function formatTime(value: Date) {
  return shTime(value);
}

function formatFullDate(value: Date) {
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: SH_TZ
  });
}

function formatMonthDay(value: Date) {
  const p = shParts(value);
  return `${p.m}-${String(p.d).padStart(2, "0")}`;
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
