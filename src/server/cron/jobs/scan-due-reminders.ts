/**
 * v0.27: 期限到期提醒扫描
 * v0.38: 增加开庭提醒（Hearing 表）
 * v1.x: Deadline.remindDays（逐条配置的提前提醒天数，默认 3）生效——
 *       每条期限的有效提前档 = 固定提前档 {-3, -1} ∪ {-remindDays}，
 *       到期当天与逾期 +1 始终提醒；默认值下行为与历史版本一致。
 *       最近一次扫描与 webhook 投递结果写入 SystemSetting 供提醒维护页展示。
 *
 * 每天 09:00 跑一次（Asia/Shanghai），覆盖 Deadline / Hearing：
 * - Deadline：命中 dueAt 落在有效偏移档（见 src/lib/deadline-reminders.ts）的未完成项各发一条通知
 * - Hearing：命中 startsAt 落在 T-3 / T-1 / T（开庭过去不提醒，不含 T+1），文案带具体开庭时间
 * - 接收人：Deadline/Hearing → procedure.matter.ownerId
 * - 去重：refType="DueReminder:Deadline:-3" 等 + refId 实体 ID + 当日已发不再发
 *
 * 业务原因：v0.26 之前没有"扫到期发提醒"机制，导致律师设的答辩期、举证期等到点不响；
 * v0.38 用户要求：凡有具体开庭时间，开庭前主动提醒（提前3天/1天/当天早上）。
 */
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { enqueueJob } from "@/server/cron/queue";
import { saveWebhookLastResult } from "@/server/settings/webhook-last-result";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";
import { escalateOverdueDeadlineToTeamLeaders } from "@/server/reminders/escalation";
import {
  deadlineReminderOffsets,
  deadlineScanOffsets
} from "@/lib/deadline-reminders";

/** 开庭提醒固定档：提前 3 / 1 天与当天（开庭已过不再提醒，不含 +1） */
const HEARING_OFFSETS = [-3, -1, 0] as const;

// 期限偏移档由 remindDays 并集动态得出（deadlineScanOffsets），不再固定，故宽化为 number
type Offset = number;

export type DueReminderScanResult = {
  deadlineScanned: number;
  deadlineNotified: number;
  hearingScanned: number;
  hearingNotified: number;
  /** v1.2: 保全续封提醒 */
  preservationScanned: number;
  preservationNotified: number;
  /** v1.2: 过期未续封、自动置为 EXPIRED 的条目数 */
  preservationExpired: number;
  suppressed: number;
  /** v1.x P1 收尾：逾期档升级给团队负责人的送达数（无资格跳过见 SKIP_ESCALATION 审计） */
  escalationSent: number;
};

function startOfLocalDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfLocalDay(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function offsetKey(offset: Offset) {
  return `DueReminder:${offset >= 0 ? "+" : ""}${offset}`;
}

function priorityFor(offset: Offset) {
  // 优先级只反映紧迫度：逾期 URGENT，当天/提前 1 天 HIGH，其余提前档 NORMAL。
  // remindDays 并集出的更早提前档（如 -7）沿用既有 -3 档的 NORMAL——
  // 比 -3 更早只会更不紧急，不另行升级。
  if (offset >= 1) return "URGENT";
  if (offset === 0) return "HIGH";
  if (offset === -1) return "HIGH";
  return "NORMAL";
}

function stateText(offset: Offset) {
  if (offset > 0) return `逾期 ${offset} 天`;
  if (offset === 0) return "今天到期";
  return `还有 ${-offset} 天到期`;
}

// 开庭专用：带"今天/明天/X天后"前缀 + 具体时分（开庭精确到时分，区别于只到天的期限）
function hearingWhenText(offset: Offset, startsAt: Date) {
  const hh = String(startsAt.getHours()).padStart(2, "0");
  const mm = String(startsAt.getMinutes()).padStart(2, "0");
  const day = offset === 0 ? "今天" : offset === -1 ? "明天" : `${-offset} 天后`;
  return `${day} ${hh}:${mm} 开庭`;
}

export async function scanDueReminders(): Promise<DueReminderScanResult> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);

  let deadlineScanned = 0;
  let deadlineNotified = 0;
  let hearingScanned = 0;
  let hearingNotified = 0;
  let preservationScanned = 0;
  let preservationNotified = 0;
  let preservationExpired = 0;
  let suppressed = 0;
  let escalationSent = 0;
  // v0.50: 汇总本次新提醒，扫描结束后一次性推 webhook（避免逐条刷群）
  const digestLines: string[] = [];

  // Deadline.remindDays 生效：取所有在办期限配置过的提前提醒天数，
  // 与固定提前档 {-3, -1} 求并集得到本次要扫描的偏移档（见 src/lib/deadline-reminders.ts）。
  // remindDays 全是默认值 3 时，结果就是历史固定档 [-3, -1, 0, +1]。
  const remindDaysRows = await prisma.deadline.findMany({
    where: { completed: false },
    distinct: ["remindDays"],
    select: { remindDays: true }
  });
  const deadlineOffsets = deadlineScanOffsets(remindDaysRows.map((r) => r.remindDays));

  for (const offset of deadlineOffsets) {
    const target = new Date(now);
    // offset 是通知相对到期日的位置，提前提醒应查询未来日期。
    target.setDate(target.getDate() - offset);
    const dayStart = startOfLocalDay(target);
    const dayEnd = endOfLocalDay(target);

    // Deadline 扫描（程序内法定期限：答辩期、举证期等）
    const deadlines = await prisma.deadline.findMany({
      where: {
        completed: false,
        dueAt: { gte: dayStart, lte: dayEnd }
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        remindDays: true,
        procedure: {
          select: {
            id: true,
            matter: {
              select: { id: true, title: true, internalCode: true, ownerId: true }
            }
          }
        }
      }
    });
    deadlineScanned += deadlines.length;

    const refTypeDL = `${offsetKey(offset)}:Deadline`;
    for (const d of deadlines) {
      const userId = d.procedure.matter.ownerId;
      if (!userId) continue;

      // 该期限自身的有效提醒档不含当前档（如 remindDays=3 的期限不提前 7 天提醒）：
      // 属于配置差异而非重复推送，静默跳过，不计入通知数或去重数。
      if (!deadlineReminderOffsets(d.remindDays).includes(offset)) continue;

      const dup = await prisma.notification.findFirst({
        where: { refType: refTypeDL, refId: d.id, createdAt: { gte: todayStart } },
        select: { id: true }
      });
      if (dup) {
        suppressed++;
        continue;
      }

      await createNotification({
        userId,
        type: "DEADLINE_REMINDER",
        priority: priorityFor(offset),
        title: `${stateText(offset)}：${d.title}`,
        content: `案件 ${d.procedure.matter.internalCode}·${d.procedure.matter.title}`,
        href: matterHref(d.procedure.matter),
        refType: refTypeDL,
        refId: d.id
      });
      deadlineNotified++;
      digestLines.push(
        `· ${stateText(offset)}：${d.title}（${d.procedure.matter.internalCode}）`
      );

      // v1.x P1 收尾：逾期档（offset >= 1）升级给主办所在有效团队负责人；
      // 无访问资格的负责人在 escalate 内记 SKIP_ESCALATION 审计后跳过。
      if (offset >= 1) {
        const outcomes = await escalateOverdueDeadlineToTeamLeaders({
          matterId: d.procedure.matter.id,
          matterTitle: d.procedure.matter.title,
          internalCode: d.procedure.matter.internalCode,
          ownerId: userId,
          deadlineId: d.id,
          deadlineTitle: d.title,
          offset,
          todayStart
        });
        escalationSent += outcomes.filter(o => o === "SENT").length;
      }
    }
  }

  // Hearing 扫描（开庭提醒）—— 开庭过去不再提醒，只有提前 3 / 1 天与当天三档，
  // 不跟随 Deadline.remindDays（开庭表无此配置）。
  for (const offset of HEARING_OFFSETS) {
    const target = new Date(now);
    target.setDate(target.getDate() - offset);
    const dayStart = startOfLocalDay(target);
    const dayEnd = endOfLocalDay(target);

    const hearings = await prisma.hearing.findMany({
      where: {
        startsAt: { gte: dayStart, lte: dayEnd }
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        room: true,
        judge: true,
        procedure: {
          select: {
            matter: {
              select: { id: true, title: true, internalCode: true, ownerId: true }
            }
          }
        }
      }
    });
    hearingScanned += hearings.length;

    const refTypeHearing = `${offsetKey(offset)}:Hearing`;
    for (const h of hearings) {
      const userId = h.procedure.matter.ownerId;
      if (!userId) continue;

      const dup = await prisma.notification.findFirst({
        where: { refType: refTypeHearing, refId: h.id, createdAt: { gte: todayStart } },
        select: { id: true }
      });
      if (dup) {
        suppressed++;
        continue;
      }

      const place = [h.room && `${h.room}`, h.judge && `审判员 ${h.judge}`]
        .filter(Boolean)
        .join(" · ");
      await createNotification({
        userId,
        type: "HEARING_REMINDER",
        priority: priorityFor(offset),
        title: `${hearingWhenText(offset, h.startsAt)}：${h.title}`,
        content: `案件 ${h.procedure.matter.internalCode}·${h.procedure.matter.title}${place ? ` · ${place}` : ""}`,
        href: matterHref(h.procedure.matter),
        refType: refTypeHearing,
        refId: h.id
      });
      hearingNotified++;
      digestLines.push(
        `· ${hearingWhenText(offset, h.startsAt)}：${h.title}（${h.procedure.matter.internalCode}）`
      );
    }
  }

  // ── v1.2: 保全续封提醒 ──────────────────────────────────────────────
  //
  // 不走上面的 OFFSETS，也不在 Deadline 表里建镜像行，原因有二：
  // 1. 提前量不同。OFFSETS 是 -3/-1/0/+1，对答辩、举证够用；续封要备材料、
  //    跑法院、等裁定，提前 3 天通知等于没通知。各保全案件自带
  //    remindDays（默认 30/15/7/3/1），此前只写不读，是死配置，这里让它生效。
  // 2. 建镜像 Deadline 行要多一个关联字段和一套同步逻辑，expiryDate 一改
  //    两处就可能不一致；直接扫源表没有这个问题。
  //
  // 后果的严重性决定了这条不能省：《最高人民法院关于人民法院民事执行中
  // 查封、扣押、冻结财产的规定》（2020 修正）第二十七条——期限届满未办理
  // 延期手续的，查封、扣押、冻结的效力消灭。
  const activeProperties = await prisma.preservationProperty.findMany({
    where: { status: { in: ["ACTIVE", "RENEWED"] } },
    select: {
      id: true,
      propertyType: true,
      propertyDetail: true,
      expiryDate: true,
      target: {
        select: {
          name: true,
          case: {
            select: {
              id: true,
              remindDays: true,
              ownerId: true,
              matter: {
                select: { id: true, title: true, internalCode: true, ownerId: true }
              }
            }
          }
        }
      }
    }
  });

  for (const prop of activeProperties) {
    const cs = prop.target.case;
    const daysUntil = Math.round(
      (startOfLocalDay(prop.expiryDate).getTime() - todayStart.getTime()) / 86_400_000
    );

    // 到期当天与逾期首日一律提醒（此时效力可能已消灭），此外按本案 remindDays
    const isCritical = daysUntil === 0 || daysUntil === -1;
    if (!isCritical && !cs.remindDays.includes(daysUntil)) continue;

    preservationScanned++;

    const userId = cs.ownerId ?? cs.matter?.ownerId;
    if (!userId) continue;

    const refType = `PreservationExpiry:${daysUntil}`;
    const dup = await prisma.notification.findFirst({
      where: { refType, refId: prop.id, createdAt: { gte: todayStart } },
      select: { id: true }
    });
    if (dup) {
      suppressed++;
      continue;
    }

    const whenText =
      daysUntil === 0
        ? "今天到期"
        : daysUntil < 0
          ? `已逾期 ${-daysUntil} 天，保全效力可能已消灭`
          : `还有 ${daysUntil} 天到期`;
    const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
    const matterText = cs.matter
      ? `案件 ${cs.matter.internalCode}·${cs.matter.title}`
      : "未关联案件";

    await createNotification({
      userId,
      type: "DEADLINE_REMINDER",
      priority: daysUntil <= 3 ? "URGENT" : daysUntil <= 15 ? "HIGH" : "NORMAL",
      title: `保全${whenText}：${prop.target.name} · ${propertyLabel}`,
      content: `${matterText}。逾期未办续封手续的，查封、扣押、冻结的效力消灭（查扣冻规定第二十七条）。`,
      href: cs.matter ? matterHref(cs.matter) : "/preservation",
      refType,
      refId: prop.id
    });
    preservationNotified++;
    digestLines.push(
      `· 保全${whenText}：${prop.target.name}·${propertyLabel}（${cs.matter?.internalCode ?? "未关联案件"}）`
    );
  }

  // ── v1.2: 过期未续封的保全自动置为 EXPIRED ───────────────────────────
  //
  // 依据查扣冻规定第二十七条，期限届满未办延期手续的，效力「消灭」——
  // 这是法律上自动发生的事实，不需要任何人做动作。因此库里仍写 ACTIVE
  // 不是「待处理状态」，而是错误数据，改正它不等于擅自变更业务数据。
  //
  // 两个方向的错误代价不对称，据此选择朝安全方向失败：
  //   显示生效中但实际已失效 → 律师不行动、财产被转移，不可逆；
  //   显示已过期但实际已续封 → 律师看到告警去核对并更新记录，可自我修正。
  //
  // 但不静默翻转：每条都发通知并单独记审计，翻转可见、可纠正。
  // 到期当日仍在期限内，故只处理 expiryDate 早于今天零点的条目。
  const lapsed = await prisma.preservationProperty.findMany({
    where: {
      status: { in: ["ACTIVE", "RENEWED"] },
      expiryDate: { lt: todayStart }
    },
    select: {
      id: true,
      propertyType: true,
      propertyDetail: true,
      expiryDate: true,
      target: {
        select: {
          name: true,
          case: {
            select: {
              ownerId: true,
              matter: { select: { id: true, title: true, internalCode: true, ownerId: true } }
            }
          }
        }
      }
    }
  });

  for (const prop of lapsed) {
    const cs = prop.target.case;
    const daysOverdue = Math.round(
      (todayStart.getTime() - startOfLocalDay(prop.expiryDate).getTime()) / 86_400_000
    );

    await prisma.preservationProperty.update({
      where: { id: prop.id },
      data: { status: "EXPIRED" }
    });
    preservationExpired++;

    await audit({
      userId: null,
      action: "PRESERVATION_STATUS_AUTO_EXPIRED",
      targetType: "PreservationProperty",
      targetId: prop.id,
      detail: {
        expiryDate: prop.expiryDate.toISOString(),
        daysOverdue,
        matterId: cs.matter?.id ?? null
      }
    });

    const userId = cs.ownerId ?? cs.matter?.ownerId;
    if (!userId) continue;

    const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
    await createNotification({
      userId,
      type: "DEADLINE_REMINDER",
      priority: "URGENT",
      title: `保全已过期未续封：${prop.target.name} · ${propertyLabel}`,
      content:
        `到期日 ${prop.expiryDate.toLocaleDateString("zh-CN")}，已过 ${daysOverdue} 天。` +
        `未办理续封手续的，查封、扣押、冻结的效力消灭（查扣冻规定第二十七条），` +
        `系统已将该条保全标记为「已到期」。若实际已办理续封，请在系统中更新记录。`,
      href: cs.matter ? matterHref(cs.matter) : "/preservation",
      refType: "PreservationExpired",
      refId: prop.id
    });
    digestLines.push(
      `· 保全已过期未续封：${prop.target.name}·${propertyLabel}（逾期 ${daysOverdue} 天）`
    );
  }

  // v1.x P1-1: 摘要投递迁入持久队列——扫描只入队（当日幂等键，重扫覆盖
  // 未投递内容），实际外发与结果落库由 worker 执行：宕机可接续、失败按
  // 指数退避重试、超上限进死信可见。无新提醒时直接记"跳过"不入队。
  if (digestLines.length > 0) {
    const MAX_LINES = 20;
    const shown = digestLines.slice(0, MAX_LINES);
    const more = digestLines.length - shown.length;
    const text = [
      `LawLink 今日提醒（${digestLines.length} 条）`,
      ...shown,
      ...(more > 0 ? [`… 另有 ${more} 条，详见系统通知`] : [])
    ].join("\n");
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await enqueueJob({
      type: "webhook-digest",
      dedupeKey: `webhook-digest:${localDate}`,
      payload: {
        text,
        stats: {
          reminderCount: digestLines.length,
          deadlineScanned,
          deadlineNotified,
          hearingScanned,
          hearingNotified,
          preservationScanned,
          preservationNotified,
          preservationExpired,
          suppressed,
          escalationSent,
          deadlineOffsets
        }
      }
    });
    await saveWebhookLastResult({
      at: now.toISOString(),
      ok: false,
      skipped: false,
      queued: true,
      reminderCount: digestLines.length,
      deadlineScanned,
      deadlineNotified,
      hearingScanned,
      hearingNotified,
      preservationScanned,
      preservationNotified,
      preservationExpired,
      suppressed,
      escalationSent,
      deadlineOffsets
    });
  } else {
    // 最近一次扫描与推送结果写入 SystemSetting，供「提醒维护」页直接展示，
    // 不必翻审计日志（写入失败会随作业失败审计暴露，不静默吞掉）。
    await saveWebhookLastResult({
      at: now.toISOString(),
      ok: false,
      skipped: true,
      skipReason: "本次扫描无新提醒，未推送",
      reminderCount: 0,
      deadlineScanned,
      deadlineNotified,
      hearingScanned,
      hearingNotified,
      preservationScanned,
      preservationNotified,
      preservationExpired,
      suppressed,
      escalationSent,
      deadlineOffsets
    });
  }

  await audit({
    userId: null,
    action: "DUE_REMINDER_SCAN_CRON",
    targetType: "Report",
    targetId: "due-reminder",
    detail: {
      deadlineScanned,
      deadlineNotified,
      hearingScanned,
      hearingNotified,
      preservationScanned,
      preservationNotified,
      preservationExpired,
      suppressed,
      escalationSent,
      deadlineOffsets,
      hearingOffsets: HEARING_OFFSETS,
      webhookEnqueued: digestLines.length > 0
    }
  });

  return {
    deadlineScanned,
    deadlineNotified,
    hearingScanned,
    hearingNotified,
    preservationScanned,
    preservationNotified,
    preservationExpired,
    suppressed,
    escalationSent
  };
}

// 手动触发入口已移至 @/server/reminders/actions（顶层 "use server"，可被客户端组件 import）
