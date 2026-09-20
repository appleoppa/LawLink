"use server";
import {closedHearingIds} from "@/server/reminders/responsibility";
import { agingFromFacts } from "@/server/finance/facts-aging";
import { getFinanceFacts, periodReceipts, sumAmounts, shMonthStart, financeTrend } from "@/server/finance/facts";

import { customMatterFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { matterFinanceVisibilityFilter, matterReadVisibilityFilter, intakeReadVisibilityFilter } from "@/lib/permissions";
import { matterCategoryColor, matterCategoryLabel, matterCategoryShort, procedureTypeLabel } from "@/lib/enums";
import { shDayKey } from "@/lib/ui/sh-time";
import { matterHref } from "@/lib/matters/route";

// ============ Types ============

export type TrendDirection = "up" | "down" | "warn";

export type KpiItem = {
  key: string;
  label: string;
  value: number;
  valueFormat?: "currency";
  trend: { direction: TrendDirection; text: string };
  sparkline: number[];
};

export type ScheduleItem = {
  id: string;
  date: string;
  weekday: string;
  time?: string;
  type: "deadline" | "hearing";
  title: string;
  matter: string;
  clientName: string | null;
  matterId: string | null;
  matterCode: string | null; // internalCode，详情页路由键
  procedure?: string;
  daysUntil: number; // 距今天数（0=今天）
};

export type HeroData = {
  todayDeadlineCount: number;
  weekHearingCount: number;
  nearTermCount: number;
  overdueDeadlineCount: number;
  pendingSealCount: number;
  focus: {
    title: string;
    matter: string;
    internalCode: string;
    daysLeft: number;
    href: string;
  } | null;
};

// ============ KPIs ============

export async function getDashboardKpis(): Promise<KpiItem[]> {
  const session = await requireSession("personal");
  const userId = session.user.id;
  const role = session.user.role;

  const mVis = matterReadVisibilityFilter(userId, role, session.user.rolePermissions);
  const iVis = intakeReadVisibilityFilter(userId, role, session.user.rolePermissions);
  const sVis = role === "CUSTOM" ? { AND: [mVis, customMatterFilter(userId, session.user.rolePermissions, "schedule.read", true)] } : mVis;

  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [inProgress, pending, deadlines, received] = await Promise.all([
    prisma.matter.count({
      where: { status: "IN_PROGRESS", deletedAt: null, ...mVis }
    }),
    prisma.intake.count({
      where: { status: "PENDING_CONFIRMATION", ...iVis }
    }),
    prisma.deadline.count({
      where: {
        dueAt: { gte: now, lte: in7d },
        completed: false,
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...sVis }
        }
      }
    }),
    prisma.feeEntry.aggregate({
      where: {
        type: "RECEIVED",
        confirmState: "CONFIRMED",
        occurredAt: { gte: monthStart },
        matter: { deletedAt: null, ...matterFinanceVisibilityFilter(userId, role, session.user.rolePermissions) }
      },
      _sum: { amount: true }
    })
  ]);

  const facts=await getFinanceFacts({deletedAt:null,...matterFinanceVisibilityFilter(userId,role,session.user.rolePermissions)});
  const receivedTotal = facts ? sumAmounts(periodReceipts(facts,shMonthStart(now))) : Number(received._sum.amount ?? 0);

  // Trend text is derived from raw counts
  // Sparkline is a flat representation of the single value (no historical series yet)
  const spark = (v: number) => Array(14).fill(v);

  return [
    {
      key: "in_progress",
      label: "办理中案件",
      value: inProgress,
      trend: { direction: "up", text: `${inProgress} 件` },
      sparkline: spark(inProgress)
    },
    {
      key: "pending",
      label: "待确认收案",
      value: pending,
      trend: { direction: "warn", text: `${pending} 待处理` },
      sparkline: spark(pending)
    },
    {
      key: "deadline",
      label: "近 7 天期限",
      value: deadlines,
      trend: { direction: "warn", text: `${deadlines} 项` },
      sparkline: spark(deadlines)
    },
    {
      key: "received",
      // ledger 模式下 periodReceipts 只统计律师费（moneyKind==='LAWYER_FEE'），
      // 标签随数据切换口径（与财务页 finance-view-v4 一致），避免把律师费实收标成「本月实收」
      label: facts ? "本月律师费实收" : "本月实收",
      value: receivedTotal,
      valueFormat: "currency",
      trend: { direction: "up", text: `¥${(receivedTotal / 10000).toFixed(1)}万` },
      sparkline: spark(Math.round(receivedTotal / 1000))
    }
  ];
}

// ============ Revenue Trend ============

export async function getDashboardRevenueTrend(months = 6) {
  const session = await requireSession("personal");
  const visFilter = matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const facts=await getFinanceFacts({deletedAt:null,...visFilter});
  if(facts)return financeTrend(facts,Math.max(1,Math.min(36,Math.floor(months))));
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const entries = await prisma.feeEntry.findMany({
    where: {
      type: { in: ["RECEIVABLE", "RECEIVED"] },
      confirmState: "CONFIRMED",
      occurredAt: { gte: start },
      matter: { deletedAt: null, ...visFilter }
    },
    select: { type: true, amount: true, occurredAt: true }
  });

  const buckets: { month: string; received: number; receivable: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({
      month: `${d.getMonth() + 1}月`,
      received: 0,
      receivable: 0
    });
  }

  for (const e of entries) {
    const d = new Date(e.occurredAt);
    const idx = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
    if (idx < 0 || idx >= months) continue;
    // 以元为单位返回，与财务页同一图表组件口径一致（坐标轴自行缩写为 K）
    const val = Number(e.amount);
    if (e.type === "RECEIVED") buckets[idx].received += val;
    if (e.type === "RECEIVABLE") buckets[idx].receivable += val;
  }

  for (const b of buckets) {
    b.received = Math.round(b.received);
    b.receivable = Math.round(b.receivable);
  }

  return buckets;
}

// ============ Category Distribution ============

export async function getDashboardCategoryDistribution() {
  const session = await requireSession("personal");
  const visFilter = matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);

  const groups = await prisma.matter.groupBy({
    by: ["category"],
    where: {
      status: "IN_PROGRESS",
      deletedAt: null,
      ...visFilter
    },
    _count: { category: true }
  });

  const result = groups.map((g) => {
    return {
      name: matterCategoryLabel[g.category],
      value: g._count.category,
      code: matterCategoryShort[g.category],
      color: matterCategoryColor[g.category]
    };
  });

  // Sort by value desc
  result.sort((a, b) => b.value - a.value);

  return result;
}

// ============ Schedule (past 2 days to next 15 days：开庭 + 期限) ============

export async function getDashboardSchedule(): Promise<ScheduleItem[]> {
  const session = await requireSession("personal");
  const visFilter = matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);

  if (session.user.role === "CUSTOM") visFilter.AND = [matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions), customMatterFilter(session.user.id, session.user.rolePermissions, "schedule.read", true)];

  const now = new Date();
  const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  const procWhere = { engagement: "ENGAGED" as const, matter: { deletedAt: null, ...visFilter } };
  const procSelect = {
    type: true,
    customLabel: true,
    matter: {
      select: {
        id: true,
        internalCode: true,
        title: true,
        primaryClient: { select: { name: true } },
        clientLinks: {
          select: {
            isPrimary: true,
            client: { select: { name: true } }
          },
          orderBy: [{ isPrimary: "desc" as const }, { addedAt: "asc" as const }]
        }
      }
    }
  };

  const excludedHearings=await closedHearingIds(prisma);
  const [hearings, deadlines] = await Promise.all([
    prisma.hearing.findMany({
      where: { id:{notIn:excludedHearings}, startsAt: { gte: from, lte: to }, procedure: procWhere },
      include: { procedure: { select: procSelect } },
      orderBy: { startsAt: "asc" },
      take: 12
    }),
    prisma.deadline.findMany({
      where: { dueAt: { gte: from, lte: to }, completed: false, procedure: procWhere },
      include: { procedure: { select: procSelect } },
      orderBy: { dueAt: "asc" },
      take: 12
    })
  ]);

  const itemsWithSort: { item: ScheduleItem; ts: number }[] = [];
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const DAY = 1000 * 60 * 60 * 24;
  // 按北京时间的日历日计算（服务器时区可能为 UTC）：负数=已逾期
  const shParts = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { y: Number(g("year")), m: Number(g("month")), day: Number(g("day")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), hm: `${g("hour")}:${g("minute")}` };
  };
  const today = shParts(now);
  const daysFrom = (d: Date) => {
    const t = shParts(d);
    return Math.round((Date.UTC(t.y, t.m - 1, t.day) - Date.UTC(today.y, today.m - 1, today.day)) / DAY);
  };
  const fmt = (d: Date) => {
    const t = shParts(d);
    return { date: `${t.m}月${t.day}日`, weekday: weekdays[t.wd] ?? "", time: t.hm };
  };
  const clientNameOf = (matter: {
    primaryClient: { name: string } | null;
    clientLinks: { isPrimary: boolean; client: { name: string } }[];
  }) =>
    matter.primaryClient?.name ??
    matter.clientLinks.find((link) => link.isPrimary)?.client.name ??
    matter.clientLinks[0]?.client.name ??
    null;

  for (const h of hearings) {
    const d = new Date(h.startsAt);
    const matter = h.procedure.matter;
    itemsWithSort.push({
      ts: d.getTime(),
      item: {
        id: `h-${h.id}`,
        ...fmt(d),
        type: "hearing",
        title: h.title,
        matter: matter.title,
        clientName: clientNameOf(matter),
        matterId: matter.id,
        matterCode: matter.internalCode,
        procedure: h.procedure.customLabel ?? procedureTypeLabel[h.procedure.type] ?? h.procedure.type,
        daysUntil: daysFrom(d)
      }
    });
  }

  for (const dl of deadlines) {
    const d = new Date(dl.dueAt);
    const matter = dl.procedure.matter;
    itemsWithSort.push({
      ts: d.getTime(),
      item: {
        id: `d-${dl.id}`,
        ...fmt(d),
        type: "deadline",
        title: dl.title,
        matter: matter.title,
        clientName: clientNameOf(matter),
        matterId: matter.id,
        matterCode: matter.internalCode,
        procedure: dl.procedure.customLabel ?? procedureTypeLabel[dl.procedure.type] ?? dl.procedure.type,
        daysUntil: daysFrom(d)
      }
    });
  }

  itemsWithSort.sort((a, b) => a.ts - b.ts);

  return itemsWithSort.map((i) => i.item).slice(0, 12);
}

// ============ Hero Data ============

export async function getDashboardHeroData(): Promise<HeroData> {
  const session = await requireSession("personal");
  const userId = session.user.id;
  const role = session.user.role;
  const visFilter = matterReadVisibilityFilter(userId, role, session.user.rolePermissions);

  if (session.user.role === "CUSTOM") visFilter.AND = [matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions), customMatterFilter(session.user.id, session.user.rolePermissions, "schedule.read", true)];

  const now = new Date();
  // 日界按上海日历日取（容器为 UTC 时本地取日会差一天），期限多存为上海午夜瞬间
  const todayStart = new Date(`${shDayKey(now)}T00:00:00+08:00`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in7d = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [todayDeadlines, weekHearings, nearTermDeadlines, urgentDeadline, overdueDeadlines, pendingSeals] = await Promise.all([
    // Today's deadlines
    prisma.deadline.count({
      where: {
        dueAt: { gte: todayStart, lt: todayEnd },
        completed: false,
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...visFilter }
        }
      }
    }),
    // This week's hearings
    prisma.hearing.count({
      where: {
        startsAt: { gte: todayStart, lt: weekEnd },
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...visFilter }
        }
      }
    }),
    // Near-term deadlines (7 days)
    prisma.deadline.count({
      where: {
        dueAt: { gte: now, lte: in7d },
        completed: false,
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...visFilter }
        }
      }
    }),
    // Most urgent deadline (nearest future uncompleted)
    prisma.deadline.findFirst({
      where: {
        dueAt: { gte: now },
        completed: false,
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...visFilter }
        }
      },
      orderBy: { dueAt: "asc" },
      include: {
        procedure: {
          select: {
            matter: { select: { id: true, internalCode: true, title: true } }
          }
        }
      }
    }),
    // v1.x 批次④：逾期未完成期限（行动入口）
    prisma.deadline.count({
      where: {
        dueAt: { lt: now },
        completed: false,
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...visFilter }
        }
      }
    }),
    // 待审批用章申请（行动入口的近似待处理口径，与「待我处理」列表一致）
    prisma.sealRequest.count({ where: { status: "PENDING" } })
  ]);

  let focus: HeroData["focus"] = null;
  if (urgentDeadline) {
    const dueDate = new Date(urgentDeadline.dueAt);
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const matter = urgentDeadline.procedure.matter;
    focus = {
      title: urgentDeadline.title,
      matter: matter.title,
      internalCode: matter.internalCode,
      daysLeft,
      href: matterHref(matter)
    };
  }

  return {
    todayDeadlineCount: todayDeadlines,
    weekHearingCount: weekHearings,
    nearTermCount: nearTermDeadlines,
    overdueDeadlineCount: overdueDeadlines,
    pendingSealCount: pendingSeals,
    focus
  };
}

// ============ 墨案 02：待我处理 / 逾期未回款 / 客户来源 ============

export type WorkQueue = {
  approvals: { id: string; action: string; title: string; requester: string; matter: string | null; waitDays: number; task: string | null }[];
  approvalTotal: number;
  tasks: { id: string; title: string; dueAt: Date | null; priority: number; matterTitle: string; matterCode: string; matterId: string; overdue: boolean }[];
  taskTotal: number;
};

/** 待我处理：审批复用统一审批工作台口径；任务为指派给本人且未完成、所在案件本人可读 */
export async function getDashboardWorkQueue(): Promise<WorkQueue> {
  const session = await requireSession("personal");
  const { listApprovalWorkspace } = await import("@/server/approval-permissions/inbox");
  const approvalsPromise = listApprovalWorkspace({ tab: "pending" }).catch(() => null);
  const visFilter = matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const taskWhere = { assigneeId: session.user.id, completed: false, matter: { deletedAt: null, ...visFilter } };
  const [ws, tasks, taskTotal] = await Promise.all([
    approvalsPromise,
    prisma.task.findMany({
      where: taskWhere,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 5,
      select: { id: true, title: true, dueAt: true, priority: true, matter: { select: { id: true, title: true, internalCode: true } } }
    }),
    prisma.task.count({ where: taskWhere })
  ]);
  const now = Date.now();
  return {
    approvals: (ws?.rows ?? []).slice(0, 5).map((r) => ({
      id: r.id,
      action: r.action,
      title: r.title,
      requester: r.requester,
      matter: r.matter,
      waitDays: Math.max(0, Math.floor((now - new Date(r.submittedAt).getTime()) / 86_400_000)),
      task: r.task
    })),
    approvalTotal: ws?.counts.pending ?? 0,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt,
      priority: t.priority,
      matterTitle: t.matter.title,
      matterCode: t.matter.internalCode,
      matterId: t.matter.id,
      overdue: Boolean(t.dueAt && t.dueAt.getTime() < now)
    })),
    taskTotal
  };
}

/** 逾期未回款：应收（Receivable）到期日已过且未核销部分；按财务可见范围。无财务权限返回 null */
export async function getDashboardOverdueReceivables(): Promise<{ amount: number; clientCount: number; oldestDays: number } | null> {
  const session = await requireSession("personal");
  const { hasCustomPermission } = await import("@/lib/roles/catalog");
  if (!hasCustomPermission(session.user, "finance.read")) return null;
  const facts=await getFinanceFacts({deletedAt:null,...matterFinanceVisibilityFilter(session.user.id,session.user.role,session.user.rolePermissions)});
  if(facts){const aging=agingFromFacts(facts);const ids=new Set(aging.items.filter(r=>(r.overdueDays??0)>0).map(r=>r.matter.id));return {amount:aging.overdueAmount,clientCount:new Set(facts.matters.filter(m=>ids.has(m.id)).map(m=>m.primaryClientId??"none")).size,oldestDays:aging.worst?.overdueDays??0};}
  const rows = await prisma.receivable.findMany({
    where: {
      status: "OPEN",
      dueDate: { lt: new Date() },
      matter: { deletedAt: null, ...matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) }
    },
    select: { amount: true, settledAmount: true, dueDate: true, matter: { select: { primaryClientId: true } } }
  });
  const open = rows.filter((r) => Number(r.amount) - Number(r.settledAmount) > 0);
  const amount = open.reduce((s, r) => s + Number(r.amount) - Number(r.settledAmount), 0);
  const clientCount = new Set(open.map((r) => r.matter.primaryClientId ?? "none")).size;
  const oldest = open.reduce<number>((m, r) => Math.max(m, r.dueDate ? Math.floor((Date.now() - r.dueDate.getTime()) / 86_400_000) : 0), 0);
  return { amount, clientCount, oldestDays: oldest };
}

/** 客户来源渠道分布（近 12 个月新建客户，按本人可见客户范围） */
export async function getDashboardClientSources(): Promise<{ source: string; count: number }[]> {
  const session = await requireSession("personal");
  const { hasCustomPermission } = await import("@/lib/roles/catalog");
  if (!hasCustomPermission(session.user, "clients.read")) return [];
  const { clientVisibilityFilter } = await import("@/lib/permissions");
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const rows = await prisma.client.findMany({
    where: { AND: [clientVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions)], deletedAt: null, createdAt: { gte: since } },
    select: { source: true }
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = r.source?.trim() || "未记录";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}
