"use server";
import { checkRoleMutation } from "@/lib/roles/service";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanLeadMatter } from "@/lib/permissions";
import { revalidateMatter } from "@/server/matters/route";
import { recordTimelineEvent } from "@/server/timeline/record";

const closeMatterSchema = z.object({
  id: z.string().cuid(),
  summary: z.string().min(1, "结案小结必填").max(2000)
});

const holdMatterSchema = z.object({
  id: z.string().cuid(),
  reason: z.string().max(500).optional().or(z.literal(""))
});

export type CloseMatterInput = z.infer<typeof closeMatterSchema>;
export type HoldMatterInput = z.infer<typeof holdMatterSchema>;

/**
 * 结案：把案件状态切到 CLOSED，记录结案小结到 TimelineEvent。
 * 不强制要求所有 procedure 都 concluded，律师自行判断。
 */
export async function closeMatter(input: CloseMatterInput) {
  const session = await requireSession("matters.write");
  const data = closeMatterSchema.parse(input);
  await assertMatterWritable(data.id);
  await assertCanLeadMatter(session.user.id, data.id, "仅案件主办/协办可以结案");

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.matter.update({
      where: { id: data.id },
      data: {
        status: "CLOSED",
        closedAt: new Date()
      }
    });
    await recordTimelineEvent(tx, {
        matterId: data.id,
        eventType: "MATTER_CLOSED",
        title: "案件已结案",
        content: data.summary,
        occurredAt: new Date()
      });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_CLOSE",
    targetType: "Matter",
    targetId: data.id,
    detail: { summaryLen: data.summary.length }
  });

  await revalidateMatter(data.id);
  revalidatePath("/matters");
  return { ok: true };
}

/**
 * 归档：完整流程见 src/server/archive/actions.ts → archiveMatter
 * 这里不再保留旧的轻量版本（v0.9.4 起统一走 ArchiveWizard）。
 */

/**
 * 重新开放（从 ON_HOLD / CLOSED 回到 IN_PROGRESS）。
 * ARCHIVED 状态不能重新开放（如需更正应走单独的审计流程）。
 */
export async function reopenMatter(id: string) {
  const session = await requireSession("matters.write");
  const matter = await prisma.matter.findUnique({ where: { id }, select: { status: true } });
  if (!matter) throw new Error("案件不存在");
  await assertMatterWritable(id);
  await assertCanLeadMatter(session.user.id, id, "仅案件主办/协办可以重新开放案件");
  if (matter.status === "ARCHIVED") {
    throw new Error("已归档案件不能重新开放");
  }

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.matter.update({
      where: { id },
      data: {
        status: "IN_PROGRESS",
        closedAt: null
      }
    });
    await recordTimelineEvent(tx, {
        matterId: id,
        eventType: "MATTER_REOPENED",
        title: "案件已重新开放",
        occurredAt: new Date()
      });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_REOPEN",
    targetType: "Matter",
    targetId: id
  });

  await revalidateMatter(id);
  revalidatePath("/matters");
  return { ok: true };
}

/**
 * 暂停案件（客户失联、待补充材料等）。
 */
export async function holdMatter(input: HoldMatterInput) {
  const session = await requireSession("matters.write");
  const data = holdMatterSchema.parse(input);
  await assertMatterWritable(data.id);
  await assertCanLeadMatter(session.user.id, data.id, "仅案件主办/协办可以暂停案件");

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.matter.update({
      where: { id: data.id },
      data: { status: "ON_HOLD" }
    });
    await recordTimelineEvent(tx, {
        matterId: data.id,
        eventType: "MATTER_ON_HOLD",
        title: "案件已暂停",
        content: data.reason || undefined,
        occurredAt: new Date()
      });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_HOLD",
    targetType: "Matter",
    targetId: data.id,
    detail: { reason: data.reason }
  });

  await revalidateMatter(data.id);
  revalidatePath("/matters");
  return { ok: true };
}

/* ---------- v1.x P2 状态轴分离（报告 §6.4 最小版） ---------- */

const completeServiceSchema = z.object({
  id: z.string().cuid(),
  note: z.string().max(500).optional().or(z.literal(""))
});
export type CompleteMatterServiceInput = z.input<typeof completeServiceSchema>;

/**
 * 服务完成（服务轴）。与程序轴（status：办理中/已结案/已归档）分离——
 * 样例 6：一审程序结束不等于律师服务完成；服务完成是主办显式动作，
 * 不自动联动 status，也不校验款项（核销体系独立表达）。
 * UI 入口待 A 线（案件详情操作区）。
 */
export async function completeMatterService(input: CompleteMatterServiceInput) {
  const session = await requireSession("matters.write");
  const data = completeServiceSchema.parse(input);

  const matter = await prisma.matter.findUnique({ where: { id: data.id }, select: { serviceStatus: true } });
  if (!matter) throw new Error("案件不存在");
  await assertMatterWritable(data.id);
  await assertCanLeadMatter(session.user.id, data.id, "仅案件主办/协办可以完成服务");
  if (matter.serviceStatus === "SERVICE_COMPLETED") throw new Error("服务已完成，请勿重复操作");

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.matter.update({
      where: { id: data.id },
      data: { serviceStatus: "SERVICE_COMPLETED" }
    });
    await recordTimelineEvent(tx, {
        matterId: data.id,
        eventType: "MATTER_SERVICE_COMPLETED",
        title: "律师服务已完成",
        content: data.note || undefined,
        occurredAt: new Date()
      });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_SERVICE_COMPLETE",
    targetType: "Matter",
    targetId: data.id,
    detail: { noteLen: data.note?.length ?? 0 }
  });

  await revalidateMatter(data.id);
  revalidatePath("/matters");
  return { ok: true };
}

/**
 * 撤销服务完成（回 SERVICE_ACTIVE）。仅从服务完成态回退；
 * 程序轴状态不变。已归档案件不可回退（assertMatterWritable 拦截）。
 */
export async function activateMatterService(id: string) {
  const session = await requireSession("matters.write");

  const matter = await prisma.matter.findUnique({ where: { id }, select: { serviceStatus: true } });
  if (!matter) throw new Error("案件不存在");
  await assertMatterWritable(id);
  await assertCanLeadMatter(session.user.id, id, "仅案件主办/协办可以恢复服务");
  if (matter.serviceStatus === "SERVICE_ACTIVE") throw new Error("服务尚在进行中");

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "matters.write");
    await tx.matter.update({
      where: { id },
      data: { serviceStatus: "SERVICE_ACTIVE" }
    });
    await recordTimelineEvent(tx, {
        matterId: id,
        eventType: "MATTER_SERVICE_ACTIVATED",
        title: "服务已恢复进行中",
        occurredAt: new Date()
      });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_SERVICE_ACTIVATE",
    targetType: "Matter",
    targetId: id
  });

  await revalidateMatter(id);
  revalidatePath("/matters");
  return { ok: true };
}
