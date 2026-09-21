/**
 * v0.27: 期限到期提醒扫描
 * v0.38: 增加开庭提醒（Hearing 表）
 * v1.x: Deadline.remindDays（逐条配置的提前提醒天数，默认 3）生效——
 *       每条期限的有效提前档 = 固定提前档 {-3, -1} ∪ {-remindDays}，
 *       到期当天与逾期 +1 始终提醒；默认值下行为与历史版本一致。
 *       最近一次扫描与 webhook 投递结果写入 SystemSetting 供提醒维护页展示。
 * 2026-09-20 第六轮体检 P1-2/P1-3：保全扫描提取为 scanPreservationReminders——
 *       ① 档位命中式触发对当日停机无补偿，接入调度器每 2 分钟补扫（09:00 前仅
 *       补当日关键档，档位/对象/当日去重幂等）；② 接收人校验与期限/开庭统一。
 * 2026-09-21 F-1 阶段一：保全侧改「登记 PENDING → 投递器复核后发送」——
 *       本文件只登记（registerReminderDelivery），实际通知由 delivery.ts 的
 *       deliverPendingReminders 在复核对象现值后创建。扫描计数语义相应变为
 *       「登记数」：实际送达/作废以台账为准（reminder_delivery 表）。
 *
 * 每天 09:00 跑一次（Asia/Shanghai），覆盖 Deadline / Hearing / 保全：
 * - Deadline：命中 dueAt 落在有效偏移档（见 src/lib/deadline-reminders.ts）的未完成项各发一条通知
 * - Hearing：命中 startsAt 落在 T-3 / T-1 / T（开庭过去不提醒，不含 T+1），文案带具体开庭时间
 * - 保全：档位/过期翻转/升级/无接收人四类登记台账，投递器送达
 * - 去重：统一服务按实体、日期、接收人及上海当日生成稳定通知主键
 *
 * 业务原因：v0.26 之前没有"扫到期发提醒"机制，导致律师设的答辩期、举证期等到点不响；
 * v0.38 用户要求：凡有具体开庭时间，开庭前主动提醒（提前3天/1天/当天早上）。
 */
import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/server/cron/queue";
import { saveWebhookLastResult } from "@/server/settings/webhook-last-result";
import { audit } from "@/server/audit";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";
import { scanScheduleReminders, shDayStart } from "@/server/reminders/schedule";
import { shDayKey } from "@/lib/ui/sh-time";
import {
  registerReminderDelivery,
  voidPendingPreservation,
  pickPreservationRecipient,
  preservationDeliverySelect
} from "@/server/reminders/delivery";

export type DueReminderScanResult = {
  deadlineScanned: number;
  deadlineNotified: number;
  hearingScanned: number;
  hearingNotified: number;
  /** v1.2: 保全档位提醒（F-1 起为登记数，送达见台账） */
  preservationScanned: number;
  preservationNotified: number;
  /** v1.2: 过期未续封、自动置为 EXPIRED 的条目数 */
  preservationExpired: number;
  suppressed: number;
  /** v1.x P1 收尾：逾期档升级给团队负责人的送达数（F-1 起为登记数） */
  escalationSent: number;
};

export async function scanDueReminders(): Promise<DueReminderScanResult> {
  const now = new Date();
  const schedule = await scanScheduleReminders(now);
  const { deadlineScanned, deadlineNotified, hearingScanned, hearingNotified, digestLines, deadlineOffsets } = schedule;
  let suppressed = schedule.suppressed;
  let escalationSent = schedule.escalationSent;

  const pres = await scanPreservationReminders({ now });
  suppressed += pres.suppressed;
  escalationSent += pres.escalationSent;
  digestLines.push(...pres.digestLines);
  const { preservationScanned, preservationNotified, preservationExpired } = pres;

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
    const localDate = shDayKey(now);
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
    // v1.x 收尾 + 第六轮体检 P1-4：邮件摘要无条件入队——未配置 SMTP 时由 worker
    // 以「跳过」完结并把配置缺口写入台账（提醒维护页展示），不再静默无声。
    // 当日幂等键与 webhook 摘要各自独立。
    await enqueueJob({
      type: "email-digest",
      dedupeKey: `email-digest:${localDate}`,
      payload: { date: localDate }
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
      hearingOffsets: [-3, -1, 0],
      webhookEnqueued: digestLines.length > 0,
      // F-1 起保全侧计数为「登记数」，实际送达/作废见 reminder_delivery 台账
      preservationCountsAreRegistrations: true
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

// ── v1.2 + 第六轮体检 P1-2/P1-3 + F-1 阶段一: 保全续封提醒 ────────────
//
// 不走 OFFSETS，也不在 Deadline 表里建镜像行，原因有二：
// 1. 提前量不同。OFFSETS 是 -3/-1/0/+1，对答辩、举证够用；续封要备材料、
//    跑法院、等裁定，提前 3 天通知等于没通知。各保全案件自带
//    remindDays（默认 30/15/7/3/1）。
// 2. 建镜像 Deadline 行要多一个关联字段和一套同步逻辑，expiryDate 一改
//    两处就可能不一致；直接扫源表没有这个问题。
//
// F-1 阶段一起本职责改为「登记」：命中档位/翻转/升级/无接收人 → 台账 PENDING 行
// （唯一键当日幂等，重扫/补扫/重跑不重复）；通知创建、对象现值复核、接收人漂移
// 作废全部在 delivery.ts 投递器侧。后果依据：《最高人民法院关于人民法院民事执行中
// 查封、扣押、冻结财产的规定》（2020 修正）第二十七条——期限届满未办理延期手续的，
// 查封、扣押、冻结的效力消灭。

export type PreservationReminderScan = {
  preservationScanned: number;
  /** 档位提醒登记数（送达由投递器落台账） */
  preservationNotified: number;
  preservationExpired: number;
  suppressed: number;
  /** 逾期升级登记数 */
  escalationSent: number;
  digestLines: string[];
};

/**
 * 保全提醒登记扫描。09:00 全量扫描与调度器每 2 分钟补扫共用：
 * - criticalOnly=true（09:00 前）：仅补当日关键档（到期当天 / 逾期首日）；
 * - 登记：OFFSET（档位，锁定接收人）/ RECIPIENT_MISSING（无接收人）/ EXPIRED（过期
 *   翻转）/ ESCALATION（团队负责人升级），当日同键重复登记计 suppressed；
 * - 作废：EXPIRED 翻转时取消该对象残余的 OFFSET PENDING 行（防投递已失效档位）。
 */
export async function scanPreservationReminders(
  options: { now?: Date; criticalOnly?: boolean } = {}
): Promise<PreservationReminderScan> {
  const now = options.now ?? new Date();
  const todayStart = shDayStart(now);
  const dayKey = shDayKey(now);
  let preservationScanned = 0;
  let preservationNotified = 0;
  let suppressed = 0;
  let escalationSent = 0;
  const digestLines: string[] = [];

  const activeProperties = await prisma.preservationProperty.findMany({
    where: { status: { in: ["ACTIVE", "RENEWED"] } },
    select: preservationDeliverySelect
  });

  for (const prop of activeProperties) {
    const cs = prop.target.case;
    const daysUntil = Math.round(
      (shDayStart(prop.expiryDate).getTime() - todayStart.getTime()) / 86_400_000
    );

    // 到期当天与逾期首日一律提醒（此时效力可能已消灭），此外按本案 remindDays
    const isCritical = daysUntil === 0 || daysUntil === -1;
    if (options.criticalOnly && !isCritical) continue;
    if (!isCritical && !cs.remindDays.includes(daysUntil)) continue;

    preservationScanned++;
    const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
    const recipient = pickPreservationRecipient(cs);

    if (!recipient) {
      // 无合格接收人：登记升级行（受众投递时解析），不再直接发通知
      const outcome = await registerReminderDelivery({
        objectType: "PRESERVATION_PROPERTY", objectId: prop.id, kind: "RECIPIENT_MISSING",
        offset: 0, channel: "IN_APP", dayKey, userId: ""
      });
      if (outcome === "ALREADY") suppressed++;
      continue;
    }

    const outcome = await registerReminderDelivery({
      objectType: "PRESERVATION_PROPERTY", objectId: prop.id, kind: "OFFSET",
      offset: daysUntil, channel: "IN_APP", dayKey, userId: recipient.id
    });
    if (outcome === "REGISTERED") {
      preservationNotified++;
      const whenText =
        daysUntil === 0 ? "今天到期"
          : daysUntil < 0 ? `已逾期 ${-daysUntil} 天，保全效力可能已消灭`
            : `还有 ${daysUntil} 天到期`;
      digestLines.push(
        `· 保全${whenText}：${prop.target.name}·${propertyLabel}（${cs.matter?.internalCode ?? "未关联案件"}）`
      );
    } else {
      suppressed++;
    }
  }

  // ── v1.2 + F-1: 过期未续封的保全自动置为 EXPIRED ────────────────────
  //
  // 依据查扣冻规定第二十七条，期限届满未办延期手续的，效力「消灭」——法律上自动
  // 发生的事实，库里仍写 ACTIVE 是错误数据。朝安全方向失败（详见 git 历史），
  // 但不静默翻转：翻转记审计、登记 EXPIRED/ESCALATION 台账行、取消残余 OFFSET 行。
  // 翻转后状态离开 ACTIVE/RENEWED，本块天然只对每条执行一次。
  const lapsed = await prisma.preservationProperty.findMany({
    where: {
      status: { in: ["ACTIVE", "RENEWED"] },
      expiryDate: { lt: todayStart }
    },
    select: preservationDeliverySelect
  });

  let preservationExpired = 0;

  for (const prop of lapsed) {
    const cs = prop.target.case;
    const daysOverdue = Math.max(1, Math.round(
      (todayStart.getTime() - shDayStart(prop.expiryDate).getTime()) / 86_400_000
    ));

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

    // 残余的档位登记随对象状态消亡而取消（防投递已失效档位提醒）
    await voidPendingPreservation([prop.id], "CANCELLED", "EXPIRED_FLIP");

    const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
    // 过期翻转与团队负责人升级各登记一行；受众（接收人/负责人）投递时实时解析
    const expiredOutcome = await registerReminderDelivery({
      objectType: "PRESERVATION_PROPERTY", objectId: prop.id, kind: "EXPIRED",
      offset: daysOverdue, channel: "IN_APP", dayKey, userId: ""
    });
    if (expiredOutcome === "REGISTERED") {
      digestLines.push(
        `· 保全已过期未续封：${prop.target.name}·${propertyLabel}（逾期 ${daysOverdue} 天）`
      );
    } else {
      suppressed++;
    }

    const rawOwnerId = cs.owner?.id ?? cs.matter?.owner?.id ?? null;
    if (rawOwnerId && daysOverdue >= 1) {
      const outcome = await registerReminderDelivery({
        objectType: "PRESERVATION_PROPERTY", objectId: prop.id, kind: "ESCALATION",
        offset: daysOverdue, channel: "IN_APP", dayKey, userId: ""
      });
      if (outcome === "REGISTERED") escalationSent++;
      else suppressed++;
    }
  }

  return {
    preservationScanned,
    preservationNotified,
    preservationExpired,
    suppressed,
    escalationSent,
    digestLines
  };
}

// 手动触发入口已移至 @/server/reminders/actions（顶层 "use server"，可被客户端组件 import）
