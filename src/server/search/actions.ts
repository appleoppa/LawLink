"use server";

import { hasCustomPermission } from "@/lib/roles/catalog";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import {
  matterReadVisibilityFilter,
  intakeReadVisibilityFilter,
  clientVisibilityFilter,
} from "@/lib/permissions";
import { canReadDocument } from "@/lib/approvals/documents";
import { blindIdNumber } from "@/lib/clients/id-number-crypto";
import { normalizeIdNumber } from "@/lib/clients/identity";
import { matterHref } from "@/lib/matters/route";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  type: "matter" | "client" | "intake" | "document";
}

export interface GlobalSearchResult {
  matters: SearchResultItem[];
  clients: SearchResultItem[];
  intakes: SearchResultItem[];
  documents: SearchResultItem[];
  /** v1.x 批次⑤（11 页注脚）：识别失败未纳入全文的材料数（失败状态可见） */
  documentsFailedCount: number;
}

/**
 * v1.x P0-2: 文档候选池检索——名称/标签命中，或抽取文本层命中（全文检索）。
 * 命中正文不等于可读正文：候选逐条经 canReadDocument（与下载同口径，
 * 含收案材料、申请附件等场景）后过滤；条目数与片段只对有权文档返回。
 */
async function searchDocumentsAuthorized(
  q: string,
  userId: string,
  role: string,
  rolePermissions: unknown,
  limit: number
): Promise<SearchResultItem[]> {
  if (!hasCustomPermission(
    { role, rolePermissions } as Parameters<typeof hasCustomPermission>[0],
    "documents.read"
  )) {
    return [];
  }

  const candidates = await prisma.document.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { tags: { has: q } },
        { textContent: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 40,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, category: true, textContent: true,
      uploadedById: true, matterId: true, intakeId: true,
      matter: { select: { id: true, internalCode: true } },
      intake: { select: { id: true, title: true } },
    },
  });

  const results: SearchResultItem[] = [];
  for (const doc of candidates) {
    if (results.length >= limit) break;
    if (!(await canReadDocument(userId, doc))) continue;

    // 命中片段 + 页码（正文以 \f 分页，pageOfOffset 换算 1 起页码；仅授权文档返回）
    let snippet = "";
    let pageNo: number | null = null;
    if (doc.textContent) {
      const idx = doc.textContent.toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) {
        snippet = doc.textContent.slice(Math.max(0, idx - 20), idx + q.length + 40).replace(/\s+/g, " ");
        const { pageOfOffset } = await import("@/lib/documents/text-extraction");
        pageNo = pageOfOffset(doc.textContent, idx);
      }
    }
    const contextLabel =
      doc.matter?.internalCode
      ?? (doc.intake ? `收案 · ${doc.intake.title}` : "");
    results.push({
      id: doc.id,
      title: doc.name,
      subtitle: snippet ? `${contextLabel}${pageNo ? ` · 第 ${pageNo} 页` : ""} · 命中正文：…${snippet}…` : contextLabel,
      href: doc.matter ? matterHref(doc.matter) : doc.intake ? `/intakes/${doc.intake.id}` : "",
      type: "document" as const,
    });
  }
  return results;
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  const session = await requireSession("personal");
  if (!query || query.trim().length < 1) {
    return { matters: [], clients: [], intakes: [], documents: [], documentsFailedCount: 0 };
  }

  const q = query.trim();
  const userId = session.user.id;
  const role = session.user.role;
  const mVis = matterReadVisibilityFilter(userId, role, session.user.rolePermissions);
  const cVis = clientVisibilityFilter(userId, role, session.user.rolePermissions);
  const iVis = intakeReadVisibilityFilter(userId, role, session.user.rolePermissions);
  const limit = 5;

  const [matters, clients, intakes, documents] = await Promise.all([
    prisma.matter.findMany({
      where: { deletedAt: null, ...mVis, OR: [
        { title: { contains: q, mode: "insensitive" } },
        { internalCode: { contains: q, mode: "insensitive" } },
        { primaryClient: { name: { contains: q, mode: "insensitive" } } },
      ]},
      take: limit,
      select: { id: true, title: true, internalCode: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.client.findMany({
      where: { deletedAt: null, AND: [cVis], OR: [
        { name: { contains: q, mode: "insensitive" } },
        // P1 §三：证件号改盲索引等值（模糊退役）
        { idNumberBlind: blindIdNumber(normalizeIdNumber(q) ?? "") },
        { phone: { contains: q } },
      ]},
      take: limit,
      select: { id: true, name: true, type: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.intake.findMany({
      where: {
        status: { not: "CONVERTED" },
        ...iVis,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { client: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      take: limit,
      select: { id: true, title: true, status: true },
      orderBy: { receivedAt: "desc" },
    }),
    // v1.x P0-2: 文档检索走授权后过滤（名称/标签/正文文本层，覆盖收案材料）
    searchDocumentsAuthorized(q, userId, role, session.user.rolePermissions, limit),
  ]);

  const documentsFailedCount = await prisma.document.count({
    where: { deletedAt: null, ocrStatus: "FAILED" }
  });

  return {
    matters: matters.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: `${m.internalCode} · ${m.status}`,
      href: matterHref(m),
      type: "matter" as const,
    })),
    clients: clients.map((c) => ({
      id: c.id,
      title: c.name,
      subtitle: c.type,
      href: `/clients/${c.id}`,
      type: "client" as const,
    })),
    intakes: intakes.map((i) => ({
      id: i.id,
      title: i.title,
      subtitle: i.status,
      href: `/intakes/${i.id}`,
      type: "intake" as const,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      subtitle: d.subtitle,
      href: d.href,
      type: "document" as const,
    })),
    documentsFailedCount,
  };
}
