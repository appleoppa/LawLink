/**
 * v0.27: 期限到期提醒扫描
 * v0.38: 增加开庭提醒（Hearing 表）
 *
 * 每天 09:00 跑一次（Asia/Shanghai），覆盖 Deadline / Hearing：
 * - Deadline：命中 dueAt 落在 T-3 / T-1 / T / T+1 的未完成项各发一条通知
 * - Hearing：命中 startsAt 落在 T-3 / T-1 / T（开庭过去不提醒，不含 T+1），文案带具体开庭时间
 * - 接收人：Deadline/Hearing → procedure.matter.ownerId
 * - 去重：refType="DueReminder:Deadline:-3" 等 + refId 实体 ID + 当日已发不再发
 *
 * 业务原因：v0.26 之前没有"扫到期发提醒"机制，导致律师设的答辩期、举证期等到点不响；
 * v0.38 用户要求：凡有具体开庭时间，开庭前主动提醒（提前3天/1天/当天早上）。
 */
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { sendWebhookText } from "@/server/settings/webhook";
import { audit } from "@/server/audit";
import { matterHref } from "@/lib/matters/route";
import { PROPERTY_TYPE_CN } from "@/lib/preservation-defaults";

const OFFSETS = [-3, -1, 0, 1] as const;
type Offset = (typeof OFFSETS)[number];

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
  // v0.50: 汇总本次新提醒，扫描结束后一次性推 webhook（避免逐条刷群）
  const digestLines: string[] = [];

  for (const offset of OFFSETS) {
    const target = new Date(now);
    target.setDate(target.getDate() + offset);
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
    }

    // Hearing 扫描（开庭提醒）—— 开庭过去不再提醒，跳过 T+1 这档
    if (offset <= 0) {
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

  // v0.50: 企微/钉钉 webhook 摘要（未配置时静默跳过；失败写 audit 不中断）
  let webhookResult: { ok: boolean; skipped?: boolean; error?: string } | null = null;
  if (digestLines.length > 0) {
    const MAX_LINES = 20;
    const shown = digestLines.slice(0, MAX_LINES);
    const more = digestLines.length - shown.length;
    webhookResult = await sendWebhookText(
      [
        `LawLink 今日提醒（${digestLines.length} 条）`,
        ...shown,
        ...(more > 0 ? [`… 另有 ${more} 条，详见系统通知`] : [])
      ].join("\n")
    );
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
      offsets: OFFSETS,
      webhook: webhookResult
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
    suppressed
  };
}

// 手动触发入口已移至 @/server/reminders/actions（顶层 "use server"，可被客户端组件 import）
