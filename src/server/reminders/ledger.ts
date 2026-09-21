/**
 * 提醒送达台账原语（F-1，docs/REMINDER-DELIVERY-LEDGER-PLAN-20260921.md）。
 *
 * 登记 / 作废 / 结果落账三类原语的唯一下沉处——登记方（schedule.ts、
 * scan-due-reminders.ts）与投递方（delivery.ts）都依赖本模块，故不得反向
 * import 任何上层模块（避免环）。语义见各函数头注。
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ReminderDeliveryChannel, ReminderDeliveryKind, ReminderDeliveryObjectType } from "@prisma/client";

export const MAX_ATTEMPTS = 5;

export type DedupeKey = {
  objectType: ReminderDeliveryObjectType;
  objectId: string;
  kind: ReminderDeliveryKind;
  offset: number;
  channel: ReminderDeliveryChannel;
  dayKey: string;
  userId: string;
};

/** 同键的扁平字段过滤——updateMany 只接受字段级 where，复合唯一键过滤会运行时报错 */
function dedupeFields(key: DedupeKey) {
  return {
    objectType: key.objectType,
    objectId: key.objectId,
    kind: key.kind,
    offset: key.offset,
    channel: key.channel,
    dayKey: key.dayKey,
    userId: key.userId
  };
}

/**
 * 登记一条应发提醒（PENDING）。当日同键已存在时：
 * - FAILED 未超尝试限 / SUPERSEDED / CANCELLED（被作废但对象当前又应提醒——
 *   如办结后同日重开、改期后同档复归）→ 重新武装为 PENDING，返回 REGISTERED；
 * - 其余（PENDING/SENT/SKIPPED/超限 FAILED）→ ALREADY（这就是当日去重本身）。
 * 重新武装只在评估判定「当前应提醒」时可达，不会复活已消亡对象的提醒。
 */
export async function registerReminderDelivery(key: DedupeKey, tx: Pick<typeof prisma, "reminderDelivery"> = prisma): Promise<"REGISTERED" | "ALREADY"> {
  const db = tx;
  // 实现注记：必须用 createMany + skipDuplicates（ON CONFLICT DO NOTHING）而非
  // create-捕获 P2002——Postgres 事务内唯一冲突会毒化整个事务（25P02），catch
  // 里的后续语句全部失败；交互式事务/回滚脚本场景下后者必炸（2026-09-21 真库
  // 验证发现，单测 mock 掩盖了它）。
  const created = await db.reminderDelivery.createMany({
    data: [{
      objectType: key.objectType,
      objectId: key.objectId,
      kind: key.kind,
      offset: key.offset,
      channel: key.channel,
      dayKey: key.dayKey,
      userId: key.userId,
      status: "PENDING",
      registeredAt: new Date()
    }],
    skipDuplicates: true
  });
  if (created.count === 1) return "REGISTERED";
  // 同键已存在：作废行复活（清作废原因、刷新登记时刻）→ 失败行重武装
  const revived = await db.reminderDelivery.updateMany({
    where: { ...dedupeFields(key), status: { in: ["SUPERSEDED", "CANCELLED"] } },
    data: { status: "PENDING", registeredAt: new Date(), detail: Prisma.DbNull }
  });
  if (revived.count > 0) return "REGISTERED";
  await db.reminderDelivery.updateMany({
    where: { ...dedupeFields(key), status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "PENDING" }
  });
  return "ALREADY";
}

/** 作废某类对象的全部 PENDING 登记（作废矩阵的落库侧） */
export async function voidPendingDeliveries(
  objectType: ReminderDeliveryObjectType,
  objectIds: string[],
  status: "SUPERSEDED" | "CANCELLED",
  reason: string,
  tx: Pick<typeof prisma, "reminderDelivery"> = prisma
): Promise<number> {
  if (objectIds.length === 0) return 0;
  const result = await tx.reminderDelivery.updateMany({
    where: { objectType, objectId: { in: objectIds }, status: "PENDING" },
    data: { status, detail: { reason } }
  });
  return result.count;
}

/**
 * 结果落账（Digest 通道行等「动作已完成、只记录事实」的场景）：
 * 同键当日已存在则更新状态——重跑/重试后反映最新结果。
 */
export async function recordDeliveryOutcome(
  key: DedupeKey,
  status: "SENT" | "FAILED" | "SKIPPED",
  extra?: { error?: string; detail?: Record<string, unknown> }
): Promise<void> {
  const data: Record<string, unknown> = {
    status,
    sentAt: status === "SENT" ? new Date() : null,
    ...(extra?.error !== undefined ? { lastError: extra.error } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {})
  };
  // 与 register 同理：createMany + skipDuplicates 避免唯一冲突毒化事务；
  // 同键已存在（当日重跑/重试）→ 更新为最新结果
  const created = await prisma.reminderDelivery.createMany({
    data: [{
      objectType: key.objectType,
      objectId: key.objectId,
      kind: key.kind,
      offset: key.offset,
      channel: key.channel,
      dayKey: key.dayKey,
      userId: key.userId,
      registeredAt: new Date(),
      ...data
    }] satisfies Prisma.ReminderDeliveryCreateManyInput[],
    skipDuplicates: true
  });
  if (created.count === 0) {
    await prisma.reminderDelivery.updateMany({ where: dedupeFields(key), data });
  }
}

