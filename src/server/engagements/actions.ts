"use server";

/**
 * 委托（Engagement）服务动作 —— P2 五对象第一步（只加不减）。
 *
 * 创建委托 / 关联事项 / 终止委托，均为显式操作 + 审计；
 * 现有收案与 Billing 流程不改动（第二步迁移再切换写入路径）。
 * 样例验收对应 TARGET-MODEL-PLAN §三：一委托多事项、委托终止但款项未结
 * （终止不校验财务状态——状态轴分离原则）。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { matterReadVisibilityFilter } from "@/lib/permissions";

const createSchema = z.object({
  clientId: z.string().cuid(),
  title: z.string().min(1, "委托名称必填").max(120),
  scopeText: z.string().max(2000).optional().or(z.literal("")),
  feeNote: z.string().max(500).optional().or(z.literal("")),
  startedAt: z.coerce.date().optional(),
  matterIds: z.array(z.string().cuid()).default([])
});

export async function createEngagement(input: z.input<typeof createSchema>) {
  const session = await requireSession("matters.write");
  const data = createSchema.parse(input);

  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true, name: true, deletedAt: true } });
  if (!client || client.deletedAt) throw new Error("客户不存在或已停用");

  // 关联事项必须可见（防越权挂链）
  if (data.matterIds.length > 0) {
    const visible = await prisma.matter.count({
      where: { id: { in: data.matterIds }, deletedAt: null, ...matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) }
    });
    if (visible !== data.matterIds.length) throw new Error("存在无权关联的案件");
  }

  const created = await prisma.$transaction(async tx => {
    const eng = await tx.engagement.create({
      data: {
        clientId: data.clientId,
        title: data.title,
        scopeText: data.scopeText || null,
        feeNote: data.feeNote || null,
        startedAt: data.startedAt ?? null,
        matters: { create: data.matterIds.map(matterId => ({ matterId })) }
      },
      select: { id: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "ENGAGEMENT_CREATE",
      targetType: "Engagement",
      targetId: eng.id,
      detail: { clientId: data.clientId, title: data.title, matterIds: data.matterIds }
    });
    return eng;
  });
  return { ok: true as const, id: created.id };
}

const linkSchema = z.object({
  engagementId: z.string().cuid(),
  matterId: z.string().cuid(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional()
});

/** 关联事项到委托（样例 7：一事项先后涉及多份委托，带生效区间） */
export async function linkEngagementMatter(input: z.infer<typeof linkSchema>) {
  const session = await requireSession("matters.write");
  const data = linkSchema.parse(input);

  const [eng, matterVisible] = await Promise.all([
    prisma.engagement.findUnique({ where: { id: data.engagementId }, select: { id: true, endedAt: true } }),
    prisma.matter.count({
      where: { id: data.matterId, deletedAt: null, ...matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) }
    })
  ]);
  if (!eng) throw new Error("委托不存在");
  if (eng.endedAt) throw new Error("委托已终止，不可再关联事项");
  if (matterVisible !== 1) throw new Error("无权关联该案件");

  await prisma.$transaction(async tx => {
    await tx.engagementMatter.upsert({
      where: { engagementId_matterId: { engagementId: data.engagementId, matterId: data.matterId } },
      create: { engagementId: data.engagementId, matterId: data.matterId, validFrom: data.validFrom ?? null, validTo: data.validTo ?? null },
      update: { validFrom: data.validFrom ?? null, validTo: data.validTo ?? null }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "ENGAGEMENT_LINK_MATTER",
      targetType: "Engagement",
      targetId: data.engagementId,
      detail: { matterId: data.matterId, validFrom: data.validFrom, validTo: data.validTo }
    });
  });
  return { ok: true as const };
}

const terminateSchema = z.object({
  engagementId: z.string().cuid(),
  reason: z.string().min(1, "请填写终止原因").max(300)
});

/**
 * 终止委托。样例 5：委托终止但款项未结——终止不校验财务状态
 * （程序/收费/服务三条状态轴分离）；未结款项由核销体系继续表达。
 */
export async function terminateEngagement(input: z.infer<typeof terminateSchema>) {
  const session = await requireSession("matters.write");
  const data = terminateSchema.parse(input);

  const eng = await prisma.engagement.findUnique({ where: { id: data.engagementId }, select: { endedAt: true } });
  if (!eng) throw new Error("委托不存在");
  if (eng.endedAt) throw new Error("委托已终止");

  await prisma.$transaction(async tx => {
    await tx.engagement.update({
      where: { id: data.engagementId },
      data: { endedAt: new Date(), terminatedReason: data.reason }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "ENGAGEMENT_TERMINATE",
      targetType: "Engagement",
      targetId: data.engagementId,
      detail: { reason: data.reason }
    });
  });
  return { ok: true as const };
}

/** 案件的委托列表（详情页展示用；含终止的以保留历史） */
export async function listEngagementsForMatter(matterId: string) {
  const session = await requireSession("matters.read");
  void session;
  const rows = await prisma.engagementMatter.findMany({
    where: { matterId },
    orderBy: { createdAt: "desc" },
    select: {
      validFrom: true,
      validTo: true,
      engagement: {
        select: {
          id: true, title: true, scopeText: true, feeNote: true,
          startedAt: true, endedAt: true, terminatedReason: true,
          client: { select: { id: true, name: true } }
        }
      }
    }
  });
  return rows;
}
