"use server";

/**
 * 期限来源确认与人工调整（报告 P0-8）。
 *
 * 规则生成的期限以 PENDING 落库，律师核对起算事实后确认；
 * 人工调整记录调整人与时间（ADJUSTED），调整后的期限不被规则重算静默覆盖。
 * 现阶段没有自动重算引擎——保护规则先行落地：任何批量/规则侧更新
 * 必须跳过 CONFIRMED/ADJUSTED 期限（assertDeadlineRecalcWritable）。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";

async function loadDeadlineWithGuard(id: string) {
  const deadline = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!deadline) throw new Error("期限不存在");
  return deadline;
}

const confirmSchema = z.object({ id: z.string().cuid() });

/** 确认规则生成的待定期限（起算事实、规则、结果就此固定） */
export async function confirmDeadline(input: z.infer<typeof confirmSchema>) {
  const session = await requireSession("schedule.write");
  const { id } = confirmSchema.parse(input);
  const deadline = await loadDeadlineWithGuard(id);

  if (deadline.confirmStatus === "CONFIRMED") {
    throw new Error("该期限已确认");
  }
  await prisma.deadline.update({
    where: { id },
    data: { confirmStatus: "CONFIRMED" }
  });
  await audit({
    userId: session.user.id,
    action: "DEADLINE_CONFIRM",
    targetType: "Deadline",
    targetId: id,
    detail: { sourceRuleId: deadline.sourceRuleId, dueAt: deadline.dueAt.toISOString() }
  });
  return { ok: true };
}

const adjustSchema = z.object({
  id: z.string().cuid(),
  dueAt: z.coerce.date(),
  reason: z.string().min(1, "请填写调整原因").max(200)
});

/** 人工调整期限到期日：写 ADJUSTED + 调整人/时间，全程留痕 */
export async function adjustDeadline(input: z.infer<typeof adjustSchema>) {
  const session = await requireSession("schedule.write");
  const data = adjustSchema.parse(input);
  const deadline = await loadDeadlineWithGuard(data.id);

  const previous = deadline.dueAt;
  await prisma.deadline.update({
    where: { id: data.id },
    data: {
      dueAt: data.dueAt,
      confirmStatus: "ADJUSTED",
      adjustedById: session.user.id,
      adjustedAt: new Date()
    }
  });
  await audit({
    userId: session.user.id,
    action: "DEADLINE_ADJUST",
    targetType: "Deadline",
    targetId: data.id,
    detail: {
      previousDueAt: previous.toISOString(),
      newDueAt: data.dueAt.toISOString(),
      reason: data.reason,
      sourceRuleId: deadline.sourceRuleId
    }
  });
  return { ok: true };
}

/**
 * 规则重算可写性守卫：规则侧/批量侧更新只允许作用于 PENDING 期限。
 * CONFIRMED / ADJUSTED 期限由人工确认过——重算结果应另行生成待复核记录，
 * 不得静默覆盖（报告 P0-8 验收门槛）。
 */
export async function assertDeadlineRecalcWritable(ids: string[]) {
  const protectedRows = await prisma.deadline.findMany({
    where: { id: { in: ids }, confirmStatus: { in: ["CONFIRMED", "ADJUSTED"] } },
    select: { id: true, confirmStatus: true }
  });
  if (protectedRows.length > 0) {
    throw new Error(
      `有 ${protectedRows.length} 条期限已经人工确认或调整，规则重算不得覆盖；请生成待复核记录`
    );
  }
}
