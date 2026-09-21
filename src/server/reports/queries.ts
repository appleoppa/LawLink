import { getFinanceFacts, periodReceipts } from "@/server/finance/facts";
/**
 * v0.20: 律所报表数据聚合（纯 read-only，无 use server）
 *
 * 4 个口径（来自 PRD 后续规划）：
 *  - 案件量：本期新收 / 在办 / 已结案 / 已归档
 *  - 类别分布：按 MatterCategory
 *  - 律师产出：每个律师承办案件数 / 已结案数 / 收款金额
 *  - 客户应收：按客户聚合 应收 - 已收
 *
 * 时间范围：调用方传 [start, end]，按 Matter.createdAt 落入本期为「新收」。
 */
import type { ReportAccess } from "@/lib/roles/report-scope";
import { prisma } from "@/lib/prisma";
import type { MatterCategory } from "@prisma/client";
import { shParts } from "@/lib/ui/sh-time";

export type ReportPeriod = {
  label: string;
  start: Date;
  end: Date;
};

/** 上海月首（本地构造在 UTC 容器会把「本月」窗口起点偏到 1 日 08:00） */
function shMonthStart(y: number, m: number): Date {
  return new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+08:00`);
}

export function periodPresets(now = new Date()): Record<"month" | "quarter" | "year" | "lastYear", ReportPeriod> {
  // 2026-09-20 第五轮审计时区修复：报表窗口此前按服务器本地年月构造（UTC 容器
  // 每月 1 日 0-8 点的收款/立案落入上月、标签也显示上期），统一上海口径
  const { y, m } = shParts(now);
  const q = Math.floor((m - 1) / 3);
  return {
    month: {
      label: `${y} 年 ${m} 月`,
      start: shMonthStart(y, m),
      end: shMonthStart(y + (m === 12 ? 1 : 0), m === 12 ? 1 : m + 1)
    },
    quarter: {
      label: `${y} 年 Q${q + 1}`,
      start: shMonthStart(y, q * 3 + 1),
      end: shMonthStart(y + (q === 3 ? 1 : 0), q === 3 ? 1 : q * 3 + 4)
    },
    year: {
      label: `${y} 年度`,
      start: shMonthStart(y, 1),
      end: shMonthStart(y + 1, 1)
    },
    lastYear: {
      label: `${y - 1} 年度`,
      start: shMonthStart(y - 1, 1),
      end: shMonthStart(y, 1)
    }
  };
}

/**
 * 解析自定义时间范围（含 start，不含 end，半开区间）。
 * - start/end 必须 yyyy-MM-dd，否则抛错
 * - end > start
 * - 跨度 ≤ 5 年（防止误输入年份导致全库扫描）
 */
export function customPeriod(startStr: string, endStr: string): ReportPeriod {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startStr) || !re.test(endStr)) {
    throw new Error("日期格式不合法，需要 yyyy-MM-dd");
  }
  // 2026-09-20 第五轮审计时区修复：自定义区间按上海日界解释（用户选 2026-09-20
  // 即上海 09-20 00:00 起，不再随服务器时区整体偏移）；非法月日由 Date 解析为 NaN 拦截
  const start = new Date(`${startStr}T00:00:00+08:00`);
  // end 解释为"含当天"，转半开区间需 +1 天
  const end = new Date(`${endStr}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("日期格式不合法，需要 yyyy-MM-dd");
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("结束日期必须晚于起始日期");
  }
  const days = (end.getTime() - start.getTime()) / 86400_000;
  if (days > 5 * 366) {
    throw new Error("自定义跨度不能超过 5 年");
  }
  return {
    label: `${startStr} ~ ${endStr}`,
    start,
    end
  };
}

export type ReportKpis = {
  newIntake: number;
  inProgress: number;
  closed: number;
  archived: number;
  archiveRate: number; // 已归档 / 已结案；0 时返回 0
};

export type CategoryBreakdown = {
  category: MatterCategory;
  count: number;
};

export type LawyerOutput = {
  userId: string;
  name: string;
  ownedCount: number; // owner = userId 的案件数
  closedCount: number;
  receivedAmount: number; // 收款金额
};

export type ClientReceivable = {
  clientId: string;
  name: string;
  receivable: number;
  received: number;
  balance: number;
};

export type ClientSourceBreakdown = {
  source: string;
  count: number;
  intakeCount: number; // 该来源客户名下案件数（含关联）
};

export type ReportData = {
  financeReady: boolean;
  period: ReportPeriod;
  kpis: ReportKpis;
  byCategory: CategoryBreakdown[];
  byLawyer: LawyerOutput[];
  byClientReceivable: ClientReceivable[];
  byClientSource: ClientSourceBreakdown[];
};

export async function getReportData(period: ReportPeriod, access: ReportAccess = { matters: {}, finance: {} }): Promise<ReportData> {
  // KPI 1: 本期新收（createdAt 落入本期）
  const newIntake = await prisma.matter.count({
    where: {
      createdAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    }
  });

  // KPI 2: 在办（status = IN_PROGRESS，不论何时建的）
  const inProgress = await prisma.matter.count({
    where: { status: "IN_PROGRESS", deletedAt: null, AND: [access.matters] }
  });

  // KPI 3: 本期已结（closedAt 落入本期）
  const closed = await prisma.matter.count({
    where: {
      closedAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    }
  });

  // KPI 4: 本期已归档（archivedAt 落入本期）
  const archived = await prisma.matter.count({
    where: {
      archivedAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    }
  });

  const archiveRate = closed > 0 ? archived / closed : 0;

  // 类别分布（按本期新收的案件分类）
  const cats = await prisma.matter.groupBy({
    by: ["category"],
    where: {
      createdAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    },
    _count: { _all: true }
  });
  const byCategory: CategoryBreakdown[] = cats.map((c) => ({
    category: c.category,
    count: c._count._all
  }));

  // 律师产出（按 owner 聚合，本期新收 + 本期已结 + 本期收款）
  const lawyerOwnedRaw = await prisma.matter.groupBy({
    by: ["ownerId"],
    where: {
      createdAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    },
    _count: { _all: true }
  });
  const lawyerClosedRaw = await prisma.matter.groupBy({
    by: ["ownerId"],
    where: {
      closedAt: { gte: period.start, lt: period.end },
      deletedAt: null, AND: [access.matters]
    },
    _count: { _all: true }
  });

  // 律师本期收款：FeeEntry.type=RECEIVED + occurredAt 在本期 + matter.ownerId
  const facts=await getFinanceFacts({deletedAt:null,AND:[access.finance]});
  const feeReceivedRaw = facts ? periodReceipts(facts,period.start,period.end) : await prisma.feeEntry.findMany({
    where: {
      type: "RECEIVED",
      confirmState: "CONFIRMED",
      occurredAt: { gte: period.start, lt: period.end },
      matter: { deletedAt: null, AND: [access.finance] }
    },
    select: { amount: true, matter: { select: { ownerId: true } } }
  });
  const receivedByOwner = new Map<string, number>();
  for (const f of feeReceivedRaw) {
    const oid = f.matter?.ownerId;
    if (!oid) continue;
    receivedByOwner.set(oid, (receivedByOwner.get(oid) ?? 0) + Number(f.amount));
  }

  const userIds = new Set<string>();
  for (const r of lawyerOwnedRaw) userIds.add(r.ownerId);
  for (const r of lawyerClosedRaw) userIds.add(r.ownerId);
  for (const id of receivedByOwner.keys()) userIds.add(id);
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true }
  });
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const ownedByOwner = new Map(lawyerOwnedRaw.map((r) => [r.ownerId, r._count._all]));
  const closedByOwner = new Map(lawyerClosedRaw.map((r) => [r.ownerId, r._count._all]));

  const byLawyer: LawyerOutput[] = Array.from(userIds)
    .map((uid) => ({
      userId: uid,
      name: userNameById.get(uid) ?? uid,
      ownedCount: ownedByOwner.get(uid) ?? 0,
      closedCount: closedByOwner.get(uid) ?? 0,
      receivedAmount: receivedByOwner.get(uid) ?? 0
    }))
    .sort((a, b) => b.receivedAmount - a.receivedAmount || b.ownedCount - a.ownedCount);

  // 客户应收：FeeEntry RECEIVABLE / RECEIVED 按 matter.primaryClient 聚合
  const fees = await prisma.feeEntry.findMany({
    where: {
      type: { in: ["RECEIVABLE", "RECEIVED"] },
      confirmState: "CONFIRMED",
      occurredAt: { gte: period.start, lt: period.end },
      matter: { deletedAt: null, AND: [access.finance] }
    },
    select: {
      type: true,
      amount: true,
      matter: { select: { primaryClient: { select: { id: true, name: true } } } }
    }
  });
  const byClient = new Map<string, ClientReceivable>();
  for (const f of fees) {
    const c = f.matter?.primaryClient;
    if (!c) continue;
    if (!byClient.has(c.id)) {
      byClient.set(c.id, {
        clientId: c.id,
        name: c.name,
        receivable: 0,
        received: 0,
        balance: 0
      });
    }
    const row = byClient.get(c.id)!;
    if (f.type === "RECEIVABLE") row.receivable += Number(f.amount);
    if (f.type === "RECEIVED") row.received += Number(f.amount);
  }
  for (const row of byClient.values()) row.balance = row.receivable - row.received;
  if(facts) {
    byClient.clear();
    // 当前应收余额与本期新增应收不同；余额必须按有效核销计算。
    for(const r of facts.receivables.filter(r=>r.moneyKind==='LAWYER_FEE')) {
      const c=r.matter.primaryClient;if(!c)continue;
      const row=byClient.get(c.id)??{clientId:c.id,name:c.name,receivable:0,received:0,balance:0};
      row.receivable+=r.effectiveAmount.toNumber();row.received+=r.settledAmount.toNumber();row.balance+=r.outstanding.toNumber();byClient.set(c.id,row);
    }
  }
  const byClientReceivable = Array.from(byClient.values()).sort(
    (a, b) => b.balance - a.balance
  );

  // v1.x P0-1 第三步：客户来源渠道分布（存量口径）
  const clientSourceRaw = await prisma.client.groupBy({
    by: ["source"],
    where: { deletedAt: null },
    _count: { _all: true }
  });
  const clientMatterRaw = await prisma.matterClient.groupBy({ by: ["clientId"], _count: { _all: true } });
  const matterCountByClient = new Map(clientMatterRaw.map(r => [r.clientId, r._count._all]));
  const allClients = await prisma.client.findMany({ where: { deletedAt: null }, select: { id: true, source: true } });
  const intakeBySource = new Map<string, number>();
  for (const c of allClients) {
    const key = c.source?.trim() || "未记录";
    intakeBySource.set(key, (intakeBySource.get(key) ?? 0) + (matterCountByClient.get(c.id) ?? 0));
  }
  const byClientSource: ClientSourceBreakdown[] = clientSourceRaw
    .map(r => ({
      source: r.source?.trim() || "未记录",
      count: r._count._all,
      intakeCount: intakeBySource.get(r.source?.trim() || "未记录") ?? 0
    }))
    .sort((a, b) => b.count - a.count);

  return {
    financeReady:Boolean(facts),
    period,
    kpis: { newIntake, inProgress, closed, archived, archiveRate },
    byCategory,
    byLawyer,
    byClientReceivable,
    byClientSource
  };
}
