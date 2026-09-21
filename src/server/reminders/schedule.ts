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
import { escalateOverdueDeadlineToTeamLeaders } from "./escalation";

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

/** 重新读取当前状态；与扫描共用。主键去重使多进程重复检查只产生一条通知。 */
export async function refreshScheduleReminder(kind: ScheduleKind, id: string, now = new Date(), transaction?: Prisma.TransactionClient) {
  const deliver = async (tx: Prisma.TransactionClient) => {
    // 锁住当前事项，防止检查期间被改期/删除后还写入旧日期的提醒。
    if (kind === "Deadline") await tx.$queryRaw`SELECT id FROM "Deadline" WHERE id = ${id} FOR SHARE`;
    else await tx.$queryRaw`SELECT id FROM "Hearing" WHERE id = ${id} FOR SHARE`;
    const row = kind === "Deadline"
      ? await tx.deadline.findUnique({ where: { id }, include: { procedure: { select: procedureSelect } } })
      : await tx.hearing.findUnique({ where: { id }, include: { procedure: { select: procedureSelect } } });
    if (!row || row.procedure.matter.deletedAt || ("completed" in row && row.completed)) return null;
    const ownership=await responsibilityReady(tx)?await tx.$queryRaw<{assigneeId:string;state:string;acceptedAt:Date|null}[]>(Prisma.sql`SELECT "assigneeId",state::text,"acceptedAt" FROM "WorkResponsibility" WHERE ${Prisma.raw(kind==='Deadline'?'"deadlineId"':'"hearingId"')}=${id} FOR SHARE`):[];
    if(ownership.length&&ownership[0].state!=='OPEN')return null;
    const assigned=ownership.length?await tx.user.findUnique({where:{id:ownership[0].assigneeId},select:{id:true,active:true,role:true,roleDefinition:{select:{active:true}}}}):null;
    const date = "dueAt" in row ? row.dueAt : row.startsAt;
    const offset = reminderOffset(date, now);
    const offsets = "remindDays" in row ? deadlineReminderOffsets(row.remindDays) : [-3, -1, 0];
    if (!offsets.includes(offset)) return null;
    // 当天新增但已经过时的开庭仍须提示人工核对，不能静默消失。
    const lead = row.procedure.isExternalLead ? null : row.procedure.leadLawyer;
    const user = ownership.length ? (isReminderRecipientEnabled(assigned)?assigned:null) : isReminderRecipientEnabled(lead) ? lead : isReminderRecipientEnabled(row.procedure.matter.owner) ? row.procedure.matter.owner : null;
    if (!user) return null;
    if(ownership.length&&user.role==="CUSTOM"&&!await tx.user.count({where:{id:user.id,roleDefinition:{active:true,permissions:{some:{permissionKey:"matters.write"}}}}}))return null;
    const pending = "confirmStatus" in row && row.confirmStatus === "PENDING";
    const when = kind === "Hearing"
      ? `${offset === 0 ? "今天" : offset === -1 ? "明天" : `${-offset} 天后`} ${shTime(date)} 开庭${date < now ? "（时间已过，请核对）" : ""}`
      : offset > 0 ? `逾期 ${offset} 天` : offset === 0 ? "今天到期" : `还有 ${-offset} 天到期`;
    const title = `${ownership.length&&!ownership[0].acceptedAt?"待承接 · ":""}${pending ? "待核期限 · " : ""}${when}：${row.title}`;
    const place = "room" in row ? [row.room, row.judge ? `审判员 ${row.judge}` : null].filter(Boolean).join(" · ") : "";
    // 去重键不含 row.updatedAt：同一天内改标题/备注（未改期）不应生成新 id
    // 绕过当日去重重发提醒；改期则经 date 变化自然成为新提醒（2026-09-19 审计）。
    const key = JSON.stringify([kind, id, date.toISOString(), pending, user.id, shDayKey(now)]);
    const notificationId = `reminder_${createHash("sha256").update(key).digest("hex")}`;
    const refType = `DueReminder:${offset >= 0 ? "+" : ""}${offset}:${kind}`;
    const result = await tx.notification.createMany({
      data: [{
        id: notificationId, userId: user.id,
        type: kind === "Deadline" ? "DEADLINE_REMINDER" : "HEARING_REMINDER",
        priority: offset > 0 ? "URGENT" : offset >= -1 ? "HIGH" : "NORMAL",
        title,
        content: `案件 ${row.procedure.matter.internalCode}·${row.procedure.matter.title}${place ? ` · ${place}` : ""}${pending ? "；规则计算结果尚待人工确认，请核对起算事实。" : ""}`,
        href: matterHref(row.procedure.matter), refType, refId: id, createdAt: now
      }],
      skipDuplicates: true
    });
    return { sent: result.count === 1, title, offset, userId: user.id, matter: row.procedure.matter, deadlineTitle: row.title };
  };
  return transaction ? deliver(transaction) : prisma.$transaction(deliver);
}

/** 保存已成功时提醒失败不伪装成保存失败；保留故障审计，由补扫重试。 */
export async function refreshScheduleReminderAfterSave(kind: ScheduleKind, id: string) {
  try {
    await refreshScheduleReminder(kind, id);
  } catch {
    console.error("[reminder] 即时提醒失败，将由定时补扫重试", { kind, id });
    try {
      await audit({ userId: null, action: "SCHEDULE_REMINDER_REFRESH_FAILED", targetType: kind, targetId: id, detail: { retry: "periodic-scan" } });
    } catch {
      console.error("[reminder] 提醒故障审计写入失败", { kind, id });
    }
  }
}

/** 改期、办结或移除时保留旧通知但明确标为失效，不再占未读提醒。 */
export async function retireScheduleReminders(tx: Prisma.TransactionClient, kind: ScheduleKind, id: string, now = new Date()) {
  await tx.notification.updateMany({
    where: { refId: id, refType: { startsWith: "DueReminder:", endsWith: `:${kind}` } },
    data: { read: true, readAt: now, content: "此提醒对应事项已变更或结束，请以案件当前记录为准。" }
  });
}

/** 周期补扫复用同一送达服务；不读取客户端列表，日期固定为上海日历日。 */
export async function scanScheduleReminders(now = new Date(), currentDayOnly = false) {
  await scanAdditionalWorkReminders(prisma,now);
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
      if (outcome.sent) {
        if (kind === "Deadline") deadlineNotified++; else hearingNotified++;
      } else suppressed++;
      // 每日外发摘要仍包含已由即时提醒送达的事项；外发自身按当日队列键去重。
      digestLines.push(`· ${outcome.title}（${outcome.matter.internalCode}）`);
      // 即时提醒已送达也不跳过升级，失败后补扫仍可继续升级。
      if (kind === "Deadline" && outcome.offset > 0) {
        const outcomes = await escalateOverdueDeadlineToTeamLeaders({
          matterId: outcome.matter.id, matterTitle: outcome.matter.title, internalCode: outcome.matter.internalCode,
          ownerId: outcome.userId, deadlineId: row.id, deadlineTitle: outcome.deadlineTitle,
          offset: outcome.offset, todayStart: today
        });
        escalationSent += outcomes.filter((r) => r === "SENT").length;
      }
    }
  }
  return { deadlineScanned: deadlines.length, deadlineNotified, hearingScanned: hearings.length, hearingNotified, suppressed, escalationSent, digestLines, deadlineOffsets };
}
