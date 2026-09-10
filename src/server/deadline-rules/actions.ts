"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanAccessMatter } from "@/lib/permissions";

const procedureIdSchema = z.object({ procedureId: z.string().cuid() });

/**
 * v0.49：列出适用于指定程序的法定期限规则（按程序类型 + 案件类别过滤）。
 * 生成期限本身仍走 addDeadline（单一提交路径，权限校验不重复实现）。
 */
export async function listDeadlineRulesForProcedure(input: { procedureId: string }) {
  const session = await requireSession();
  const { procedureId } = procedureIdSchema.parse(input);

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: procedureId },
    select: {
      type: true,
      matterId: true,
      matter: { select: { category: true } }
    }
  });
  if (!procedure) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, procedure.matterId);

  return prisma.deadlineRule.findMany({
    where: {
      enabled: true,
      AND: [
        {
          OR: [
            { applicableProcedures: { isEmpty: true } },
            { applicableProcedures: { has: procedure.type } }
          ]
        },
        {
          OR: [
            { applicableCategories: { isEmpty: true } },
            { applicableCategories: { has: procedure.matter.category } }
          ]
        }
      ]
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      triggerLabel: true,
      periodValue: true,
      periodUnit: true,
      category: true,
      legalBasis: true,
      legalBasisUrl: true,
      verifiedAt: true,
      remindDays: true
    }
  });
}
