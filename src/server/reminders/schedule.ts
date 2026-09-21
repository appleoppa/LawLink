import { responsibilityReady } from "./responsibility";
import {scanAdditionalWorkReminders} from "./urgent";
// 内部服务，不是客户端可调用的 Server Action。
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deadlineReminderOffsets, deadlineScanOffsets } from "@/lib/deadline-reminders";
import { shDayKey, shTime } from "@/lib/ui/sh-time";
import { matterHref } from "@/lib/matters/route";
import { audit } from "@/server/audit";
import { registerReminderDelivery } from "./ledger";

export type ScheduleKind = "Deadline" | "Hearing";

/** 提醒接收人资格：账号有效，自定义角色还须角色定义仍启用。期限/开庭/保全共用（第六轮体检 P1-3 收敛口径）。 */
export type ReminderRecipient = { id: string; active: boolean; role: string; roleDefinition?: { active: boolean } | null };
export function isReminderRecipientEnabled(user: ReminderRecipient | null | undefined): boolean {
  return Boolean(user?.active && (user.role !== "CUSTOM" || user.roleDefinition?.active));
}

export function shDayStart(date: Date): Date {
  return new Date(`${shDayKey(date)}T00:00:00+08:00`);
}
export function reminderOffset(date: Date, now: Date): number {
  return Math.round((shDayStart(now).getTime() - shDayStart(date).getTime()) / 86_400_000);
}

const procedureSelect = {
  isExternalLead: true,
  leadLawyer: { select: { id: true, active: true, role: true, roleDefinition: { select: { active: true } } } },
  matter: { select: {
    id: true, internalCode: true, title: true, deletedAt: true, ownerId: true,
    owner: { select: { id: true, active: true, role: true, roleDefinition: { select: { active: true } } } }
  } }
} satisfies Prisma.MatterProcedureSelect;

/**
 * 单条期限/开庭的提醒评估（F-1 阶段二提取，登记与投递复核共用同一口径）：
 * 对象是否存在/办结、责任状态、当前档位是否命中、接收人解析、通知文案与
 * 确定性主键。注册路径传 tx（FOR SHARE 防改期竞态）；投递复核不传（只读）。
 */
export type ScheduleReminderEvaluation =
  | { outcome: "SKIP"; reason: "GONE" | "MATTER_DELETED" | "COMPLETED" | "NOT_DUE" | "RESP_CLOSED" | "NO_RECIPIENT" | "NO_PERMISSION" }
  | {
      outcome: "DUE";
      kind: ScheduleKind;
      id: string;
      offset: number;
      userId: string;
      title: string;
      content: string;
      href: string;
      /** 确定性通知主键：同日同事实重复创建被 skipDuplicates 幂等吸收 */
      notificationId: string;
      refType: string;
      notificationType: "DEADLINE_REMINDER" | "HEARING_REMINDER";
      priority: "URGENT" | "HIGH" | "NORMAL";
      matterId: string;
      internalCode: string;
      matterTitle: string;
      itemTitle: string;
    };

export async function evaluateScheduleReminder(
  kind: ScheduleKind,
  id: string,
  now: Date = new Date(),
  tx?: Prisma.TransactionClient
): Promise<ScheduleReminderEvaluation> {
  const db = tx ?? prisma;
  // 注册路径锁住当前事项，防止检查期间被改期/删除后还写入旧日期的提醒；
  // 投递复核路径只读不锁——状态不符即作废。
  if (tx) {
    if (kind === "Deadline") await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id = ${id} FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM "Hearing" WHERE id = ${id} FOR SHARE`;
  }
  const row = kind === "Deadline"
    ? await db.deadline.findUnique({ where: { id }, include: { procedure: { select: procedureSelect } } })
    : await db.hearing.findUnique({ where: { id }, include: { procedure: { select: procedureSelect } } });
  if (!row) return { outcome: "SKIP", reason: "GONE" };
  if (row.procedure.matter.deletedAt) return { outcome: "SKIP", reason: "MATTER_DELETED" };
  if ("completed" in row && row.completed) return { outcome: "SKIP", reason: "COMPLETED" };

  const ownership = await responsibilityReady(db)
    ? await db.$queryRaw<{assigneeId:string;state:string;acceptedAt:Date|null}[]>(Prisma.sql`SELECT "assigneeId",state::text,"acceptedAt" FROM "WorkResponsibility" WHERE ${Prisma.raw(kind==='Deadline'?'"deadlineId"':'"hearingId"')}=${id} FOR SHARE`)
    : [];
  if (ownership.length && ownership[0].state !== "OPEN") return { outcome: "SKIP", reason: "RESP_CLOSED" };
  const assigned = ownership.length ? await db.user.findUnique({ where: { id: ownership[0].assigneeId }, select: { id: true, active: true, role: true, roleDefinition: { select: { active: true } } } }) : null;

  const date = "dueAt" in row ? row.dueAt : row.startsAt;
  const offset = reminderOffset(date, now);
  const offsets = "remindDays" in row ? deadlineReminderOffsets(row.remindDays) : [-3, -1, 0];
  if (!offsets.includes(offset)) return { outcome: "SKIP", reason: "NOT_DUE" };

  const lead = row.procedure.isExternalLead ? null : row.procedure.leadLawyer;
  const user = ownership.length
    ? (isReminderRecipientEnabled(assigned) ? assigned : null)
    : isReminderRecipientEnabled(lead) ? lead
      : isReminderRecipientEnabled(row.procedure.matter.owner) ? row.procedure.matter.owner
        : null;
  if (!user) return { outcome: "SKIP", reason: "NO_RECIPIENT" };
  // 责任承接者若为无案件写权限的自定义角色，不向其投递期限提醒
  if (ownership.length && user.role === "CUSTOM" && !await db.user.count({ where: { id: user.id, roleDefinition: { active: true, permissions: { some: { permissionKey: "matters.write" } } } } })) {
    return { outcome: "SKIP", reason: "NO_PERMISSION" };
  }

  const pending = "confirmStatus" in row && row.confirmStatus === "PENDING";
  const when = kind === "Hearing"
    ? `${offset === 0 ? "今天" : offset === -1 ? "明天" : `${-offset} 天后`} ${shTime(date)} 开庭${date < now ? "（时间已过，请核对）" : ""}`
    : offset > 0 ? `逾期 ${offset} 天` : offset === 0 ? "今天到期" : `还有 ${-offset} 天到期`;
  const title = `${ownership.length && !ownership[0].acceptedAt ? "待承接 · " : ""}${pending ? "待核期限 · " : ""}${when}：${row.title}`;
  const place = "room" in row ? [row.room, row.judge ? `审判员 ${row.judge}` : null].filter(Boolean).join(" · ") : "";
  // 去重键不含 row.updatedAt：同一天内改标题/备注（未改期）不应生成新 id
  // 绕过当日去重重发提醒；改期则经 date 变化自然成为新提醒（2026-09-19 审计）。
  const key = JSON.stringify([kind, id, date.toISOString(), pending, user.id, shDayKey(now)]);
  const notificationId = `reminder_${createHash("sha256").update(key).digest("hex")}`;
  const refType = `DueReminder:${offset >= 0 ? "+" : ""}${offset}:${kind}`;
  return {
    outcome: "DUE",
    kind, id, offset, userId: user.id, title,
    content: `案件 ${row.procedure.matter.internalCode}·${row.procedure.matter.title}${place ? ` · ${place}` : ""}${pending ? "；规则计算结果尚待人工确认，请核对起算事实。" : ""}`,
    href: matterHref(row.procedure.matter),
    notificationId, refType,
    notificationType: kind === "Deadline" ? "DEADLINE_REMINDER" : "HEARING_REMINDER",
    priority: offset > 0 ? "URGENT" : offset >= -1 ? "HIGH" : "NORMAL",
    matterId: row.procedure.matter.id,
    internalCode: row.procedure.matter.internalCode,
    matterTitle: row.procedure.matter.title,
    itemTitle: row.title
  };
}

/**
 * 保存后/扫描时的登记入口（F-1 阶段二）：评估当前是否应提醒，应提醒则登记
 * PENDING 台账行（当日同键幂等），不再直接创建通知——实际投递由
 * deliverPendingReminders 复核后执行。返回 null＝不该提醒；registered=false
 * ＝当日已登记（调用方计 suppressed）。
 */
export async function refreshScheduleReminder(kind: ScheduleKind, id: string, now = new Date(), transaction?: Prisma.TransactionClient) {
  const register = async (tx: Prisma.TransactionClient) => {
    const ev = await evaluateScheduleReminder(kind, id, now, tx);
    if (ev.outcome !== "DUE") return null;
    const registered = await registerReminderDelivery({
      objectType: kind === "Deadline" ? "DEADLINE" : "HEARING",
      objectId: id,
      kind: "OFFSET",
      offset: ev.offset,
      channel: "IN_APP",
      dayKey: shDayKey(now),
      userId: ev.userId
    }, tx);
    return {
      registered: registered === "REGISTERED",
      offset: ev.offset,
      userId: ev.userId,
      title: ev.title,
      matter: { id: ev.matterId, internalCode: ev.internalCode, title: ev.matterTitle },
      deadlineTitle: ev.itemTitle
    };
  };
  return transaction ? register(transaction) : prisma.$transaction(register);
}

/** 保存已成功时提醒失败不伪装成保存失败；保留故障审计，由补扫重试。F-1 阶段二起登记后立即投递一小批，保持保存即时提醒体验。 */
export async function refreshScheduleReminderAfterSave(kind: ScheduleKind, id: string) {
  try {
    await refreshScheduleReminder(kind, id);
    // 动态 import 断开 schedule↔delivery 静态环（delivery 复核要用本模块的 evaluate）
    const { deliverPendingReminders } = await import("./delivery");
    await deliverPendingReminders(5);
  } catch {
    console.error("[reminder] 即时提醒登记/投递失败，将由定时补扫重试", { kind, id });
    try {
      await audit({ userId: null, action: "SCHEDULE_REMINDER_REFRESH_FAILED", targetType: kind, targetId: id, detail: { retry: "periodic-scan" } });
    } catch {
      console.error("[reminder] 提醒故障审计写入失败", { kind, id });
    }
  }
}

/**
 * 改期、办结或移除时保留旧通知但明确标为失效，不再占未读提醒；
 * F-1 阶段二起同步作废台账 PENDING 行——改期/交接为 SUPERSEDED（对象变更，
 * 保存路径随即按新事实重登记），办结/删除为 CANCELLED（对象消亡）。
 */
export async function retireScheduleReminders(
  tx: Prisma.TransactionClient,
  kind: ScheduleKind,
  id: string,
  now = new Date(),
  status: "SUPERSEDED" | "CANCELLED" = "SUPERSEDED"
) {
  await tx.notification.updateMany({
    where: { refId: id, refType: { startsWith: "DueReminder:", endsWith: `:${kind}` } },
    data: { read: true, readAt: now, content: "此提醒对应事项已变更或结束，请以案件当前记录为准。" }
  });
  await tx.reminderDelivery.updateMany({
    where: { objectType: kind === "Deadline" ? "DEADLINE" : "HEARING", objectId: id, status: "PENDING" },
    data: { status, detail: { reason: "RETIRED" } }
  });
}

/** 周期补扫复用同一登记服务；不读取客户端列表，日期固定为上海日历日。 */
export async function scanScheduleReminders(now = new Date(), currentDayOnly = false) {
  await scanAdditionalWorkReminders(prisma,now);
  const dayKey = shDayKey(now);
  const today = shDayStart(now);
  const configs = await prisma.deadline.findMany({ where: { completed: false }, distinct: ["remindDays"], select: { remindDays: true } });
  const deadlineOffsets = currentDayOnly ? [0, 1] : deadlineScanOffsets(configs.map((r) => r.remindDays));
  const ranges = (offsets: readonly number[]) => offsets.map((offset) => {
    const gte = new Date(today.getTime() - offset * 86_400_000);
    return { gte, lt: new Date(gte.getTime() + 86_400_000) };
  });
  const [deadlines, hearings] = await Promise.all([
    prisma.deadline.findMany({ where: { completed: false, OR: ranges(deadlineOffsets).map((dueAt) => ({ dueAt })) }, select: { id: true } }),
    prisma.hearing.findMany({ where: { OR: ranges(currentDayOnly ? [0] : [-3, -1, 0]).map((startsAt) => ({ startsAt })) }, select: { id: true } })
  ]);
  let deadlineNotified = 0, hearingNotified = 0, suppressed = 0, escalationSent = 0;
  const digestLines: string[] = [];
  for (const kind of ["Deadline", "Hearing"] as const) {
    for (const row of kind === "Deadline" ? deadlines : hearings) {
      const outcome = await refreshScheduleReminder(kind, row.id, now);
      if (!outcome) continue;
      if (outcome.registered) {
        if (kind === "Deadline") deadlineNotified++; else hearingNotified++;
      } else suppressed++;
      // 每日外发摘要仍包含已由即时提醒送达的事项；外发自身按当日队列键去重。
      digestLines.push(`· ${outcome.title}（${outcome.matter.internalCode}）`);
      // 即时提醒已送达也不跳过升级：逾期档每次扫描都登记升级行（当日去重），
      // 实际送达由投递器复核对象现值后执行。
      if (kind === "Deadline" && outcome.offset > 0) {
        const reg = await registerReminderDelivery({
          objectType: "DEADLINE", objectId: row.id, kind: "ESCALATION",
          offset: outcome.offset, channel: "IN_APP", dayKey, userId: ""
        });
        if (reg === "REGISTERED") escalationSent++;
      }
    }
  }
  return { deadlineScanned: deadlines.length, deadlineNotified, hearingScanned: hearings.length, hearingNotified, suppressed, escalationSent, digestLines, deadlineOffsets };
}
