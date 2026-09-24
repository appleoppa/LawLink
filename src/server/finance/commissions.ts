import { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/action-error";

/** 按总比例四舍五入到分，再按小数余量分配尾差，避免逐人取整导致超额。 */
export function allocateCommissions(
  amount: number,
  plans: { userId: string; percent: Prisma.Decimal }[]
): Prisma.Decimal[] {
  const total = plans.reduce((sum, plan) => sum.plus(plan.percent), new Prisma.Decimal(0));
  if (!total.isFinite() || total.gt(100) || plans.some(p => p.percent.lt(0)) ||
      new Set(plans.map(p => p.userId)).size !== plans.length) {
    throw new ActionError("分成方案无效，请先修正比例或重复受益人");
  }
  const base = new Prisma.Decimal(amount).toDecimalPlaces(2);
  const shares = plans.map((p, index) => {
    const exactCents = base.mul(p.percent);
    const cents = exactCents.floor();
    return { index, cents, remainder: exactCents.minus(cents), userId: p.userId };
  });
  const target = base.mul(total).toDecimalPlaces(0);
  const allocated = shares.reduce((sum, p) => sum.plus(p.cents), new Prisma.Decimal(0));
  const remaining = target.minus(allocated).toNumber();
  const ranked = [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.userId.localeCompare(b.userId));
  for (let i = 0; i < remaining; i++) ranked[i].cents = ranked[i].cents.plus(1);
  return shares.map(p => p.cents.div(100));
}
