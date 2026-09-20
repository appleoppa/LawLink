/**
 * 工作台（墨案 02 效果图）：今日行动与风险（问候 + 今日焦点）→ 行动入口四卡 →
 * 近期日程与期限 + 待我处理 → 趋势与分布（实收应收 / 案件类型 / 客户来源）。
 */
import Link from "next/link";
import { ChevronRight, Gavel, SquareCheck, Timer, TriangleAlert, Calendar as CalendarIcon, Landmark, Clock3, ChartColumn } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { lunarDateLabel } from "@/lib/ui/lunar";
import { ConflictSearchButton } from "@/components/dashboard/conflict-search-button";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CategoryChart } from "@/components/dashboard/category-chart";
import { ClientSourceCard } from "@/components/dashboard/client-source-card";
import { WorkQueueCard } from "@/components/dashboard/work-queue-card";
import { loadAlerts } from "@/components/dashboard/alerts-list";
import { matterHref } from "@/lib/matters/route";
import {
  getDashboardRevenueTrend,
  getDashboardCategoryDistribution,
  getDashboardSchedule,
  getDashboardHeroData,
  getDashboardWorkQueue,
  getDashboardOverdueReceivables,
  getDashboardClientSources
} from "@/server/dashboard/actions";

const money = (n: number) => (n >= 1_000_000 ? `¥${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : n >= 10_000 ? `¥${Math.round(n / 1000)}K` : `¥${Math.round(n).toLocaleString("zh-CN")}`);

export default async function DashboardPage() {
  const session = await getSession();
  const canFinance = Boolean(session?.user && hasCustomPermission(session.user, "finance.read"));
  const [revenueTrend, categoryDistribution, scheduleItems, hero, alerts, queue, overdue, sources] = await Promise.all([
    getDashboardRevenueTrend(),
    getDashboardCategoryDistribution(),
    getDashboardSchedule(),
    getDashboardHeroData(),
    loadAlerts(session?.user.id ?? null, session?.user.role ?? null, session?.user.managerAuthorized === true),
    getDashboardWorkQueue(),
    getDashboardOverdueReceivables().catch(() => null),
    getDashboardClientSources().catch(() => [])
  ]);

  const now = new Date();
  const name = session?.user?.name ?? "";
  const hour = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }));
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const ymd = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).replace(/\//g, " / ");
  const weekday = now.toLocaleDateString("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" });
  const lunar = lunarDateLabel(now);

  const focus = scheduleItems.find((s) => s.type === "deadline") ?? scheduleItems[0] ?? null;
  const focusHref = focus?.matterId ? matterHref({ id: focus.matterId, internalCode: focus.matterCode }) : "/schedule";
  const urgentApprovals = queue.approvals.filter((a) => a.waitDays >= 2).length;
  const todoCount = hero.todayDeadlineCount + queue.tasks.filter((t) => t.overdue).length;

  // 只列最近 3 条：与右侧「待我处理」卡高度对齐，更多进完整日历（2026-09-19 用户确认）
  const SCHEDULE_PREVIEW = 3;
  const groups = scheduleItems.slice(0, SCHEDULE_PREVIEW).reduce<Record<string, typeof scheduleItems>>((acc, it) => {
    (acc[`${it.date}|${it.weekday}`] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div className="mo-dash">
      {/* ① 今日行动与风险 */}
      <section className="hero">
        <div className="hero-greet">
          <div className="greet-date">
            <span className="pill-date">{ymd} · {weekday}</span>
            {lunar ? <span>{lunar}</span> : null}
          </div>
          <h1 className="greet-title">
            {greeting}
            {name ? <span className="name">，{name}</span> : null}
          </h1>
          <p className="greet-sub">
            今天有 <b>{todoCount}</b> 件事需要处理；本周开庭 <b>{hero.weekHearingCount}</b> 场
            {hero.overdueDeadlineCount > 0 ? (
              <>
                ，<b className="warn">{hero.overdueDeadlineCount} 项期限已逾期</b>
              </>
            ) : null}
            ，待你审批的申请有 <b style={{ whiteSpace: "nowrap" }}>{queue.approvalTotal} 件</b>。
          </p>
          <div className="greet-actions">
            <ConflictSearchButton />
            <Link href="/schedule" className="btn btn-ghost">进入日程</Link>
          </div>
        </div>

        <Link href={focusHref} className="hero-focus no-underline">
          <div className="focus-label">
            <span className={`dot ${focus && focus.daysUntil <= 3 ? "dot-red dot-pulse-red" : "dot-amber"}`} />
            今日焦点 · 全案最近期限
          </div>
          {focus ? (
            <>
              <div className="focus-countdown">
                <span className="focus-days" style={focus.daysUntil > 3 ? { color: "var(--amber)" } : undefined}>{Math.abs(focus.daysUntil)}</span>
                <span className="focus-unit">{focus.daysUntil < 0 ? "天 · 已逾期" : focus.daysUntil === 0 ? "天 · 今天到期" : "天"}</span>
              </div>
              <div className="focus-tag">
                {focus.daysUntil < 0 ? "已过" : "距"} <b style={{ color: "var(--t-primary)" }}>{focus.title}</b> · {focus.date} {focus.time ?? ""}
              </div>
              <div className="focus-matter truncate">{focus.matter}</div>
              <div className="focus-code">{[focus.matterCode, focus.procedure].filter(Boolean).join(" · ")}</div>
            </>
          ) : (
            <>
              <div className="focus-countdown">
                <span className="focus-days" style={{ color: "var(--green)", fontSize: 32 }}>✓</span>
              </div>
              <div className="focus-tag">未来 30 天没有未完成的期限</div>
            </>
          )}
          <div className="focus-link">前往{focus?.matterId ? "案件" : "日程"} →</div>
        </Link>
      </section>

      {/* ② 行动入口 */}
      <div className="action-grid">
        <Link href="/approvals" className="card card-hover action-tile no-underline">
          <div className="action-ic ai-red"><SquareCheck strokeWidth={1.8} /></div>
          <div><div className="action-num" style={{ color: queue.approvalTotal ? "var(--red)" : "var(--t-faint)" }}>{queue.approvalTotal}</div><div className="action-label">待我审批{urgentApprovals ? ` · ${urgentApprovals} 件等待超 2 天` : ""}</div></div>
          <ChevronRight className="action-arrow" width={14} height={14} />
        </Link>
        <Link href="/schedule" className="card card-hover action-tile no-underline">
          <div className="action-ic ai-amber"><Timer strokeWidth={1.8} /></div>
          <div><div className="action-num" style={{ color: hero.nearTermCount ? "var(--amber)" : "var(--t-faint)" }}>{hero.nearTermCount}</div><div className="action-label">7 日内到期期限{hero.overdueDeadlineCount ? ` · 另有逾期 ${hero.overdueDeadlineCount}` : ""}</div></div>
          <ChevronRight className="action-arrow" width={14} height={14} />
        </Link>
        <Link href="/schedule" className="card card-hover action-tile no-underline">
          <div className="action-ic ai-blue"><Landmark strokeWidth={1.8} /></div>
          <div><div className="action-num" style={{ color: hero.weekHearingCount ? "var(--blue)" : "var(--t-faint)" }}>{hero.weekHearingCount}</div><div className="action-label">本周开庭</div></div>
          <ChevronRight className="action-arrow" width={14} height={14} />
        </Link>
        {canFinance && overdue ? (
          <Link href="/finance?tab=aging" className="card card-hover action-tile no-underline">
            <div className="action-ic ai-bronze"><ChartColumn strokeWidth={1.8} /></div>
            <div><div className="action-num" style={{ color: overdue.amount ? "var(--bronze)" : "var(--t-faint)" }}>{overdue.amount ? money(overdue.amount) : "¥0"}</div><div className="action-label">逾期未回款{overdue.clientCount && overdue.amount ? ` · ${overdue.clientCount} 家客户` : ""}</div></div>
            <ChevronRight className="action-arrow" width={14} height={14} />
          </Link>
        ) : (
          <Link href="/schedule" className="card card-hover action-tile no-underline">
            <div className="action-ic ai-red"><TriangleAlert strokeWidth={1.8} /></div>
            <div><div className="action-num" style={{ color: hero.overdueDeadlineCount ? "var(--red)" : "var(--t-faint)" }}>{hero.overdueDeadlineCount}</div><div className="action-label">逾期期限 · 需立即处理</div></div>
            <ChevronRight className="action-arrow" width={14} height={14} />
          </Link>
        )}
      </div>

      {/* ③ 短周期事项 */}
      <div className="main-grid">
        <div className="card">
          <div className="panel-head">
            <div className="panel-title">
              <CalendarIcon className="ic" strokeWidth={1.8} />
              近期日程与期限
            </div>
            <Link href="/schedule" className="t-sm t-mute">完整日历 →</Link>
          </div>
          <div style={{ paddingBottom: 12 }}>
            {Object.keys(groups).length === 0 ? (
              <div className="empty mo-empty-compact">
                <div className="empty-ic"><CalendarIcon /></div>
                <div className="mo-empty-title">未来 30 天暂无开庭与期限</div>
              </div>
            ) : (
              Object.entries(groups).map(([key, items]) => {
                const [day, week] = key.split("|");
                return (
                  <div key={key}>
                    <div className="sched-day-head">
                      <span className="sched-day">{day}</span>
                      <span className="sched-week">{week}</span>
                      <span className="sched-rule" />
                    </div>
                    {items.map((it) => {
                      const isDeadline = it.type === "deadline";
                      const d = it.daysUntil;
                      const tone = d <= 3 ? "urgent" : d <= 7 ? "soon" : "normal";
                      const icStyle = isDeadline
                        ? d <= 3
                          ? { background: "var(--red-bg)", color: "var(--red)" }
                          : { background: "var(--amber-bg)", color: "var(--amber)" }
                        : { background: "var(--blue-bg)", color: "var(--blue)" };
                      const body = (
                        <>
                          <span className="sched-time">{it.time ?? "全天"}</span>
                          <span className="sched-ic" style={icStyle}>{isDeadline ? <Clock3 strokeWidth={2} /> : <Gavel strokeWidth={2} />}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="sched-title block truncate">{isDeadline || /^(开庭|庭审|询问)/.test(it.title) ? it.title : `开庭 · ${it.title}`}</span>
                            <span className="sched-meta block truncate">{[it.matter, it.procedure].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className={`cd cd-${tone}`}>{d < 0 ? `逾期 ${-d} 天` : d === 0 ? "今天" : d === 1 ? "明天" : `${d} 天`}</span>
                        </>
                      );
                      return it.matterId ? (
                        <Link key={it.id} href={matterHref({ id: it.matterId, internalCode: it.matterCode })} className="sched-item no-underline">{body}</Link>
                      ) : (
                        <div key={it.id} className="sched-item">{body}</div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <WorkQueueCard queue={queue} alerts={alerts} />
      </div>

      {/* ④ 趋势和分布 */}
      <div className="chart-grid">
        {canFinance ? <RevenueChart data={revenueTrend} /> : (
          <div className="card"><div className="empty"><div className="mo-empty-title">无财务查看权限</div><div className="mo-empty-desc">实收与应收趋势仅对具备财务查看权限的账号展示。</div></div></div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CategoryChart data={categoryDistribution} />
          <ClientSourceCard rows={sources} />
        </div>
      </div>
    </div>
  );
}
