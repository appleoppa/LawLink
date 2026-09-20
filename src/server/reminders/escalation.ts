/**
 * 逾期升级链（v5 改进报告 P1 收尾 a 项）。
 *
 * 期限逾期档（offset >= 1）在通知主办之外，另发一条给主办所在有效团队的负责人。
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
  | "SKIP_SELF" // 负责人即主办本人（已收原始提醒）
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

/**
 * 对单条逾期期限执行升级：查主办所在有效团队（去重后）逐个负责人投递。
 * 返回逐负责人结果（无团队时返回空数组，由调用方决定是否审计）。
 */
export async function escalateOverdueDeadlineToTeamLeaders(
  params: EscalateOverdueDeadlineParams
): Promise<EscalationOutcome[]> {
  if (params.offset < 1) return [];

  // 主办所在有效团队（含有效成员关系）；团队停用即不升级
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

  const refType = `DueReminderEscalation:+${params.offset}:Deadline`;
  const outcomes: EscalationOutcome[] = [];
  const seenLeaderIds = new Set<string>();

  for (const team of teams) {
    const leader = team.leader;
    if (seenLeaderIds.has(leader.id)) continue; // 多团队同一负责人只发一次
    seenLeaderIds.add(leader.id);

    if (leader.id === params.ownerId) {
      outcomes.push("SKIP_SELF");
      continue;
    }
    if (!leader.active) {
      outcomes.push("SKIP_INACTIVE");
      await audit({
        userId: null,
        action: "SKIP_ESCALATION",
        targetType: "Deadline",
        targetId: params.deadlineId,
        detail: { matterId: params.matterId, teamId: team.id, leaderId: leader.id, reason: "LEADER_INACTIVE", offset: params.offset }
      });
      continue;
    }

    // 访问资格实时校验（CUSTOM 角色需先解析授权；其余角色 filter 自含团队逻辑）
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
        targetType: "Deadline",
        targetId: params.deadlineId,
        detail: { matterId: params.matterId, teamId: team.id, leaderId: leader.id, reason: "NO_MATTER_ACCESS", offset: params.offset }
      });
      continue;
    }

    // 去重按（接收人, 期限, 当日）：跨团队多负责人时各自都应收到，只按 refId 去重会静默吞掉其余负责人
    const dup = await prisma.notification.findFirst({
      where: { userId: leader.id, refType, refId: params.deadlineId, createdAt: { gte: params.todayStart } },
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
      title: `【升级】逾期 ${params.offset} 天：${params.deadlineTitle}`,
      content: `案件 ${params.internalCode}·${params.matterTitle} 的期限已逾期 ${params.offset} 天仍未完成，请关注督办。`,
      href: matterHref({ id: params.matterId, internalCode: params.internalCode }),
      refType,
      refId: params.deadlineId
    });
    outcomes.push("SENT");
  }
  return outcomes;
}
