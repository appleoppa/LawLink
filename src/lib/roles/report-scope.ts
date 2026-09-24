import type { Prisma } from "@prisma/client";
import { customMatterFilter, matterFinanceVisibilityFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import type { RoleUser } from "./catalog";
export type ReportAccess = { matters: Prisma.MatterWhereInput; finance: Prisma.MatterWhereInput };
export function reportAccess(user: RoleUser & { id: string }, exporting = false): ReportAccess {
  if (user.role !== "CUSTOM") return { matters: {}, finance: {} };
  const scope = customMatterFilter(user.id, user.rolePermissions, exporting ? "reports.export" : "reports.read", false);
  return {
    matters: { AND: [scope, matterReadVisibilityFilter(user.id, user.role, user.rolePermissions)] },
    finance: { AND: [scope, matterFinanceVisibilityFilter(user.id, user.role, user.rolePermissions)] },
  };
}
