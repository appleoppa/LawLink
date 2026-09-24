/**
 * 外部调用台账统计（管理后台「AI 与元典」页展示）。
 * 近 30 天各服务调用量 / 失败率 / 平均耗时 + 最近 10 条失败记录。
 */
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";

export async function getExternalCallStats() {
  await requireSystemAdmin();
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [byServiceRaw, failures, totalCalls] = await Promise.all([
    prisma.externalCallLog.groupBy({
      by: ["service"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true }
    }),
    prisma.externalCallLog.count({
      where: { createdAt: { gte: since }, ok: false }
    }),
    prisma.externalCallLog.count({ where: { createdAt: { gte: since } } })
  ]);

  const failedByService = await prisma.externalCallLog.groupBy({
    by: ["service"],
    where: { createdAt: { gte: since }, ok: false },
    _count: { _all: true }
  });
  const failedMap = new Map(failedByService.map(f => [f.service, f._count._all]));

  const recentFailures = await prisma.externalCallLog.findMany({
    where: { ok: false },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, service: true, action: true, error: true, durationMs: true, createdAt: true
    }
  });

  return {
    since: since.toISOString(),
    totalCalls,
    totalFailures: failures,
    services: byServiceRaw.map(s => ({
      service: s.service,
      calls: s._count._all,
      failures: failedMap.get(s.service) ?? 0,
      avgDurationMs: Math.round(s._avg.durationMs ?? 0)
    })).sort((a, b) => b.calls - a.calls),
    recentFailures
  };
}

export type ExternalCallStats = Awaited<ReturnType<typeof getExternalCallStats>>;
