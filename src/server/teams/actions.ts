"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSystemAdmin } from "@/lib/auth/session";
import { readableTeamFilter } from "@/lib/permissions";
import { teamInputSchema, type TeamInput } from "./schemas";
import { ActionError } from "@/lib/action-error";

export async function listTeams() {
  await requireSystemAdmin();
  return prisma.team.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      leader: { select: { id: true, name: true } },
      members: {
        where: { active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, active: true } } }
      }
    }
  });
}

export async function listReadableTeams() {
  const session = await requireSession("personal");
  return prisma.team.findMany({
    where: readableTeamFilter(session.user.id),
    orderBy: { name: "asc" },
    select: { id: true, name: true }
  });
}

export async function saveTeam(input: TeamInput) {
  const session = await requireSystemAdmin();
  const data = teamInputSchema.parse(input);
  const memberMap = new Map(data.members.map((m) => [m.userId, m.canViewAllMatters]));
  memberMap.set(data.leaderId, true);
  try {
    const id = await prisma.$transaction(async (tx) => {
      const previous = data.id ? await tx.team.findUnique({
        where: { id: data.id }, include: { members: { where: { active: true } } }
      }) : null;
      if (data.id && (!previous || previous.updatedAt.getTime() !== data.expectedUpdatedAt?.getTime())) {
        throw new ActionError("团队已被其他管理员更新，请刷新后重试");
      }
      const users = await tx.user.findMany({
        where: { id: { in: [...memberMap.keys()] } },
        select: { id: true, active: true, role: true }
      });
      if (users.length !== memberMap.size) throw new ActionError("部分成员不存在，请刷新后重试");
      // Existing disabled members may remain so their historical cases stay in the team.
      if (users.some((u) => !u.active && !previous?.members.some((m) => m.userId === u.id))) {
        throw new ActionError("不能新增已停用的账号为成员");
      }
      const leader = users.find((u) => u.id === data.leaderId);
      if (!leader?.active || !["PRINCIPAL_LAWYER", "INDEPENDENT_LAWYER", "LAWYER"].includes(leader.role)) {
        throw new ActionError("负责人须为有效律师账号");
      }
      const fields = { name: data.name, leaderId: data.leaderId, active: data.active };
      const team = previous
        ? await tx.team.update({ where: { id: previous.id }, data: fields })
        : await tx.team.create({ data: fields });
      await tx.teamMember.updateMany({
        where: { teamId: team.id, userId: { notIn: [...memberMap.keys()] } },
        data: { active: false, canViewAllMatters: false }
      });
      for (const [userId, canViewAllMatters] of memberMap) {
        await tx.teamMember.upsert({
          where: { teamId_userId: { teamId: team.id, userId } },
          create: { teamId: team.id, userId, canViewAllMatters },
          update: { active: true, canViewAllMatters }
        });
      }
      await tx.auditLog.create({ data: {
        userId: session.user.id,
        action: previous ? "TEAM_UPDATE" : "TEAM_CREATE",
        targetType: "Team", targetId: team.id,
        detail: {
          before: previous ? { leaderId: previous.leaderId, active: previous.active,
            members: previous.members.map((m) => ({ userId: m.userId, canViewAllMatters: m.canViewAllMatters })) } : null,
          after: { leaderId: data.leaderId, active: data.active,
            members: [...memberMap].map(([userId, canViewAllMatters]) => ({ userId, canViewAllMatters })) }
        }
      } });
      return team.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new ActionError("团队名称已存在，请使用其他名称");
      if (error.code === "P2034") throw new ActionError("团队正在被更新，请刷新后重试");
    }
    throw error;
  }
}
