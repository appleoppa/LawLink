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
import { customMatterFilter, matterVisibilityFilter } from "@/lib/permissions";
import { clientTypeLabel, deadlineCategoryLabel, intakeStatusLabel, matterStatusLabel } from "@/lib/enums";
import type { DocumentSourceOrigin } from "@prisma/client";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  type: "matter" | "client" | "intake" | "document" | "deadline";
  /** 墨案 11 页展示字段（仅授权后返回） */
  snippet?: string;
  pageNo?: number | null;
  sourceOrigin?: DocumentSourceOrigin | null;
  ocr?: boolean;
  /** 归属说明（如「属于 XX · LL-2026-…」） */
  context?: string;
  code?: string;
  /** 命中字段说明（名称命中 / 案号命中 / 委托方命中 / 备注命中 …） */
  matchedBy?: string;
  meta?: string;
  dueAt?: string;
  /** 材料/期限所属案件链接（「跳转案件」） */
  matterLink?: string;
}

export interface GlobalSearchResult {
  matters: SearchResultItem[];
  clients: SearchResultItem[];
  intakes: SearchResultItem[];
  documents: SearchResultItem[];
  deadlines: SearchResultItem[];
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
      sourceOrigin: true, textSource: true,
      matter: { select: { id: true, internalCode: true, title: true } },
      stage: { select: { name: true } },
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
    const href = doc.matter ? matterHref(doc.matter) : doc.intake ? `/intakes/${doc.intake.id}` : "";
    results.push({
      id: doc.id,
      title: doc.name,
      subtitle: snippet ? `${contextLabel}${pageNo ? ` · 第 ${pageNo} 页` : ""} · 命中正文：…${snippet}…` : contextLabel,
      href,
      type: "document" as const,
      snippet: snippet || undefined,
      pageNo,
      sourceOrigin: doc.sourceOrigin ?? null,
      ocr: doc.textSource === "OCR",
      matchedBy: snippet ? "正文命中" : "名称命中",
      context: doc.matter
        ? `属于 ${doc.matter.title ?? ""}${doc.stage?.name ? ` · ${doc.stage.name}` : ""}`
        : doc.intake ? `属于 收案 · ${doc.intake.title}` : "",
      code: doc.matter?.internalCode,
      matterLink: href || undefined,
    });
  }
  return results;
}

export async function globalSearch(query: string): Promise<GlobalSearchResult> {
  const session = await requireSession("personal");
  if (!query || query.trim().length < 1) {
    return { matters: [], clients: [], intakes: [], documents: [], deadlines: [], documentsFailedCount: 0 };
  }

  const q = query.trim();
  const userId = session.user.id;
  const role = session.user.role;
  const mVis = matterReadVisibilityFilter(userId, role, session.user.rolePermissions);
  const cVis = clientVisibilityFilter(userId, role, session.user.rolePermissions);
  const iVis = intakeReadVisibilityFilter(userId, role, session.user.rolePermissions);
  // 分组各取前 20 条：「全部」范围前端每组展示前几条，切换到单一范围时展示全部
  const limit = 20;
  const canSchedule = hasCustomPermission(session.user, "schedule.read");
  // 期限与日程页同口径：CUSTOM 走 schedule.read 授权范围，其余角色走案件可见性
  const deadlineMatterFilter = role === "CUSTOM"
    ? { AND: [customMatterFilter(userId, session.user.rolePermissions, "schedule.read", true), mVis] }
    : matterVisibilityFilter(userId, role);

  const [matters, clients, intakes, documents, deadlines] = await Promise.all([
    prisma.matter.findMany({
      where: { deletedAt: null, ...mVis, OR: [
        { title: { contains: q, mode: "insensitive" } },
        { internalCode: { contains: q, mode: "insensitive" } },
        { primaryClient: { name: { contains: q, mode: "insensitive" } } },
      ]},
      take: limit,
      select: { id: true, title: true, internalCode: true, status: true, owner: { select: { name: true } }, primaryClient: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.client.findMany({
      where: { deletedAt: null, AND: [cVis], OR: [
        { name: { contains: q, mode: "insensitive" } },
        // P1 §三：证件号改盲索引等值（模糊退役）
        { idNumberBlind: blindIdNumber(normalizeIdNumber(q) ?? "") },
        { phone: { contains: q } },
        { notes: { contains: q, mode: "insensitive" } },
      ]},
      take: limit,
      select: { id: true, name: true, type: true, notes: true, _count: { select: { matters: true } } },
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
      select: { id: true, title: true, status: true, receivedAt: true, client: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
    }),
    // v1.x P0-2: 文档检索走授权后过滤（名称/标签/正文文本层，覆盖收案材料）
    searchDocumentsAuthorized(q, userId, role, session.user.rolePermissions, limit),
    canSchedule
      ? prisma.deadline.findMany({
          where: {
            completed: false,
            title: { contains: q, mode: "insensitive" },
            procedure: { engagement: "ENGAGED", matter: { deletedAt: null, ...deadlineMatterFilter } },
          },
          take: limit,
          orderBy: { dueAt: "asc" },
          select: {
            id: true, title: true, category: true, dueAt: true,
            procedure: { select: { matter: { select: { id: true, internalCode: true, title: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  const documentsFailedCount = await prisma.document.count({
    where: { deletedAt: null, ocrStatus: "FAILED" }
  });

  const lower = q.toLowerCase();
  const around = (text: string) => {
    const idx = text.toLowerCase().indexOf(lower);
    if (idx < 0) return text.slice(0, 40);
    return `${idx > 12 ? "…" : ""}${text.slice(Math.max(0, idx - 12), idx + q.length + 24)}${idx + q.length + 24 < text.length ? "…" : ""}`;
  };

  return {
    matters: matters.map((m) => {
      const matchedBy = m.title.toLowerCase().includes(lower) ? "名称命中"
        : m.internalCode.toLowerCase().includes(lower) ? "编号命中"
        : "委托方命中";
      return {
        id: m.id,
        title: m.title,
        subtitle: `${m.internalCode} · ${matterStatusLabel[m.status]}`,
        href: matterHref(m),
        type: "matter" as const,
        code: m.internalCode,
        matchedBy: matchedBy === "委托方命中" && m.primaryClient?.name ? `委托方「${m.primaryClient.name}」命中` : matchedBy,
        meta: [m.owner?.name ? `主办 ${m.owner.name}` : null, matterStatusLabel[m.status]].filter(Boolean).join(" · "),
      };
    }),
    clients: clients.map((c) => {
      const byNotes = !c.name.toLowerCase().includes(lower) && c.notes?.toLowerCase().includes(lower);
      return {
        id: c.id,
        title: c.name,
        subtitle: clientTypeLabel[c.type],
        href: `/clients/${c.id}`,
        type: "client" as const,
        matchedBy: byNotes ? `备注：「${around(c.notes ?? "")}」` : c.name.toLowerCase().includes(lower) ? "名称命中" : "证件/电话命中",
        meta: `${clientTypeLabel[c.type]} · 累计案件 ${c._count.matters}`,
      };
    }),
    intakes: intakes.map((i) => ({
      id: i.id,
      title: i.title,
      subtitle: intakeStatusLabel[i.status],
      href: `/intakes/${i.id}`,
      type: "intake" as const,
      meta: [i.client?.name ? `委托方 ${i.client.name}` : null, intakeStatusLabel[i.status]].filter(Boolean).join(" · "),
      dueAt: i.receivedAt.toISOString(),
    })),
    documents: documents.map((d) => ({ ...d, type: "document" as const })),
    deadlines: deadlines.map((d) => {
      const matter = d.procedure.matter;
      return {
        id: d.id,
        title: d.title,
        subtitle: `${matter.internalCode} · ${deadlineCategoryLabel[d.category]}`,
        href: `${matterHref(matter)}`,
        type: "deadline" as const,
        code: matter.internalCode,
        context: matter.title,
        meta: deadlineCategoryLabel[d.category],
        dueAt: d.dueAt.toISOString(),
        matterLink: matterHref(matter),
      };
    }),
    documentsFailedCount,
  };
}
