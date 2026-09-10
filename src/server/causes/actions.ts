"use server";

import type { MatterCategory, Prisma, ProcedureType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { causeScopeForSelection } from "@/lib/cause-scope";

const CAUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  shortName: true,
  level: true,
  parentId: true,
  parent: {
    select: {
      id: true,
      name: true,
      level: true,
      parent: { select: { id: true, name: true, level: true } }
    }
  }
} as const;

export type CauseSearchResult = {
  id: string;
  code: string | null;
  name: string;
  shortName: string | null;
  level: number;
  parentId: string | null;
  /** 二级分类名（用于 UI 显示"X / Y"路径） */
  l2Name: string | null;
  /** 一级分类名 */
  l1Name: string | null;
};

function flatten(c: {
  id: string;
  code: string | null;
  name: string;
  shortName: string | null;
  level: number;
  parentId: string | null;
  parent: {
    id: string;
    name: string;
    level: number;
    parent: { id: string; name: string; level: number } | null;
  } | null;
}): CauseSearchResult {
  // 找 l1 / l2：本节点 + 链向上的祖先里按 level 取
  const chain: { name: string; level: number }[] = [{ name: c.name, level: c.level }];
  if (c.parent) chain.push({ name: c.parent.name, level: c.parent.level });
  if (c.parent?.parent) chain.push({ name: c.parent.parent.name, level: c.parent.parent.level });
  const l1 = chain.find((x) => x.level === 1)?.name ?? null;
  const l2 = chain.find((x) => x.level === 2)?.name ?? null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    shortName: c.shortName,
    level: c.level,
    parentId: c.parentId,
    l1Name: l1,
    l2Name: l2
  };
}

/**
 * 搜索规范案由库。
 *
 * - 必传 category
 * - 空 query 时返回该 category 下二级案由（让用户先看分类）+ 部分三级
 * - 模糊匹配 name / shortName / keywords / pinyin
 * - 结果带 parent 链，UI 可显示"二级 / 三级"路径
 */
function codeFilter(prefixes: readonly string[]): Prisma.CauseOfActionWhereInput {
  // 一级 code 形如 CC-7，其子级形如 CC-7-...；用前缀区分（CC-1 不会误命中 CC-10）
  return {
    OR: prefixes.flatMap((p) => [
      { code: p },
      { code: { startsWith: `${p}-` } }
    ])
  };
}

export async function searchCauses(params: {
  category: MatterCategory;
  procedureType?: ProcedureType | null;
  query?: string;
  limit?: number;
}): Promise<CauseSearchResult[]> {
  await requireSession();
  // v0.16: cap 提到 2000 以支持级联 UI 一次性拉全（民事 1055 / 刑事 511）
  const limit = Math.min(params.limit ?? 50, 2000);
  const q = params.query?.trim();
  const scope = causeScopeForSelection(params.category, params.procedureType);
  const scopedWhere: Prisma.CauseOfActionWhereInput = {
    ...(scope.includeCodePrefixes ? codeFilter(scope.includeCodePrefixes) : {}),
    ...(scope.excludeCodePrefixes.length > 0 ? { NOT: codeFilter(scope.excludeCodePrefixes) } : {})
  };

  if (!q) {
    // 空查询：返回该 category 下全部 4 级（级联 UI 需要 level=1）
    const list = await prisma.causeOfAction.findMany({
      where: {
        category: scope.dbCategory,
        active: true,
        ...scopedWhere
      },
      orderBy: [{ level: "asc" }, { code: "asc" }],
      take: limit,
      select: CAUSE_SELECT
    });
    return list.map(flatten);
  }

  const list = await prisma.causeOfAction.findMany({
    where: {
      category: scope.dbCategory,
      active: true,
      level: { gte: 2 }, // 至少二级才可选
      AND: [
        scopedWhere,
        {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { shortName: { contains: q, mode: "insensitive" } },
            { keywords: { has: q } },
            { pinyin: { contains: q, mode: "insensitive" } }
          ]
        }
      ]
    },
    orderBy: [{ level: "asc" }, { code: "asc" }],
    take: limit,
    select: CAUSE_SELECT
  });
  return list.map(flatten);
}

export async function getCauseById(id: string) {
  await requireSession();
  const c = await prisma.causeOfAction.findUnique({
    where: { id },
    select: { ...CAUSE_SELECT, category: true }
  });
  if (!c) return null;
  return { ...flatten(c), category: c.category };
}

/**
 * v0.13: 列出某 category 下所有二级分类（用于级联第一步）
 */
export async function listCauseL2(category: MatterCategory) {
  await requireSession();
  return prisma.causeOfAction.findMany({
    where: { category, active: true, level: 2 },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, parentId: true }
  });
}
