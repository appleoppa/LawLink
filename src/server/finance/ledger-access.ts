import { assertTailAuthority } from "@/server/archive/closure";
import { Prisma } from "@prisma/client";
import { resolveRoleUser } from "@/lib/roles/service";
import { canExecuteFinance, scopeFor, type PermissionKey } from "@/lib/roles/catalog";
import { canConfirmReceipt, matterAssociationFilter } from "@/lib/permissions";
import { ActionError } from "@/lib/action-error";

/** 与角色配置共用锁；在事务内复核账号/岗位/案件，不采用调用者传来的权限。 */
export async function assertLedgerWrite(db: Prisma.TransactionClient, userId: string, matterId: string, permission: Extract<PermissionKey, "finance.write" | "finance.confirm" | "finance.correct" | "finance.settle">, options: { allowTail?: boolean } = { allowTail: true }) {
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
  await db.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
  const user = await db.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!user?.active) throw new ActionError("账号已停用或不存在");
  const current = await resolveRoleUser(userId, user.role, db);
  if (!current.enabled || (user.role === "CUSTOM" && !scopeFor(current, permission))) throw new ActionError("当前岗位没有此项财务权限");
  if (permission === "finance.confirm" && !canConfirmReceipt(current)) throw new ActionError("仅具备确认实收到账权限的人员可核对账务");
  if ((permission === "finance.correct" || permission === "finance.settle") && !canExecuteFinance(current, permission)) throw new ActionError("当前岗位没有此项独立财务执行权限");
  const globalFinance = user.role === "FINANCE" || (user.role === "CUSTOM" && scopeFor(current, permission) === "ALL");
  await db.$queryRaw`SELECT id FROM "Matter" WHERE id=${matterId} FOR SHARE`;
  const matter = await db.matter.findFirst({ where: { id: matterId, deletedAt: null, ...(globalFinance ? {} : matterAssociationFilter(userId)) }, select: { status: true } });
  if (!matter) throw new ActionError("案件不存在或无权处理");
  if (matter.status === "ARCHIVED") { if(!options.allowTail)throw new ActionError("归档后不得新增或变更委托，请建立有关联的新案件"); await assertTailAuthority(db,userId,matterId); }
}
