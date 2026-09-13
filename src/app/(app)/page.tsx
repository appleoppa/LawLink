/**
 * 概览（原「工作台」，墨案 02 效果图整页移植：hero / 行动卡 / 日程+待办双栏 / 图表）。
 * DOM 结构与 class 对应 docs/mockup/v4/02-dashboard.html，数据接真实 dashboard actions。
 */
import Link from "next/link";
import {
  ClipboardCheck, Gavel, Timer, TriangleAlert, ChevronRight,
  AlertTriangle, Calendar as CalendarIcon
} from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { ConflictSearchButton } from "@/components/dashboard/conflict-search-button";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { loadAlerts, type AlertItem } from "@/components/dashboard/alerts-list";
import { matterHref } from "@/lib/matters/route";
import {
  getDashboardRevenueTrend,
  getDashboardCategoryDistribution,
  getDashboardSchedule,
  getDashboardHeroData
} from "@/server/dashboard/actions";

export default async function DashboardPage() {
  const session = await getSession();
  const [revenueTrend, categoryDistribution, scheduleItems, hero, alerts] = await Promise.all([
    getDashboardRevenueTrend(),
    getDashboardCategoryDistribution(),
    getDashboardSchedule(),
    getDashboardHeroData(),
    loadAlerts(session?.user.id ?? null, session?.user.role ?? null)
  ]);

  const now = new Date();
  const name = session?.user?.name ?? "";
  const hour = now.getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早安" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const dateLabel = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, " / ");
  const weekday = now.toLocaleDateString("zh-CN", { weekday: "short" });

  const focus = scheduleItems[0] ?? null;
  const focusHref = focus?.matterId
    ? matterHref({ id: focus.matterId, internalCode: focus.matterCode })
    : "/schedule";

  // 日程按日期分组（含星期）
  const groups = scheduleItems.reduce<Record<string, typeof scheduleItems>>((acc, it) => {
    const key = `${it.date} · ${it.weekday}`;
    (acc[key] ??= []).push(it);
    return acc;
  }, {});

  const tiles = [
    { href: "/approvals", icon: ClipboardCheck, ic: "ai-red", num: String(hero.pendingSealCount), color: "#B42318", label: "待我审批" },
    { href: "/schedule", icon: Timer, ic: "ai-amber", num: String(hero.nearTermCount), color: "#96650B", label: "7 日内到期期限" },
    { href: "/schedule", icon: Gavel, ic: "ai-blue", num: String(hero.weekHearingCount), color: "#1E56C8", label: "本周开庭" },
    { href: "/schedule", icon: TriangleAlert, ic: "ai-red", num: String(hero.overdueDeadlineCount), color: "#B42318", label: hero.overdueDeadlineCount > 0 ? "逾期期限 · 需立即处理" : "逾期期限" }
  ];

  const alertBadge: Record<AlertItem["source"], string> = { preservation: "保全", sms: "法院短信", approval: "审批" };

  return (
    <div className="pb-8">
      {/* ① Hero：问候 + 今日焦点（02 效果图） */}
      <section className="hero">
        <div className="hero-greet">
          <div className="greet-date">
            <span className="pill-date">{dateLabel} · {weekday}</span>
          </div>
          <h1 className="greet-title">
            {greeting}
            {name ? <span className="name">，{name}</span> : null}
          </h1>
          <p className="greet-sub">
            今天有 <span className="num">{hero.todayDeadlineCount}</span> 件事需要处理；本周开庭{" "}
            <span className="num">{hero.weekHearingCount}</span> 场
            {hero.overdueDeadlineCount > 0 ? (
              <>
                ，<span className="num-warn">{hero.overdueDeadlineCount}</span>
                <span style={{ color: "#B42318" }}> 项期限已逾期</span>
              </>
            ) : null}
            ，待你审批的申请有 <span className="num">{hero.pendingSealCount}</span> 件。
          </p>
          <div className="greet-actions">
            <Link href="/matters?tab=intake&new=1" className="btn btn-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
              新建收案
            </Link>
            <ConflictSearchButton />
            <Link href="/schedule" className="btn btn-ghost">
              <CalendarIcon className="ic-15" strokeWidth={1.8} />
              进入日程
            </Link>
          </div>
        </div>

        <Link href={focusHref} className="hero-focus">
          <div className="focus-label">
            <span className="dot dot-red dot-pulse-red" />
            今日焦点 · 全案最近期限
          </div>
          {focus ? (
            <>
              <div className="focus-countdown">
                <span className="focus-days">{Math.max(focus.daysUntil, 0)}</span>
                <span className="focus-unit">天</span>
              </div>
              <div className="focus-tag">
                距 <b>{focus.title}</b>
                {focus.date ? <span className="mono"> · {focus.date} {focus.time ?? ""}</span> : null}
              </div>
              <div className="focus-matter">{focus.matter}</div>
              {focus.matterCode ? <div className="focus-code">{focus.matterCode}</div> : null}
            </>
          ) : (
            <div className="focus-countdown" style={{ margin: "auto 0" }}>
              <span className="focus-days" style={{ color: "#1A7F45", fontSize: 30 }}>✓</span>
              <span className="focus-unit">暂无近期期限</span>
            </div>
          )}
          <div className="focus-link">前往{focus?.matterId ? "案件" : "日程"} →</div>
        </Link>
      </section>

      {/* ② 行动入口四卡 */}
      <div className="action-grid">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.label} href={t.href} className="card card-hover action-tile">
              <div className={`action-ic ${t.ic}`}>
                <Icon strokeWidth={1.8} />
              </div>
              <div>
                <div className="action-num" style={{ color: t.color }}>{t.num}</div>
                <div className="action-label">{t.label}</div>
              </div>
              <ChevronRight className="action-arrow" width={14} height={14} strokeWidth={2} />
            </Link>
          );
        })}
      </div>

      {/* ③ 近期日程 + 待我处理 */}
      <div className="dash-main-grid">
        <div className="card">
          <div className="panel-head">
            <div className="panel-title">
              <CalendarIcon className="ic" strokeWidth={1.8} />
              近期日程
            </div>
            <Link href="/schedule" className="t-sm t-mute">完整日历 →</Link>
          </div>
          <div style={{ paddingBottom: 12 }}>
            {Object.keys(groups).length === 0 ? (
              <div className="empty">
                <div className="empty-ic"><CalendarIcon /></div>
                <div style={{ fontSize: 12.5, color: "var(--t-muted)" }}>未来 30 天暂无开庭与期限</div>
              </div>
            ) : (
              Object.entries(groups).map(([key, items]) => (
                <div key={key}>
                  <div className="sched-day-head">
                    <span className="sched-day">{key.split(" · ")[0]}</span>
                    <span className="sched-week">{key.split(" · ")[1]}</span>
                    <span className="sched-rule2" />
                  </div>
                  {items.map((it) => {
                    const isDeadline = it.type === "deadline";
                    const days = it.daysUntil;
                    const cd = days <= 0 ? "今天" : days === 1 ? "明天" : `${days} 天`;
                    const row = (
                      <>
                        <span className="sched-time">{it.time ?? "--:--"}</span>
                        <span className={`sched-ic ${isDeadline ? "si-dead" : "si-court"}`}>
                          {isDeadline ? <AlertTriangle strokeWidth={2} /> : <Gavel strokeWidth={2} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="sched-title" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.title}
                          </span>
                          <span className="sched-meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.clientName ?? it.matter}
                            {it.procedure ? ` · ${it.procedure}` : ""}
                          </span>
                        </span>
                        <span className={`cd ${days <= 3 ? "cd-urgent" : days <= 7 ? "cd-soon" : "cd-normal"}`}>{cd}</span>
                      </>
                    );
                    return it.matterId ? (
                      <Link key={it.id} href={matterHref({ id: it.matterId, internalCode: it.matterCode })} className="sched-item">{row}</Link>
                    ) : (
                      <div key={it.id} className="sched-item">{row}</div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel-head">
            <div className="panel-title">
              <ClipboardCheck className="ic" strokeWidth={1.8} />
              待我处理
            </div>
            <span className="badge b-slate">{alerts.length} 项</span>
          </div>
          <div style={{ flex: 1 }}>
            {alerts.length === 0 ? (
              <div className="empty">
                <div className="empty-ic"><ClipboardCheck /></div>
                <div style={{ fontSize: 12.5, color: "var(--t-muted)" }}>暂无待处理事项</div>
              </div>
            ) : (
              alerts.map((a) => (
                <Link key={a.id} href={a.href} className="todo-item">
                  <span style={{ paddingTop: 4 }}>
                    <span className={`dot ${a.tone === "danger" ? "dot-red dot-pulse-red" : a.tone === "warn" ? "dot-amber dot-pulse-amber" : "dot-slate"}`} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="todo-title" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                    <span className="todo-meta">
                      <span>{alertBadge[a.source]}</span>
                      <span className="todo-sep" />
                      <span>{a.detail}</span>
                    </span>
                  </span>
                  <span className={`badge todo-type ${a.tone === "danger" ? "b-red" : a.tone === "warn" ? "b-amber" : "b-slate"}`}>
                    {alertBadge[a.source]}
                  </span>
                </Link>
              ))
            )}
          </div>
          <div className="panel-foot" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="t-xs t-mute">保全到期 · 法院短信 · 待审批用章</span>
            <Link href="/schedule" className="t-sm" style={{ color: "var(--teal-deep)", fontWeight: 550 }}>全部 →</Link>
          </div>
        </div>
      </div>

      {/* ④ 图表 */}
      <div className="chart-grid">
        <RevenueChart data={revenueTrend} />
        <CategoryChart data={categoryDistribution} />
      </div>
    </div>
  );
}
