/**
 * 提醒送达台账（F-1 阶段一，2026-09-21）：登记 / 作废 / 投递三组原语。
 *
 * 模型（docs/REMINDER-DELIVERY-LEDGER-PLAN-20260921.md）：发送点不再直接创建通知，
 * 改登记 PENDING 行；投递器 sweep（PENDING 且 registeredAt<=now）→ 复核对象当前
 * 状态（B3「发送前核实当前状态」原则，兜住作废-投递竞态）→ 发送 → 落终态。
 * 对象变更/消亡经 voidPendingPreservation 作废，杜绝投递已失效的提醒。
 *
 * 阶段一仅接入保全（PRESERVATION_PROPERTY）：OFFSET（档位，接收人登记时锁定，
 * 漂移即 SUPERSEDED 由下次扫描重登记）、EXPIRED（过期翻转，接收人投递时重解析）、
 * ESCALATION / RECIPIENT_MISSING（受众动态，userId 空串，投递时实时解析并按人去重）。
 */
import { prisma } from "@/lib/prisma";
import { Prisma, type ReminderDeliveryChannel, type ReminderDeliveryKind, type ReminderDeliveryObjectType } from "@prisma/client";
import { createNotification } from "@/server/notifications/create";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";
import { shDayKey } from "@/lib/ui/sh-time";
import { shDayStart, isReminderRecipientEnabled, type ReminderRecipient } from "@/server/reminders/schedule";
import { escalateOverduePreservationToTeamLeaders } from "@/server/reminders/escalation";

/** 复合唯一键（@@unique 六字段）的筛选输入；Prisma 生成名为下划线拼接 */
function dedupeWhere(key: DedupeKey) {
  return {
    objectType_objectId_kind_offset_channel_dayKey_userId: {
      objectType: key.objectType,
      objectId: key.objectId,
      kind: key.kind,
      offset: key.offset,
      channel: key.channel,
      dayKey: key.dayKey,
      userId: key.userId
    }
  };
}

type DedupeKey = {
  objectType: "PRESERVATION_PROPERTY";
  objectId: string;
  kind: "OFFSET" | "EXPIRED" | "ESCALATION" | "RECIPIENT_MISSING";
  offset: number;
  channel: "IN_APP";
  dayKey: string;
  userId: string;
};

/**
 * 登记一条应发提醒（PENDING）。当日同键已存在视为已登记（调用方计 suppressed）；
 * 若既有行为 FAILED 且尝试未超限则重新武装为 PENDING（当日重试）。
 * SENT/SKIPPED/SUPERSEDED/CANCELLED 不动——这就是去重本身。
 */
export async function registerReminderDelivery(key: DedupeKey): Promise<"REGISTERED" | "ALREADY"> {
  try {
    await prisma.reminderDelivery.create({
      data: {
        objectType: key.objectType,
        objectId: key.objectId,
        kind: key.kind,
        offset: key.offset,
        channel: key.channel,
        dayKey: key.dayKey,
        userId: key.userId,
        status: "PENDING",
        registeredAt: new Date()
      }
    });
    return "REGISTERED";
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    await prisma.reminderDelivery.updateMany({
      where: {
        ...dedupeWhere(key),
        status: "FAILED",
        attempts: { lt: MAX_ATTEMPTS }
      },
      data: { status: "PENDING" }
    });
    return "ALREADY";
  }
}

/** 作废保全对象的全部 PENDING 登记（阶段一作废矩阵的落库侧） */
export async function voidPendingPreservation(
  propertyIds: string[],
  status: "SUPERSEDED" | "CANCELLED",
  reason: string,
  tx: Pick<typeof prisma, "reminderDelivery"> = prisma
): Promise<number> {
  if (propertyIds.length === 0) return 0;
  const result = await tx.reminderDelivery.updateMany({
    where: { objectType: "PRESERVATION_PROPERTY", objectId: { in: propertyIds }, status: "PENDING" },
    data: { status, detail: { reason } }
  });
  return result.count;
}

const MAX_ATTEMPTS = 5;

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
 * 阶段一只处理保全；其他 objectType 留给后续阶段，避免误碰。
 */
export async function deliverPendingReminders(limit = 20): Promise<DeliverySweepResult> {
  const now = new Date();
  const rows = await prisma.reminderDelivery.findMany({
    where: { status: "PENDING", registeredAt: { lte: now }, objectType: "PRESERVATION_PROPERTY" },
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
      const outcome = await deliverPreservationRow(row, now);
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

async function finalize(row: SweepRow, status: "SENT" | "SUPERSEDED" | "CANCELLED", detail?: Record<string, unknown>) {
  const data: Prisma.ReminderDeliveryUpdateInput = {
    status,
    sentAt: status === "SENT" ? new Date() : null
  };
  if (detail) data.detail = detail as Prisma.InputJsonValue;
  await prisma.reminderDelivery.update({ where: { id: row.id }, data });
}
