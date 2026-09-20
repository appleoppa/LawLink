import { Prisma } from "@prisma/client";
import { financeRoleAssociatesAnyMatter, matterAssociationFilter } from "@/lib/permissions";
import type { RoleGrant } from "@/lib/roles/catalog";

export function invoiceMatterSearchWhere(
  userId: string,
  q?: string,
  viewer?: { role: string; rolePermissions?: RoleGrant[] | null }
): Prisma.MatterWhereInput {
  const query = (q ?? "").trim();
  // 与 createFeeEntry 的 allowFinanceRole（assertMatterWritable）同一判定：
  // 财务岗可对全所案件登记收付，搜索放开为全所可见；其他角色仍按本人经办过滤
  const filters: Prisma.MatterWhereInput[] =
    viewer && financeRoleAssociatesAnyMatter(viewer) ? [] : [matterAssociationFilter(userId)];
  if (query) {
    filters.push({
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { internalCode: { contains: query, mode: "insensitive" } },
        { firmCaseNo: { contains: query, mode: "insensitive" } }
      ]
    });
  }
  const scoped: Prisma.MatterWhereInput =
    filters.length === 0 ? {} : filters.length === 1 ? filters[0] : { AND: filters };
  return {
    deletedAt: null,
    ...scoped
  };
}

export function invoiceMatterSearchLimit(q?: string) {
  return (q ?? "").trim() ? 10 : 12;
}
