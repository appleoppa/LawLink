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
import { auditTx } from "@/server/audit";
import { checkRoleMutation } from "@/lib/roles/service";
import { assertCanModifyMatter } from "@/lib/permissions";
import { assertMatterWritable } from "@/lib/archive/guard";
import { refreshScheduleReminderAfterSave, retireScheduleReminders } from "@/server/reminders/schedule";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

async function loadDeadlineWithGuard(id: string) {
  const deadline = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!deadline) throw new ActionError("期限不存在");
  return deadline;
}

const confirmSchema = z.object({ id: z.string().cuid() });

/** 确认规则生成的待定期限（起算事实、规则、结果就此固定） */
export async function confirmDeadline(input: z.infer<typeof confirmSchema>) {
  const session = await requireSession("schedule.write");
  const { id } = confirmSchema.parse(input);
  const deadline = await loadDeadlineWithGuard(id);

  await assertCanModifyMatter(session.user.id, session.user.role, deadline.procedure.matterId);
  await assertMatterWritable(deadline.procedure.matterId);
  if (deadline.confirmStatus !== "PENDING") {
    throw new ActionError("该期限已确认");
  }
  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    const changed = await tx.deadline.updateMany({
      where: { id, confirmStatus: "PENDING", updatedAt: deadline.updatedAt },
      data: { confirmStatus: "CONFIRMED" }
    });
    if (changed.count !== 1) throw new ActionError("期限已被其他人处理，请刷新后重试");
    await retireScheduleReminders(tx, "Deadline", id);
    await auditTx(tx, { userId: session.user.id, action: "DEADLINE_CONFIRM", targetType: "Deadline", targetId: id,
      detail: { sourceRuleId: deadline.sourceRuleId, dueAt: deadline.dueAt.toISOString() } });
  });
  await refreshScheduleReminderAfterSave("Deadline", id);
  await revalidateMatter(deadline.procedure.matterId);
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

  await assertCanModifyMatter(session.user.id, session.user.role, deadline.procedure.matterId);
  await assertMatterWritable(deadline.procedure.matterId);
  const previous = deadline.dueAt;
  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "schedule.write");
    const changed = await tx.deadline.updateMany({
      where: { id: data.id, updatedAt: deadline.updatedAt },
      data: { dueAt: data.dueAt, confirmStatus: "ADJUSTED", adjustedById: session.user.id, adjustedAt: new Date() }
    });
    if (changed.count !== 1) throw new ActionError("期限已被其他人修改，请刷新后重试");
    await retireScheduleReminders(tx, "Deadline", data.id);
    await auditTx(tx, { userId: session.user.id, action: "DEADLINE_ADJUST", targetType: "Deadline", targetId: data.id,
      detail: { previousDueAt: previous.toISOString(), newDueAt: data.dueAt.toISOString(), reason: data.reason, sourceRuleId: deadline.sourceRuleId } });
  });
  await refreshScheduleReminderAfterSave("Deadline", data.id);
  await revalidateMatter(deadline.procedure.matterId);
  return { ok: true };
}

// 规则重算可写性守卫已移至 ./recalc-guard（无 "use server" 的内部模块）：
// 断言 helper 在 action 文件里导出会成为可探测状态的无鉴权 RPC 端点。
