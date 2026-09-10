import type { MatterCategory, ProcedureType } from "@prisma/client";
import {
  causeScopeForSelection,
  isCauseAllowedForSelection,
  isCommercialArbitrationSelection
} from "@/lib/cause-scope";
import { prisma } from "@/lib/prisma";

/**
 * 以案件当前状态为基准做案由校验（v1.2 收口入口）。
 *
 * 基准程序取「当前 ENGAGED 的首个程序」，而不是 order 最小的程序：
 * 后者可能是补录的 INFORMATIONAL 前序程序（如别人代理的一审），
 * 用它当基准会让校验对着一个我们并不代理的程序类型判断。
 *
 * 所有「改案件案由」的入口都应走这里，不要各自去查程序类型。
 */
export async function assertCauseAllowedForMatter(matterId: string, causeId?: string | null) {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      category: true,
      procedures: {
        where: { engagement: "ENGAGED" },
        orderBy: { order: "asc" },
        take: 1,
        select: { type: true }
      }
    }
  });
  if (!matter) throw new Error("案件不存在");

  await assertCauseAllowedForSelection({
    causeId,
    category: matter.category,
    procedureType: matter.procedures[0]?.type
  });
}

export async function assertCauseAllowedForSelection(input: {
  causeId?: string | null;
  category: MatterCategory;
  procedureType?: ProcedureType | null;
}) {
  if (!input.causeId) return;

  const cause = await prisma.causeOfAction.findUnique({
    where: { id: input.causeId },
    select: { id: true, name: true, category: true, code: true, active: true }
  });

  if (!cause) throw new Error("所选案由不存在");
  if (!isCauseAllowedForSelection(cause, input.category, input.procedureType)) {
    const scope = causeScopeForSelection(input.category, input.procedureType);
    if (isCommercialArbitrationSelection(input.category, input.procedureType)) {
      throw new Error("当前选择为商事仲裁时，只能选择合同纠纷和其他财产权益类案由");
    }
    if (input.category === "LABOR_ARBITRATION") {
      throw new Error("劳动仲裁案件只能选择劳动争议类案由");
    }
    if (cause.category !== scope.dbCategory) {
      throw new Error("所选案由与案件类别不匹配，请重新选择");
    }
    throw new Error("所选案由不在当前案件类别可选范围内");
  }
}
