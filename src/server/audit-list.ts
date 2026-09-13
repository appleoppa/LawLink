"use server";

/**
 * v0.22: AuditLog 查询（admin-only 审计回放）
 */
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";

export type AuditFilter = {
  userId?: string;
  action?: string;
  targetType?: string;
  startStr?: string; // yyyy-MM-dd
  endStr?: string;
  limit?: number;
  cursor?: string; // 上一页最后一条 id
};

export type AuditEntry = {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  user: { id: string; name: string } | null;
};

export type AuditListResult = {
  items: AuditEntry[];
  nextCursor: string | null;
};

async function requireAdmin() {
  return requireSystemAdmin();
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function listAuditLogs(filter: AuditFilter): Promise<AuditListResult> {
  await requireAdmin();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);

  const where: Record<string, unknown> = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.action) where.action = filter.action;
  if (filter.targetType) where.targetType = filter.targetType;

  const start = parseDate(filter.startStr);
  const end = parseDate(filter.endStr);
  if (start || end) {
    const range: Record<string, Date> = {};
    if (start) range.gte = start;
    if (end) {
      const exclusiveEnd = new Date(end);
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      range.lt = exclusiveEnd;
    }
    where.createdAt = range;
  }

  const items = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      detail: true,
      ip: true,
      user: { select: { id: true, name: true } }
    }
  });

  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  return {
    items: trimmed,
    nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null
  };
}

/**
 * 拉所有出现过的 action / targetType / user，用于前端筛选下拉。
 * 直接 distinct 查询，结果数有限（业务里 action 类型有限）。
 */
export async function getAuditFilterOptions(): Promise<{
  actions: string[];
  targetTypes: string[];
  users: { id: string; name: string }[];
}> {
  await requireAdmin();
  const [actionsRaw, targetsRaw, users] = await Promise.all([
    prisma.auditLog.findMany({
      select: { action: true },
      distinct: ["action"],
      take: 200
    }),
    prisma.auditLog.findMany({
      where: { targetType: { not: null } },
      select: { targetType: true },
      distinct: ["targetType"],
      take: 100
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    })
  ]);
  return {
    actions: actionsRaw.map((r) => r.action).sort(),
    targetTypes: targetsRaw.map((r) => r.targetType!).sort(),
    users
  };
}
