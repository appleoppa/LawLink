"use server";

/**
 * 法定期限规则管理（挂账项 v0.50 → P0-8 落地）。
 *
 * 仅系统超级管理员可维护；内置规则（isBuiltIn）只能编辑显示与启停，
 * 不能删除——法条依据是内置规则的核心价值；自定义规则可增删改。
 * 规则的 legalBasis/verifiedAt 变更即为"规则版本"变化：已按旧规则生成的
 * 期限不回溯，重算守卫见 @/server/deadlines/confirm。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { revalidatePath } from "next/cache";

const ruleInputSchema = z.object({
  name: z.string().min(1, "规则名称必填").max(60),
  triggerLabel: z.string().min(1, "触发事件必填").max(60),
  periodValue: z.coerce.number().int().min(1).max(3650),
  periodUnit: z.enum(["DAYS", "MONTHS", "YEARS"]),
  category: z.enum(["LIMITATION", "EVIDENCE", "APPEAL", "PERFORMANCE", "RESPONSE", "ENFORCEMENT", "ARBITRATION_SET_ASIDE", "PRESERVATION", "CUSTOM"]),
  legalBasis: z.string().min(1, "法条依据必填").max(200),
  legalBasisUrl: z.string().max(300).optional().or(z.literal("")),
  description: z.string().max(500).optional().or(z.literal("")),
  remindDays: z.coerce.number().int().min(0).max(60).default(7),
  enabled: z.boolean().default(true)
});

export type DeadlineRuleInput = z.infer<typeof ruleInputSchema>;

export async function listDeadlineRulesAdmin() {
  await requireSystemAdmin();
  return prisma.deadlineRule.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, code: true, name: true, description: true, triggerLabel: true,
      periodValue: true, periodUnit: true, category: true,
      legalBasis: true, legalBasisUrl: true, verifiedAt: true,
      remindDays: true, enabled: true, isBuiltIn: true, createdAt: true,
      applicableProcedures: true
    }
  });
}

export async function createDeadlineRule(input: DeadlineRuleInput) {
  const session = await requireSystemAdmin();
  const data = ruleInputSchema.parse(input);
  const code = `CUSTOM-${Date.now().toString(36).toUpperCase()}`;

  const created = await prisma.$transaction(async tx => {
    const rule = await tx.deadlineRule.create({
      data: {
        code,
        name: data.name,
        description: data.description || null,
        triggerLabel: data.triggerLabel,
        periodValue: data.periodValue,
        periodUnit: data.periodUnit,
        category: data.category,
        legalBasis: data.legalBasis,
        legalBasisUrl: data.legalBasisUrl || null,
        remindDays: data.remindDays,
        enabled: data.enabled,
        isBuiltIn: false
      },
      select: { id: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "DEADLINE_RULE_CREATE",
      targetType: "DeadlineRule",
      targetId: rule.id,
      detail: { code, name: data.name, legalBasis: data.legalBasis }
    });
    return rule;
  });

  revalidatePath("/admin/reminders");
  return { ok: true, id: created.id };
}

export async function updateDeadlineRule(input: DeadlineRuleInput & { id: string }) {
  const session = await requireSystemAdmin();
  const { id, ...rest } = input;
  const data = ruleInputSchema.parse(rest);

  const existing = await prisma.deadlineRule.findUnique({ where: { id }, select: { isBuiltIn: true, code: true } });
  if (!existing) throw new Error("规则不存在");

  await prisma.$transaction(async tx => {
    await tx.deadlineRule.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description || null,
        triggerLabel: data.triggerLabel,
        periodValue: data.periodValue,
        periodUnit: data.periodUnit,
        category: data.category,
        legalBasis: data.legalBasis,
        legalBasisUrl: data.legalBasisUrl || null,
        remindDays: data.remindDays,
        enabled: data.enabled
      }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "DEADLINE_RULE_UPDATE",
      targetType: "DeadlineRule",
      targetId: id,
      detail: { code: existing.code, name: data.name, legalBasis: data.legalBasis, enabled: data.enabled }
    });
  });

  revalidatePath("/admin/reminders");
  return { ok: true };
}

export async function toggleDeadlineRule(input: { id: string; enabled: boolean }) {
  const session = await requireSystemAdmin();
  const data = z.object({ id: z.string().cuid(), enabled: z.boolean() }).parse(input);

  const existing = await prisma.deadlineRule.findUnique({ where: { id: data.id }, select: { code: true } });
  if (!existing) throw new Error("规则不存在");

  await prisma.$transaction(async tx => {
    await tx.deadlineRule.update({ where: { id: data.id }, data: { enabled: data.enabled } });
    await auditTx(tx, {
      userId: session.user.id,
      action: data.enabled ? "DEADLINE_RULE_ENABLE" : "DEADLINE_RULE_DISABLE",
      targetType: "DeadlineRule",
      targetId: data.id,
      detail: { code: existing.code }
    });
  });

  revalidatePath("/admin/reminders");
  return { ok: true };
}

export async function deleteDeadlineRule(input: { id: string }) {
  const session = await requireSystemAdmin();
  const { id } = z.object({ id: z.string().cuid() }).parse(input);

  const existing = await prisma.deadlineRule.findUnique({ where: { id }, select: { isBuiltIn: true, code: true } });
  if (!existing) throw new Error("规则不存在");
  if (existing.isBuiltIn) throw new Error("内置规则不可删除，可停用或修正法条依据");

  await prisma.$transaction(async tx => {
    await tx.deadlineRule.delete({ where: { id } });
    await auditTx(tx, {
      userId: session.user.id,
      action: "DEADLINE_RULE_DELETE",
      targetType: "DeadlineRule",
      targetId: id,
      detail: { code: existing.code }
    });
  });

  revalidatePath("/admin/reminders");
  return { ok: true };
}
