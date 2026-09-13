import { prisma } from "@/lib/prisma";

/** Existing disabled assignees may remain; new assignments must use active accounts. */
export async function assertAssignableColleagues(userIds: string[], retainedIds: string[] = []) {
  const ids = [...new Set(userIds)];
  const retained = new Set(retainedIds);
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, active: true } });
  if (users.length !== ids.length || users.some((u) => !u.active && !retained.has(u.id))) {
    throw new Error("所选人员不存在或账号已停用，请刷新后重新选择");
  }
}
