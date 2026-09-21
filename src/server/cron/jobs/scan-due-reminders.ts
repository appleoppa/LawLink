/**
 * v0.27: 期限到期提醒扫描
 * v0.38: 增加开庭提醒（Hearing 表）
 * v1.x: Deadline.remindDays（逐条配置的提前提醒天数，默认 3）生效——
 *       每条期限的有效提前档 = 固定提前档 {-3, -1} ∪ {-remindDays}，
 *       到期当天与逾期 +1 始终提醒；默认值下行为与历史版本一致。
 *       最近一次扫描与 webhook 投递结果写入 SystemSetting 供提醒维护页展示。
 * 2026-09-20 第六轮体检 P1-2/P1-3：保全扫描提取为 scanPreservationReminders——
 *       ① 档位命中式触发对当日停机无补偿，接入调度器每 2 分钟补扫（09:00 前仅
 *       补当日关键档，档位/接收人/当日去重保证幂等）；② 接收人校验与期限/开庭
 *       统一（isReminderRecipientEnabled）：保全负责人停用回退案件主办，全部
 *       失效时升级给持「应急接管」资格者或超管（此前提醒投进永不登录的账号）；
 *       ③ 过期未续封补团队负责人升级链（后果重于多数期限，口径不再倒置）。
 *
 * 每天 09:00 跑一次（Asia/Shanghai），覆盖 Deadline / Hearing / 保全：
 * - Deadline：命中 dueAt 落在有效偏移档（见 src/lib/deadline-reminders.ts）的未完成项各发一条通知
 * - Hearing：命中 startsAt 落在 T-3 / T-1 / T（开庭过去不提醒，不含 T+1），文案带具体开庭时间
 * - 保全：见 scanPreservationReminders 头注
 * - 接收人：优先有效程序主办，回退有效案件主办；保全优先有效保全负责人，回退有效案件主办
 * - 去重：统一服务按实体、日期、接收人及上海当日生成稳定通知主键
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
import { scanScheduleReminders, shDayStart, isReminderRecipientEnabled, type ReminderRecipient } from "@/server/reminders/schedule";
import { escalateOverduePreservationToTeamLeaders } from "@/server/reminders/escalation";
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

// ── v1.2 + 第六轮体检 P1-2/P1-3: 保全续封提醒 ─────────────────────────
//
// 不走 OFFSETS，也不在 Deadline 表里建镜像行，原因有二：
// 1. 提前量不同。OFFSETS 是 -3/-1/0/+1，对答辩、举证够用；续封要备材料、
//    跑法院、等裁定，提前 3 天通知等于没通知。各保全案件自带
//    remindDays（默认 30/15/7/3/1）。
// 2. 建镜像 Deadline 行要多一个关联字段和一套同步逻辑，expiryDate 一改
//    两处就可能不一致；直接扫源表没有这个问题。
//
// 档位按「今天恰好等于某个提前档」触发——这与日程提醒不同：日程补扫每 2 分钟
// 全量重算，本表此前只在每日 09:00 跑一次，停机一天该日档位即永久丢失。现提取
// 为独立函数并由调度器同样每 2 分钟补扫（criticalOnly 时仅当日关键档），去重按
// （对象, 档位, 当日）幂等，重复补扫无副作用。
//
// 后果的严重性决定了这条不能省：《最高人民法院关于人民法院民事执行中
// 查封、扣押、冻结财产的规定》（2020 修正）第二十七条——期限届满未办理
// 延期手续的，查封、扣押、冻结的效力消灭。

const preservationRecipientSelect = { id: true, active: true, role: true, roleDefinition: { select: { active: true } } } as const;

/** 接收人判定所需的最小结构（主/补扫与 lapsed 查询共用，lapsed 不取 remindDays） */
type PreservationRecipientNode = {
  owner: ReminderRecipient | null;
  matter: { id: string; title: string; internalCode: string; owner: ReminderRecipient | null } | null;
};

/** 有效保全负责人优先，回退有效案件主办；全部失效返回 null（调用方升级） */
function pickPreservationRecipient(cs: PreservationRecipientNode): ReminderRecipient | null {
  if (isReminderRecipientEnabled(cs.owner)) return cs.owner;
  const matterOwner = cs.matter?.owner ?? null;
  if (isReminderRecipientEnabled(matterOwner)) return matterOwner;
  return null;
}

/**
 * 保全提醒无合格接收人时的升级（对齐 recordOffboardingRisk 的接收人选择）：
 * 持「应急接管」（matters.transfer，ALL）资格者；无资格人则通知在任超管。
 * 当日每条保全至多一次（通知去重），并记审计 PRESERVATION_RECIPIENT_MISSING。
 */
async function notifyPreservationRecipientMissing(
  prop: { id: string; propertyType: keyof typeof PROPERTY_TYPE_CN; propertyDetail: string | null; target: { name: string } },
  cs: PreservationRecipientNode,
  todayStart: Date
): Promise<void> {
  const refType = "PreservationRecipientMissing";
  const dup = await prisma.notification.findFirst({
    where: { refType, refId: prop.id, createdAt: { gte: todayStart } },
    select: { id: true }
  });
  if (dup) return;

  const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
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
    detail: {
      matterId: cs.matter?.id ?? null,
      preservationOwnerId: cs.owner?.id ?? null,
      matterOwnerId: cs.matter?.owner?.id ?? null,
      receivers: receivers.length
    }
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

export type PreservationReminderScan = {
  preservationScanned: number;
  preservationNotified: number;
  preservationExpired: number;
  suppressed: number;
  /** 逾期升级（团队负责人）送达数 */
  escalationSent: number;
  digestLines: string[];
};

/**
 * 保全续封提醒扫描。09:00 全量扫描与调度器每 2 分钟补扫共用：
 * - criticalOnly=true（09:00 前）：仅补当日关键档（到期当天 / 逾期首日）；
 * - 去重：主循环按（PreservationExpiry:档位, 对象, 当日），升级与无人接收各按自身 refType 当日去重；
 * - 接收人：有效保全负责人 → 有效案件主办 → 升级（P1-3）。
 */
export async function scanPreservationReminders(
  options: { now?: Date; criticalOnly?: boolean } = {}
): Promise<PreservationReminderScan> {
  const now = options.now ?? new Date();
  const todayStart = shDayStart(now);
  let preservationScanned = 0;
  let preservationNotified = 0;
  let suppressed = 0;
  let escalationSent = 0;
  const digestLines: string[] = [];

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
              remindDays: true,
              owner: { select: preservationRecipientSelect },
              matter: {
                select: { id: true, title: true, internalCode: true, owner: { select: preservationRecipientSelect } }
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
    if (options.criticalOnly && !isCritical) continue;
    if (!isCritical && !cs.remindDays.includes(daysUntil)) continue;

    preservationScanned++;

    const recipient = pickPreservationRecipient(cs);
    if (!recipient) {
      await notifyPreservationRecipientMissing(prop, cs, todayStart);
      continue;
    }

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
      userId: recipient.id,
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
  // 翻转后状态离开 ACTIVE/RENEWED，本块天然只对每条执行一次——
  // 逾期升级链（P1-3）挂在这里：原始责任人（可能已停用）所在团队的负责人
  // 另收一条 URGENT 督办，口径与期限逾期升级一致。
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
              owner: { select: preservationRecipientSelect },
              matter: {
                select: { id: true, title: true, internalCode: true, owner: { select: preservationRecipientSelect } }
              }
            }
          }
        }
      }
    }
  });

  let preservationExpired = 0;

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

    const recipient = pickPreservationRecipient(cs);
    const propertyLabel = prop.propertyDetail?.trim() || PROPERTY_TYPE_CN[prop.propertyType];
    if (recipient) {
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
        refType: "PreservationExpired",
        refId: prop.id
      });
      digestLines.push(
        `· 保全已过期未续封：${prop.target.name}·${propertyLabel}（逾期 ${daysOverdue} 天）`
      );
    }

    const rawOwnerId = cs.owner?.id ?? cs.matter?.owner?.id ?? null;
    if (rawOwnerId && daysOverdue >= 1) {
      const outcomes = await escalateOverduePreservationToTeamLeaders({
        ownerId: rawOwnerId,
        notifiedUserId: recipient?.id,
        matterId: cs.matter?.id ?? null,
        internalCode: cs.matter?.internalCode ?? null,
        matterTitle: cs.matter?.title ?? null,
        propertyId: prop.id,
        propertyLabel,
        targetName: prop.target.name,
        daysOverdue,
        todayStart
      });
      escalationSent += outcomes.filter((r) => r === "SENT").length;
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
