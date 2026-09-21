/**
 * 逾期升级链（v5 改进报告 P1 收尾 a 项；2026-09-20 第六轮体检 P1-3 扩展到保全）。
 *
 * 期限/保全逾期档在通知责任人之外，另发一条给责任人所在有效团队的负责人。
 * 发送前用 matterReadVisibilityFilter 实时校验接收人对该事项的访问资格——
 * 退出团队、撤权、账号停用后即不再送达；无资格时记审计 SKIP_ESCALATION，
 * 不发送、不报错（升级链绝不成为越权读取的旁路）。
 */
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/server/notifications/create";
import { audit } from "@/server/audit";
import { matterReadVisibilityFilter } from "@/lib/permissions";
import { resolveRoleUser } from "@/lib/roles/service";
import { matterHref } from "@/lib/matters/route";

export type EscalationOutcome =
  | "SENT" // 已向该负责人发送升级通知
  | "SUPPRESSED" // 当日已发过（去重）
  | "SKIP_SELF" // 负责人即责任人本人（已收原始提醒）
  | "SKIP_INACTIVE" // 负责人账号停用
  | "SKIP_NO_ACCESS"; // 负责人无该事项访问资格（记审计）

export type EscalateOverdueDeadlineParams = {
  matterId: string;
  matterTitle: string;
  internalCode: string;
  ownerId: string;
  deadlineId: string;
  deadlineTitle: string;
  /** 逾期天数（>= 1 才升级） */
  offset: number;
  todayStart: Date;
};

type EscalationCoreParams = {
  /** 责任人（查其所在有效团队；可能已停用——升级正是为这种情况兜底） */
  ownerId: string;
  /** 已收到原始提醒的接收人（负责人与之相同则跳过）；无原始接收人时不传 */
  notifiedUserId?: string;
  /** 关联案件（null＝保全未关联案件：内容不含案件细节，跳过访问资格校验） */
  matterId: string | null;
  internalCode: string;
  matterTitle: string;
  /** 完整去重 refType（调用方自带偏移与对象类型） */
  refType: string;
  targetType: string;
  targetId: string;
  title: string;
  content: string;
  href: string;
  /** 逾期天数（>= 1 才升级） */
  offset: number;
  todayStart: Date;
};

/**
 * 对单个逾期对象执行升级：查责任人所在有效团队（去重后）逐个负责人投递。
 * 返回逐负责人结果（无团队时返回空数组，由调用方决定是否审计）。
 */
async function escalateToTeamLeaders(params: EscalationCoreParams): Promise<EscalationOutcome[]> {
  if (params.offset < 1) return [];

  // 责任人所在有效团队（含有效成员关系）；团队停用即不升级
  const teams = await prisma.team.findMany({
    where: {
      active: true,
      members: { some: { userId: params.ownerId, active: true } }
    },
    select: {
      id: true,
      name: true,
      leader: { select: { id: true, name: true, role: true, active: true } }
    }
  });
  if (teams.length === 0) return [];

  const outcomes: EscalationOutcome[] = [];
  const seenLeaderIds = new Set<string>();

  for (const team of teams) {
    const leader = team.leader;
    if (seenLeaderIds.has(leader.id)) continue; // 多团队同一负责人只发一次
    seenLeaderIds.add(leader.id);

    if (leader.id === params.ownerId || leader.id === params.notifiedUserId) {
      outcomes.push("SKIP_SELF");
      continue;
    }
    if (!leader.active) {
      outcomes.push("SKIP_INACTIVE");
      await audit({
        userId: null,
        action: "SKIP_ESCALATION",
        targetType: params.targetType,
        targetId: params.targetId,
        detail: { matterId: params.matterId, teamId: team.id, leaderId: leader.id, reason: "LEADER_INACTIVE", offset: params.offset }
      });
      continue;
    }

    // 访问资格实时校验（CUSTOM 角色需先解析授权；其余角色 filter 自含团队逻辑）。
    // 未关联案件的对象（如孤儿保全）内容本身不含案件正文，不做案件级校验。
    if (params.matterId) {
      let grants: import("@/lib/roles/catalog").RoleGrant[] | undefined = undefined;
      if (leader.role === "CUSTOM") {
        const resolved = await resolveRoleUser(leader.id, leader.role);
        grants = resolved.rolePermissions;
      }
      const qualified = await prisma.matter.count({
        where: {
          id: params.matterId,
          deletedAt: null,
          ...matterReadVisibilityFilter(leader.id, leader.role, grants)
        }
      });
      if (qualified !== 1) {
        outcomes.push("SKIP_NO_ACCESS");
        await audit({
          userId: null,
          action: "SKIP_ESCALATION",
          targetType: params.targetType,
          targetId: params.targetId,
          detail: { matterId: params.matterId, teamId: team.id, leaderId: leader.id, reason: "NO_MATTER_ACCESS", offset: params.offset }
        });
        continue;
      }
    }

    // 去重按（接收人, 对象, 当日）：跨团队多负责人时各自都应收到，只按 refId 去重会静默吞掉其余负责人
    const dup = await prisma.notification.findFirst({
      where: { userId: leader.id, refType: params.refType, refId: params.targetId, createdAt: { gte: params.todayStart } },
      select: { id: true }
    });
    if (dup) {
      outcomes.push("SUPPRESSED");
      continue;
    }

    await createNotification({
      userId: leader.id,
      type: "DEADLINE_REMINDER",
      priority: "URGENT",
      title: params.title,
      content: params.content,
      href: params.href,
      refType: params.refType,
      refId: params.targetId
    });
    outcomes.push("SENT");
  }
  return outcomes;
}

/** 期限逾期升级（对既有调用方保持签名与行为不变） */
export async function escalateOverdueDeadlineToTeamLeaders(
  params: EscalateOverdueDeadlineParams
): Promise<EscalationOutcome[]> {
  return escalateToTeamLeaders({
    ownerId: params.ownerId,
    matterId: params.matterId,
    internalCode: params.internalCode,
    matterTitle: params.matterTitle,
    refType: `DueReminderEscalation:+${params.offset}:Deadline`,
    targetType: "Deadline",
    targetId: params.deadlineId,
    title: `【升级】逾期 ${params.offset} 天：${params.deadlineTitle}`,
    content: `案件 ${params.internalCode}·${params.matterTitle} 的期限已逾期 ${params.offset} 天仍未完成，请关注督办。`,
    href: matterHref({ id: params.matterId, internalCode: params.internalCode }),
    offset: params.offset,
    todayStart: params.todayStart
  });
}

/** 保全过期未续封升级（第六轮体检 P1-3：为保全补逾期升级链，口径与期限一致） */
export async function escalateOverduePreservationToTeamLeaders(params: {
  /** 原始责任人（案件/案件主办，可能已停用——升级正是为这种情况兜底） */
  ownerId: string;
  /** 实际收到原始提醒的人（负责人与之相同则跳过）；无人接收时不传 */
  notifiedUserId?: string;
  matterId: string | null;
  internalCode: string | null;
  matterTitle: string | null;
  propertyId: string;
  propertyLabel: string;
  targetName: string;
  /** 逾期天数（>= 1 才升级） */
  daysOverdue: number;
  todayStart: Date;
}): Promise<EscalationOutcome[]> {
  const matterText = params.matterId ? `案件 ${params.internalCode}·${params.matterTitle}` : "未关联案件的保全";
  return escalateToTeamLeaders({
    ownerId: params.ownerId,
    notifiedUserId: params.notifiedUserId,
    matterId: params.matterId,
    internalCode: params.internalCode ?? "",
    matterTitle: params.matterTitle ?? "",
    refType: `PreservationEscalation:+${params.daysOverdue}:PreservationProperty`,
    targetType: "PreservationProperty",
    targetId: params.propertyId,
    title: `【升级】保全已过期 ${params.daysOverdue} 天未续封：${params.targetName} · ${params.propertyLabel}`,
    content: `${matterText} 的保全已过期 ${params.daysOverdue} 天仍未办理续封，查封、扣押、冻结的效力已消灭（查扣冻规定第二十七条），请关注督办。`,
    href: params.matterId && params.internalCode
      ? matterHref({ id: params.matterId, internalCode: params.internalCode })
      : "/preservation",
    offset: params.daysOverdue,
    todayStart: params.todayStart
  });
}
