"use server";
/**
 * 归档案卷借阅（F-6，docs/ARCHIVE-BORROW-PLAN-20260921.md）：申请 → 审批 →
 * 限时可读 → 归还/到期，全程审计。归档不可变：只开放在线只读访问。
 *
 * - 审批资格复用 ARCHIVE_APPROVE 规则（含自审批排除——申请人不能批自己的借阅）；
 * - 限时：批准即 accessUntil（默认 30 天），读取路径经 hasActiveBorrowGrant
 *   实时校验（assertCanReadMatter 的兜底分支），到期读取即失效；
 * - 到期提醒走 F-1 台账（ARCHIVE_BORROW / OFFSET -3、0），审批时登记未来时刻行，
 *   投递器复核借阅单仍有效后送达；归还/驳回即作废未投递行。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { canApproveContext } from "@/lib/approvals/service";
import { matterReadVisibilityFilter } from "@/lib/permissions";
import { registerReminderDelivery, voidPendingDeliveries } from "@/server/reminders/ledger";
import { shDayKey } from "@/lib/ui/sh-time";
import type { MatterCategory } from "@prisma/client";

const createSchema = z.object({
  archiveRecordId: z.string().cuid(),
  reason: z.string().min(5, "请填写借阅事由（至少 5 字）").max(500),
  scope: z.enum(["WHOLE_VOLUME", "LISTED"]).default("WHOLE_VOLUME"),
  documentIds: z.array(z.string()).max(50).optional()
});

const decideSchema = z.object({
  id: z.string().cuid(),
  revision: z.number().int().nonnegative(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  rejectReason: z.string().max(500).optional(),
  days: z.number().int().min(1).max(180).optional()
});

/** 有效借阅资格：已批准、未归还、未到期（读取路径实时调用） */
export async function hasActiveBorrowGrant(userId: string, archiveRecordId: string): Promise<boolean> {
  const row = await prisma.archiveBorrowRequest.findFirst({
    where: {
      archiveRecordId,
      applicantId: userId,
      status: "APPROVED",
      accessUntil: { gte: new Date() }
    },
    select: { id: true }
  });
  return Boolean(row);
}

/** 到期自动失效（读取入口顺带收敛，无需独立 cron） */
async function expireOverdue(): Promise<number> {
  const r = await prisma.archiveBorrowRequest.updateMany({
    where: { status: "APPROVED", accessUntil: { lt: new Date() } },
    data: { status: "EXPIRED" }
  });
  return r.count;
}

const borrowSelect = {
  id: true, status: true, reason: true, scope: true, revision: true,
  decidedAt: true, rejectReason: true, accessUntil: true, returnedAt: true, createdAt: true,
  applicant: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
  archiveRecord: {
    select: {
      id: true, archiveNo: true, archivedAt: true,
      matter: { select: { id: true, internalCode: true, title: true, category: true } }
    }
  }
} as const;

export type BorrowRow = {
  id: string; status: string; reason: string; scope: string; revision: number;
  decidedAt: Date | null; rejectReason: string | null; accessUntil: Date | null; returnedAt: Date | null; createdAt: Date;
  applicant: { id: string; name: string };
  approver: { id: string; name: string } | null;
  archiveRecord: { id: string; archiveNo: string; archivedAt: Date; matter: { id: string; internalCode: string; title: string; category: MatterCategory } };
};

/** 归档台账页数据：我的借阅 + 待我审批（含审批资格标记）与在途清单 */
export async function listArchiveBorrows(): Promise<{
  expiredNow: number;
  mine: BorrowRow[];
  pending: BorrowRow[];
  currentUserId: string;
}> {
  const session = await requireSession();
  const expiredNow = await expireOverdue();
  const [mine, pending] = await Promise.all([
    prisma.archiveBorrowRequest.findMany({
      where: { applicantId: session.user.id },
      orderBy: { createdAt: "desc" }, take: 50, select: borrowSelect
    }),
    prisma.archiveBorrowRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" }, take: 50, select: borrowSelect
    })
  ]);
  // 审批资格逐条判定（ARCHIVE_APPROVE 规则 + 自审批排除）
  const pendingWithFlag = await Promise.all(pending.map(async (row) => ({
    ...row,
    canDecide: row.applicant.id === session.user.id
      ? false
      : await canApproveContext(session.user.id, {
          action: "ARCHIVE_APPROVE",
          category: row.archiveRecord.matter.category,
          requesterId: row.applicant.id
        })
  })));
  return {
    expiredNow,
    mine: mine as unknown as BorrowRow[],
    pending: pendingWithFlag.filter((r) => r.canDecide) as unknown as BorrowRow[],
    currentUserId: session.user.id
  };
}

export async function createArchiveBorrow(input: z.input<typeof createSchema>) {
  const session = await requireSession("matters.read");
  const data = createSchema.parse(input);
  const record = await prisma.archiveRecord.findUnique({
    where: { id: data.archiveRecordId },
    select: {
      id: true, status: true,
      matter: { select: { id: true, deletedAt: true, internalCode: true, title: true, category: true } }
    }
  });
  if (!record || record.matter.deletedAt) throw new Error("归档记录不存在");
  if (record.status !== "APPROVED") throw new Error("仅正式归档（审批通过）的案卷可申请借阅");
  // 申请人须对该案具备常规可见性（借阅开放的是归档访问，不是全所案件正文）
  const visible = await prisma.matter.findFirst({
    where: { id: record.matter.id, ...matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) },
    select: { id: true }
  });
  if (!visible) throw new Error("仅对该案件具备可见性的成员可申请借阅");
  if (data.scope === "LISTED" && (!data.documentIds || data.documentIds.length === 0)) {
    throw new Error("指定材料范围时至少选择一份材料");
  }
  // 在途去重：同案同申请人已有待审或未到期借阅
  const active = await prisma.archiveBorrowRequest.findFirst({
    where: {
      archiveRecordId: record.id,
      applicantId: session.user.id,
      OR: [{ status: "PENDING" }, { status: "APPROVED", accessUntil: { gte: new Date() } }]
    },
    select: { id: true }
  });
  if (active) throw new Error("该案卷已有在途借阅（待审或未到期），请先等待处理或归还");

  const created = await prisma.archiveBorrowRequest.create({
    data: {
      archiveRecordId: record.id,
      applicantId: session.user.id,
      reason: data.reason,
      scope: data.scope,
      documentIds: data.documentIds ?? undefined
    }
  });
  await audit({
    userId: session.user.id,
    action: "ARCHIVE_BORROW_REQUEST",
    targetType: "ArchiveBorrowRequest",
    targetId: created.id,
    detail: { archiveRecordId: record.id, matterId: record.matter.id, scope: data.scope }
  });
  return { ok: true, id: created.id };
}

export async function decideArchiveBorrow(input: z.input<typeof decideSchema>) {
  const session = await requireSession();
  const data = decideSchema.parse(input);
  const row = await prisma.archiveBorrowRequest.findUnique({
    where: { id: data.id },
    select: {
      id: true, status: true, revision: true, applicantId: true,
      archiveRecord: { select: { id: true, archiveNo: true, matter: { select: { id: true, internalCode: true, title: true, category: true } } } }
    }
  });
  if (!row) throw new Error("借阅申请不存在");
  if (row.status !== "PENDING") throw new Error("该申请已被处理");
  // 审批资格：ARCHIVE_APPROVE 规则 + 自审批排除（canApproveContext 内含 mayApproveSelf）
  const qualified = await canApproveContext(session.user.id, {
    action: "ARCHIVE_APPROVE",
    category: row.archiveRecord.matter.category,
    requesterId: row.applicantId
  });
  if (!qualified) throw new Error("未获授归档（借阅）审批权限，或不能审批本人申请");
  if (data.decision === "REJECTED" && !data.rejectReason?.trim()) throw new Error("驳回请填写理由");

  const now = new Date();
  const days = data.days ?? 30;
  const updated = await prisma.archiveBorrowRequest.updateMany({
    where: { id: row.id, status: "PENDING", revision: data.revision },
    data: data.decision === "APPROVED"
      ? { status: "APPROVED", approverId: session.user.id, decidedAt: now, accessUntil: new Date(now.getTime() + days * 86_400_000), revision: data.revision + 1 }
      : { status: "REJECTED", approverId: session.user.id, decidedAt: now, rejectReason: data.rejectReason ?? null, revision: data.revision + 1 }
  });
  if (updated.count !== 1) throw new Error("申请已被其他人处理，请刷新后重试");

  await audit({
    userId: session.user.id,
    action: data.decision === "APPROVED" ? "ARCHIVE_BORROW_APPROVE" : "ARCHIVE_BORROW_REJECT",
    targetType: "ArchiveBorrowRequest",
    targetId: row.id,
    detail: { days: data.decision === "APPROVED" ? days : undefined, rejectReason: data.rejectReason }
  });
  await createNotification({
    userId: row.applicantId,
    type: "SYSTEM",
    priority: data.decision === "APPROVED" ? "HIGH" : "NORMAL",
    title: data.decision === "APPROVED" ? `借阅已批准：${row.archiveRecord.matter.title}` : `借阅被驳回：${row.archiveRecord.matter.title}`,
    content: data.decision === "APPROVED"
      ? `${row.archiveRecord.archiveNo} 可在线查阅至 ${shDayKey(new Date(now.getTime() + days * 86_400_000))}，阅毕请在归档台账标记归还。`
      : `驳回理由：${data.rejectReason}`,
    href: "/archive",
    refType: "ArchiveBorrow",
    refId: row.id
  });

  if (data.decision === "APPROVED") {
    // 到期提醒走台账：T-3 与到期日各登记一行（registeredAt＝应发动的一刻，
    // 未来时刻行由投递器 sweep 自然到期送达），归还时作废
    const until = new Date(now.getTime() + days * 86_400_000);
    for (const offset of [-3, 0]) {
      const due = new Date(until.getTime() + offset * 86_400_000);
      if (due.getTime() <= now.getTime()) continue; // 短期借阅跳过已过期档
      await registerReminderDelivery({
        objectType: "ARCHIVE_BORROW",
        objectId: row.id,
        kind: "OFFSET",
        offset,
        channel: "IN_APP",
        dayKey: shDayKey(due),
        userId: row.applicantId
      }, prisma, due); // 未来档位：registeredAt＝应发时刻，到点才由投递器送达
    }
  }
  return { ok: true };
}

export async function returnArchiveBorrow(id: string) {
  const session = await requireSession();
  const row = await prisma.archiveBorrowRequest.findUnique({
    where: { id },
    select: { id: true, status: true, applicantId: true, approverId: true, archiveRecord: { select: { archiveNo: true } } }
  });
  if (!row) throw new Error("借阅单不存在");
  if (row.status !== "APPROVED") throw new Error("仅已批准的借阅可标记归还");
  if (row.applicantId !== session.user.id && row.approverId !== session.user.id) {
    throw new Error("仅借阅人或审批人可标记归还");
  }
  await prisma.archiveBorrowRequest.update({
    where: { id },
    data: { status: "RETURNED", returnedAt: new Date() }
  });
  // 未投递的到期提醒随归还作废
  await voidPendingDeliveries("ARCHIVE_BORROW", [id], "CANCELLED", "BORROW_RETURNED");
  await audit({
    userId: session.user.id,
    action: "ARCHIVE_BORROW_RETURN",
    targetType: "ArchiveBorrowRequest",
    targetId: id,
    detail: { archiveNo: row.archiveRecord.archiveNo }
  });
  return { ok: true };
}

/** 借阅申请前的案卷检索（最小披露：仅归档号/案号/案名/归档日期，不含正文与材料） */
export async function searchArchiveForBorrow(q: string) {
  const session = await requireSession("matters.read");
  const term = q.trim();
  if (term.length < 2) return [];
  return prisma.archiveRecord.findMany({
    where: {
      status: "APPROVED",
      matter: { deletedAt: null },
      OR: [
        { archiveNo: { contains: term, mode: "insensitive" } },
        { matter: { internalCode: { contains: term, mode: "insensitive" } } },
        { matter: { title: { contains: term, mode: "insensitive" } } }
      ]
    },
    orderBy: { archivedAt: "desc" },
    take: 10,
    select: {
      id: true, archiveNo: true, archivedAt: true,
      matter: { select: { id: true, internalCode: true, title: true } }
    }
  });
}

/** 归档台账页数据（页面已放开为登录可进）：archive.read 持有者另见全量台账 */
export async function listArchivePageData() {
  await requireSession();
  const { hasCustomPermission } = await import("@/lib/roles/catalog");
  const session = await requireSession();
  const hasArchiveRead = hasCustomPermission(session.user, "archive.read");
  const borrows = await listArchiveBorrows();
  return { hasArchiveRead, currentUserId: session.user.id, borrows };
}
