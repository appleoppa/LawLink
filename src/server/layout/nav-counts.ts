"use server";

/**
 * 墨案侧栏计数（02 效果图 nav .count）：案件在办 / 收案待审 / 待我审批 / 客户。
 * 每项独立按当前账号的读取权限计算；无权限或失败返回 null（侧栏不显示该计数），
 * 不因计数失败影响导航。计数口径与各列表页一致，不另立规则。
 */
import { hasCustomPermission } from "@/lib/roles/catalog";
import { getSession } from "@/lib/auth/session";

export type NavCounts = {
  matters: number | null;
  intakes: number | null;
  approvals: number | null;
  clients: number | null;
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getNavCounts(): Promise<NavCounts> {
  const session = await getSession();
  if (!session?.user) return { matters: null, intakes: null, approvals: null, clients: null };
  const user = session.user;
  const canMatters = hasCustomPermission(user, "matters.read");
  const canClients = hasCustomPermission(user, "clients.read");

  const [tabCounts, approvals, clients] = await Promise.all([
    canMatters
      ? safe(async () => {
          const { getMatterTabCounts } = await import("@/server/matters/actions");
          return getMatterTabCounts();
        })
      : null,
    safe(async () => {
      const { listApprovalWorkspace } = await import("@/server/approval-permissions/inbox");
      const res = await listApprovalWorkspace({ tab: "pending" });
      return res.counts.pending;
    }),
    canClients
      ? safe(async () => {
          const { listClients } = await import("@/server/clients/actions");
          const res = await listClients({ page: 1, pageSize: 1 });
          return res.total;
        })
      : null
  ]);

  return {
    matters: tabCounts ? tabCounts.active : null,
    intakes: tabCounts ? tabCounts.intake : null,
    approvals,
    clients
  };
}
