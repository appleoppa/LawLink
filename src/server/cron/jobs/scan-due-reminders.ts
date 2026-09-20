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
 * - 接收人：优先有效程序主办，回退有效案件主办
 * - 去重：统一服务按实体、日期、接收人及上海当日生成稳定通知主键
 *
 * 业务原因：v0.26 之前没有"扫到期发提醒"机制，导致律师设的答辩期、举证期等到点不响；
 * v0.38 用户要求：凡有具体开庭时间，开庭前主动提醒（提前3天/1天/当天早上）。
 */
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { enqueueJob } from "@/server/cron/queue";
import { isEmailConfigured } from "@/lib/notifications/email";
import { saveWebhookLastResult } from "@/server/settings/webhook-last-result";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";
import { scanScheduleReminders, shDayStart } from "@/server/reminders/schedule";
import { shDayKey } from "@/lib/ui/sh-time";

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

export async function scanDueReminders(): Promise<DueReminderScanResult> {
  const now = new Date();
  const todayStart = shDayStart(now);
  const schedule = await scanScheduleReminders(now);
  const { deadlineScanned, deadlineNotified, hearingScanned, hearingNotified, escalationSent, digestLines, deadlineOffsets } = schedule;
  let suppressed = schedule.suppressed;
  let preservationScanned = 0;
  let preservationNotified = 0;
  let preservationExpired = 0;

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
      (shDayStart(prop.expiryDate).getTime() - todayStart.getTime()) / 86_400_000
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
      (todayStart.getTime() - shDayStart(prop.expiryDate).getTime()) / 86_400_000
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
        `到期日 ${shDayKey(prop.expiryDate)}，已过 ${daysOverdue} 天。` +
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
    // v1.x 收尾：个人邮件摘要（SMTP 配置后启用；当日幂等，发送侧由 worker 执行）
    if (isEmailConfigured()) {
      await enqueueJob({
        type: "email-digest",
        dedupeKey: `email-digest:${localDate}`,
        payload: { date: localDate }
      });
    }
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
