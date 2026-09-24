"use server";
import { getFinanceFacts } from "./facts";
import { agingFromFacts } from "./facts-aging";

/**
 * 墨案 08「应收账龄 / 逾期未回款」：基于应收（Receivable）未核销余额，按到期日分档。
 * 只读查询，按财务可见范围过滤；金额口径 = amount - settledAmount。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { matterFinanceVisibilityFilter } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

export type AgingRow = {
  id: string;
  title: string;
  outstanding: number;
  dueState?:string;
  dueDate: string | null;
  overdueDays: number | null;
  matter: { id: string; internalCode: string; title: string; clientName: string | null };
};

export async function getReceivablesAging() {
  const session = await requireSession("finance.read");
  const facts=await getFinanceFacts({deletedAt:null,...matterFinanceVisibilityFilter(session.user.id,session.user.role,session.user.rolePermissions)});
  if(facts)return agingFromFacts(facts);
  const rows = await prisma.receivable.findMany({
    where: {
      status: "OPEN",
      matter: { deletedAt: null, ...matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) }
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    take: 300,
    select: {
      id: true,
      title: true,
      amount: true,
      settledAmount: true,
      dueDate: true,
      matter: { select: { id: true, internalCode: true, title: true, primaryClient: { select: { name: true } } } }
    }
  });
  const now = Date.now();
  // 第六轮体检 P3-2：与全系统 Decimal 口径一致（此前 Number() 浮点相减累加，展示层有误差）。
  // 行级 outstanding 出口为 number（展示），差额与汇总先经 Decimal 再转。
  const items: AgingRow[] = rows
    .map((r) => {
      const outstanding = r.amount.minus(r.settledAmount);
      const overdueDays = r.dueDate ? Math.floor((now - r.dueDate.getTime()) / 86_400_000) : null;
      return {
        id: r.id,
        title: r.title,
        outstanding: outstanding.toNumber(),
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        overdueDays,
        matter: { id: r.matter.id, internalCode: r.matter.internalCode, title: r.matter.title, clientName: r.matter.primaryClient?.name ?? null }
      };
    })
    .filter((r) => r.outstanding > 0);

  const buckets = [
    { key: "notDue", label: "未到期", amount: new Prisma.Decimal(0), count: 0 },
    { key: "d30", label: "逾期 1–30 天", amount: new Prisma.Decimal(0), count: 0 },
    { key: "d60", label: "逾期 31–60 天", amount: new Prisma.Decimal(0), count: 0 },
    { key: "d90", label: "逾期 61–90 天", amount: new Prisma.Decimal(0), count: 0 },
    { key: "d90p", label: "逾期 90 天以上", amount: new Prisma.Decimal(0), count: 0 }
  ];
  for (const r of items) {
    const d = r.overdueDays;
    const b = d === null || d <= 0 ? buckets[0] : d <= 30 ? buckets[1] : d <= 60 ? buckets[2] : d <= 90 ? buckets[3] : buckets[4];
    b.amount = b.amount.plus(new Prisma.Decimal(r.outstanding));
    b.count += 1;
  }
  const overdue = items.filter((r) => (r.overdueDays ?? 0) > 0).sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
  const sumRows = (list: AgingRow[]) => list.reduce((s, r) => s.plus(new Prisma.Decimal(r.outstanding)), new Prisma.Decimal(0)).toNumber();
  return {
    items,
    buckets: buckets.map((b) => ({ ...b, amount: b.amount.toNumber() })),
    totalOutstanding: sumRows(items),
    overdueAmount: sumRows(overdue),
    worst: overdue[0] ?? null,
    matterCount: new Set(items.map((r) => r.matter.id)).size
  };
}
