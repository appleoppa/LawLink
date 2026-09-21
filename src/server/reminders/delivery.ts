/**
 * 提醒送达台账投递器（F-1，docs/REMINDER-DELIVERY-LEDGER-PLAN-20260921.md）。
 *
 * sweep PENDING 行 → 复核对象当前状态（B3「发送前核实当前状态」原则，兜住
 * 作废-投递竞态）→ 发送 → 落终态。阶段一接入保全四种 kind；阶段二接入期限/
 * 开庭（OFFSET 档位 + DEADLINE 逾期升级）。对象变更/消亡经 voidPendingDeliveries
 * /retireScheduleReminders 作废，杜绝投递已失效的提醒。
 *
 * 阶段二起本模块依赖 schedule.ts 的 evaluateScheduleReminder（复核共用登记
 * 口径）；schedule 的保存路径经动态 import 回调本模块投递——勿引入静态环。
 */
import { prisma } from "@/lib/prisma";
import { Prisma, type ReminderDeliveryChannel, type ReminderDeliveryKind, type ReminderDeliveryObjectType } from "@prisma/client";
import { createNotification } from "@/server/notifications/create";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";
import { shDayKey } from "@/lib/ui/sh-time";
import { shDayStart, isReminderRecipientEnabled, evaluateScheduleReminder, type ReminderRecipient, type ScheduleKind } from "@/server/reminders/schedule";
import { escalateOverduePreservationToTeamLeaders, escalateOverdueDeadlineToTeamLeaders } from "@/server/reminders/escalation";
import { voidPendingDeliveries, MAX_ATTEMPTS } from "@/server/reminders/ledger";

// 既有调用方（扫描、保全 actions、测试）沿用 delivery 命名空间导入，转出台账原语
export { registerReminderDelivery, MAX_ATTEMPTS } from "@/server/reminders/ledger";

/** 作废保全对象的全部 PENDING 登记（阶段一作废矩阵的落库侧） */
export async function voidPendingPreservation(
  propertyIds: string[],
  status: "SUPERSEDED" | "CANCELLED",
  reason: string,
  tx: Pick<typeof prisma, "reminderDelivery"> = prisma
): Promise<number> {
  return voidPendingDeliveries("PRESERVATION_PROPERTY", propertyIds, status, reason, tx);
}

const preservationRecipientSelect = { id: true, active: true, role: true, roleDefinition: { select: { active: true } } } as const;

export type PreservationDeliveryNode = {
  owner: ReminderRecipient | null;
  matter: { id: string; title: string; internalCode: string; owner: ReminderRecipient | null } | null;
};

/** 有效保全负责人优先，回退有效案件主办；全部失效返回 null（与扫描同口径） */
export function pickPreservationRecipient(cs: PreservationDeliveryNode | null | undefined): ReminderRecipient | null {
  if (!cs) return null;
  if (isReminderRecipientEnabled(cs.owner)) return cs.owner;
  const matterOwner = cs.matter?.owner ?? null;
  if (isReminderRecipientEnabled(matterOwner)) return matterOwner;
  return null;
}

export const preservationDeliverySelect = {
  id: true,
  propertyType: true,
  propertyDetail: true,
  expiryDate: true,
  status: true,
  target: {
    select: {
      name: true,
      case: {
        select: {
          remindDays: true,
          owner: { select: preservationRecipientSelect },
          matter: {
            select: { id: true, title: true, internalCode: true, owner: { select: preservationRecipientSelect } }
          }
        }
      }
    }
  }
} as const;

export type DeliverySweepResult = { processed: number; sent: number; voided: number; skipped: number; failed: number };

/**
 * 投递器：sweep 到期 PENDING 行，逐行复核对象现值后发送并落终态。
 */
export async function deliverPendingReminders(limit = 20): Promise<DeliverySweepResult> {
  const now = new Date();
  const rows = await prisma.reminderDelivery.findMany({
    where: { status: "PENDING", registeredAt: { lte: now } },
    orderBy: [{ registeredAt: "asc" }],
    take: limit,
    select: {
      id: true, objectType: true, objectId: true, kind: true, offset: true,
      channel: true, dayKey: true, userId: true, attempts: true
    }
  });

  const result: DeliverySweepResult = { processed: 0, sent: 0, voided: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    result.processed++;
    try {
      let outcome: RowOutcome;
      if (row.objectType === "PRESERVATION_PROPERTY") {
        outcome = await deliverPreservationRow(row, now);
      } else if (row.objectType === "DEADLINE" || row.objectType === "HEARING") {
        outcome = await deliverScheduleRow(row, now);
      } else if (row.objectType === "ARCHIVE_BORROW") {
        outcome = await deliverArchiveBorrowRow(row, now);
      } else {
        // 未接入的对象类型（如 DIGEST 行不经投递器）——防御性跳过
        await finalize(row, "SKIPPED", { reason: "UNSUPPORTED" });
        outcome = "skipped";
      }
      result[outcome]++;
    } catch (err) {
      result.failed++;
      const attempts = row.attempts + 1;
      await prisma.reminderDelivery.update({
        where: { id: row.id },
        data: {
          status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          attempts,
          lastError: err instanceof Error ? err.message : String(err)
        }
      });
    }
  }
  return result;
}

type SweepRow = {
  id: string;
  objectType: ReminderDeliveryObjectType;
  objectId: string;
  kind: ReminderDeliveryKind;
  offset: number;
  channel: ReminderDeliveryChannel;
  dayKey: string;
  userId: string;
  attempts: number;
};

type RowOutcome = "sent" | "voided" | "skipped";

/** 期限/开庭行投递：evaluate 复核 → 漂移作废 → 确定性主键幂等创建通知 */
async function deliverScheduleRow(row: SweepRow, now: Date): Promise<RowOutcome> {
  const kind: ScheduleKind = row.objectType === "DEADLINE" ? "Deadline" : "Hearing";
  const ev = await evaluateScheduleReminder(kind, row.objectId, now);

  if (ev.outcome === "SKIP") {
    // 对象消亡（删除/办结/案件删除/责任关闭）→ CANCELLED；变更类（非档期/无接收人）→ SUPERSEDED，待重登记
    const gone = ev.reason === "GONE" || ev.reason === "MATTER_DELETED" || ev.reason === "COMPLETED" || ev.reason === "RESP_CLOSED";
    await finalize(row, gone ? "CANCELLED" : "SUPERSEDED", { reason: ev.reason });
    return "voided";
  }

  if (row.kind === "ESCALATION") {
    if (ev.offset < 1 || ev.offset !== row.offset) {
      await finalize(row, "SUPERSEDED", { reason: "TIER_DRIFT", offset: ev.offset });
      return "voided";
    }
    const outcomes = await escalateOverdueDeadlineToTeamLeaders({
      matterId: ev.matterId,
      matterTitle: ev.matterTitle,
      internalCode: ev.internalCode,
      ownerId: ev.userId,
      deadlineId: row.objectId,
      deadlineTitle: ev.itemTitle,
      offset: ev.offset,
      todayStart: shDayStart(now)
    });
    await finalize(row, "SENT", { outcomes });
    return "sent";
  }

  // OFFSET：档位或接收人漂移即作废（改期路径会作废重登记，这里兜竞态）
  if (ev.offset !== row.offset || ev.userId !== row.userId) {
    await finalize(row, "SUPERSEDED", { reason: ev.offset !== row.offset ? "TIER_DRIFT" : "RECIPIENT_DRIFT", offset: ev.offset });
    return "voided";
  }
  await prisma.notification.createMany({
    data: [{
      id: ev.notificationId, userId: ev.userId,
      type: ev.notificationType, priority: ev.priority,
      title: ev.title, content: ev.content, href: ev.href,
      refType: ev.refType, refId: row.objectId, createdAt: now
    }],
    skipDuplicates: true
  });
  await finalize(row, "SENT");
  return "sent";
}

/** 单行投递：复核 → 发送 → 落终态（终态由调用方 update） */
async function deliverPreservationRow(row: SweepRow, now: Date): Promise<RowOutcome> {
  const prop = await prisma.preservationProperty.findUnique({
    where: { id: row.objectId },
    select: preservationDeliverySelect
  });
  const todayStart = shDayStart(now);

  // 对象已删除：登记取消
  if (!prop) {
    await finalize(row, "CANCELLED", { reason: "OBJECT_GONE" });
    return "voided";
  }

  const cs = prop.target.case;
  const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
  const matterText = cs.matter ? `案件 ${cs.matter.internalCode}·${cs.matter.title}` : "未关联案件";

  if (row.kind === "OFFSET") {
    // 复核：状态仍生效、档位仍命中且与登记一致、接收人未漂移——任一不符即作废
    if (prop.status !== "ACTIVE" && prop.status !== "RENEWED") {
      await finalize(row, "CANCELLED", { reason: `STATUS_${prop.status}` });
      return "voided";
    }
    const daysUntil = Math.round((shDayStart(prop.expiryDate).getTime() - todayStart.getTime()) / 86_400_000);
    const isCritical = daysUntil === 0 || daysUntil === -1;
    if (daysUntil !== row.offset || (!isCritical && !cs.remindDays.includes(daysUntil))) {
      await finalize(row, "SUPERSEDED", { reason: "TIER_DRIFT", daysUntil });
      return "voided";
    }
    const recipient = pickPreservationRecipient(cs);
    if (!recipient || recipient.id !== row.userId) {
      // 接收人漂移/失效：作废，下次扫描按当前接收人重新登记
      await finalize(row, "SUPERSEDED", { reason: "RECIPIENT_DRIFT" });
      return "voided";
    }
    const refType = `PreservationExpiry:${daysUntil}`;
    const dup = await prisma.notification.findFirst({
      where: { refType, refId: prop.id, createdAt: { gte: todayStart } },
      select: { id: true }
    });
    if (!dup) {
      const whenText =
        daysUntil === 0 ? "今天到期"
          : daysUntil < 0 ? `已逾期 ${-daysUntil} 天，保全效力可能已消灭`
            : `还有 ${daysUntil} 天到期`;
      await createNotification({
        userId: recipient.id,
        type: "DEADLINE_REMINDER",
        priority: daysUntil <= 3 ? "URGENT" : daysUntil <= 15 ? "HIGH" : "NORMAL",
        title: `保全${whenText}：${prop.target.name} · ${propertyLabel}`,
        content: `${matterText}。逾期未办续封手续的，查封、扣押、冻结的效力消灭（查扣冻规定第二十七条）。`,
        href: cs.matter ? matterHref(cs.matter) : "/preservation",
        refType,
        refId: prop.id
      });
    }
    await finalize(row, "SENT");
    return "sent";
  }

  if (row.kind === "EXPIRED") {
    if (prop.status !== "EXPIRED") {
      // 已续封/解除/删除：翻转产生的提醒不再有效
      await finalize(row, prop.status === "ACTIVE" || prop.status === "RENEWED" ? "SUPERSEDED" : "CANCELLED", { reason: `STATUS_${prop.status}` });
      return "voided";
    }
    const daysOverdue = Math.max(1, Math.round((todayStart.getTime() - shDayStart(prop.expiryDate).getTime()) / 86_400_000));
    const recipient = pickPreservationRecipient(cs); // 接收人投递时重解析（翻转只登记一次，漂移不重登记）
    const refType = "PreservationExpired";
    const dup = await prisma.notification.findFirst({
      where: { refType, refId: prop.id, createdAt: { gte: todayStart } },
      select: { id: true }
    });
    if (recipient && !dup) {
      await createNotification({
        userId: recipient.id,
        type: "DEADLINE_REMINDER",
        priority: "URGENT",
        title: `保全已过期未续封：${prop.target.name} · ${propertyLabel}`,
        content:
          `到期日 ${shDayKey(prop.expiryDate)}，已过 ${daysOverdue} 天。` +
          `未办理续封手续的，查封、扣押、冻结的效力消灭（查扣冻规定第二十七条），` +
          `系统已将该条保全标记为「已到期」。若实际已办理续封，请在系统中更新记录。`,
        href: cs.matter ? matterHref(cs.matter) : "/preservation",
        refType,
        refId: prop.id
      });
      await finalize(row, "SENT");
      return "sent";
    }
    await finalize(row, "SENT", recipient ? undefined : { reason: "NO_RECIPIENT" });
    return recipient ? "sent" : "skipped";
  }

  if (row.kind === "ESCALATION") {
    if (prop.status !== "EXPIRED") {
      await finalize(row, prop.status === "ACTIVE" || prop.status === "RENEWED" ? "SUPERSEDED" : "CANCELLED", { reason: `STATUS_${prop.status}` });
      return "voided";
    }
    const rawOwnerId = cs.owner?.id ?? cs.matter?.owner?.id ?? null;
    const daysOverdue = Math.max(1, Math.round((todayStart.getTime() - shDayStart(prop.expiryDate).getTime()) / 86_400_000));
    if (rawOwnerId) {
      // 受众动态：投递时解析团队负责人，行状态代表当日该对象的升级动作
      await escalateOverduePreservationToTeamLeaders({
        ownerId: rawOwnerId,
        matterId: cs.matter?.id ?? null,
        internalCode: cs.matter?.internalCode ?? null,
        matterTitle: cs.matter?.title ?? null,
        propertyId: prop.id,
        propertyLabel,
        targetName: prop.target.name,
        daysOverdue,
        todayStart
      });
    }
    await finalize(row, "SENT");
    return "sent";
  }

  // RECIPIENT_MISSING：档位提醒无合格接收人——接收人若已恢复则无需升级
  if (prop.status !== "ACTIVE" && prop.status !== "RENEWED") {
    await finalize(row, "CANCELLED", { reason: `STATUS_${prop.status}` });
    return "voided";
  }
  if (pickPreservationRecipient(cs)) {
    await finalize(row, "SUPERSEDED", { reason: "RECIPIENT_RECOVERED" });
    return "voided";
  }
  const refType = "PreservationRecipientMissing";
  const dup = await prisma.notification.findFirst({
    where: { refType, refId: prop.id, createdAt: { gte: todayStart } },
    select: { id: true }
  });
  if (!dup) {
    const receivers = await prisma.user.findMany({
      where: {
        active: true,
        role: "CUSTOM",
        roleDefinition: { active: true, permissions: { some: { permissionKey: "matters.transfer", scope: "ALL" } } }
      },
      select: { id: true }
    });
    const targets = receivers.length > 0
      ? receivers
      : await prisma.user.findMany({ where: { active: true, systemRole: "SUPER_ADMIN" }, select: { id: true } });
    await audit({
      userId: null,
      action: "PRESERVATION_RECIPIENT_MISSING",
      targetType: "PreservationProperty",
      targetId: prop.id,
      detail: { matterId: cs.matter?.id ?? null, receivers: receivers.length, deliveredAt: now.toISOString() }
    });
    for (const t of targets) {
      await createNotification({
        userId: t.id,
        type: "DEADLINE_REMINDER",
        priority: "URGENT",
        title: `保全提醒无人接收：${prop.target.name} · ${propertyLabel}`,
        content:
          `该保全的续封提醒没有合格接收人（保全负责人与案件主办均停用或缺失），提醒不会送达任何律师。` +
          `${cs.matter ? `关联案件 ${cs.matter.internalCode}·${cs.matter.title}，` : "该保全未关联案件，"}请在管理后台安排责任交接。`,
        href: cs.matter ? matterHref(cs.matter) : "/preservation",
        refType,
        refId: prop.id
      });
    }
  }
  await finalize(row, "SENT");
  return "sent";
}

/** 借阅到期提醒（F-6）：复核借阅单仍 APPROVED 且未归还未过期后送达；否则作废 */
async function deliverArchiveBorrowRow(row: SweepRow, now: Date): Promise<RowOutcome> {
  const borrow = await prisma.archiveBorrowRequest.findUnique({
    where: { id: row.objectId },
    select: {
      id: true, status: true, accessUntil: true, applicantId: true,
      archiveRecord: { select: { archiveNo: true, matter: { select: { id: true, title: true, internalCode: true } } } }
    }
  });
  if (!borrow) {
    await finalize(row, "CANCELLED", { reason: "OBJECT_GONE" });
    return "voided";
  }
  // 已归还/驳回/过期：到期提醒随对象消亡取消
  if (borrow.status !== "APPROVED") {
    await finalize(row, "CANCELLED", { reason: `BORROW_${borrow.status}` });
    return "voided";
  }
  const until = borrow.accessUntil ? shDayKey(borrow.accessUntil) : null;
  if (!until || borrow.accessUntil!.getTime() < now.getTime()) {
    await finalize(row, "CANCELLED", { reason: "ALREADY_EXPIRED" });
    return "voided";
  }
  const refType = "ArchiveBorrowDue";
  const dup = await prisma.notification.findFirst({
    where: { refType, refId: borrow.id, createdAt: { gte: shDayStart(now) } },
    select: { id: true }
  });
  if (!dup) {
    const isDueDay = row.offset === 0;
    await createNotification({
      userId: borrow.applicantId,
      type: "SYSTEM",
      priority: "HIGH",
      title: isDueDay ? `借阅今日到期：${borrow.archiveRecord.matter.title}` : `借阅 3 天后到期：${borrow.archiveRecord.matter.title}`,
      content: `${borrow.archiveRecord.archiveNo}（${borrow.archiveRecord.matter.internalCode}）的借阅将于 ${until} 到期，到期后自动失去查阅资格。请阅毕后在归档台账标记归还；仍需使用请重新申请。`,
      href: "/archive",
      refType,
      refId: borrow.id
    });
  }
  await finalize(row, "SENT");
  return "sent";
}

async function finalize(row: SweepRow, status: "SENT" | "SUPERSEDED" | "CANCELLED" | "SKIPPED", detail?: Record<string, unknown>) {
  const data: Prisma.ReminderDeliveryUpdateInput = {
    status,
    sentAt: status === "SENT" ? new Date() : null
  };
  if (detail) data.detail = detail as Prisma.InputJsonValue;
  await prisma.reminderDelivery.update({ where: { id: row.id }, data });
}
