"use server";

/**
 * 证据项（EvidenceItem）服务动作 —— P2 材料出处链第一阶段（报告 §6.3）。
 *
 * 逐条记录事实/主张/分析，并引用来源文档 + 页码；引用是"纯引用"：
 * 材料删除后证据项保留、引用悬空由列表返回 sourceDocumentName=null 表达，
 * 不级联、不回填、不推测。
 *
 * 权限：创建按既有案件写入断言（assertCanAccessMatter）；列表按
 * matters.read（assertCanReadMatter，含团队只读授权）。
 * UI 入口待 A 线接入（报告 §6.3 第二阶段做报告内嵌引用）。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { assertCanAccessMatter, assertCanReadMatter } from "@/lib/permissions";

const createSchema = z.object({
  matterId: z.string().cuid(),
  title: z.string().min(1, "标题必填").max(200),
  content: z.string().min(1, "内容必填").max(5000),
  kind: z.enum(["FACT", "CLAIM", "ANALYSIS", "ISSUE", "TODO_VERIFY"]),
  sourceDocumentId: z.string().cuid().optional().nullable(),
  sourcePage: z.number().int().min(1).max(10000).optional().nullable()
}).superRefine((val, ctx) => {
  // 有页码必须挂在文档上（页码没有独立意义）
  if (val.sourcePage != null && !val.sourceDocumentId) {
    ctx.addIssue({ code: "custom", path: ["sourcePage"], message: "填写页码须先选择来源材料" });
  }
});

export type CreateEvidenceItemInput = z.input<typeof createSchema>;

/** 新建证据项。来源文档必须未删除且归属同一案件（收案阶段材料不参与挂链）。 */
export async function createEvidenceItem(input: CreateEvidenceItemInput) {
  const session = await requireSession("matters.write");
  const data = createSchema.parse(input);

  await assertCanAccessMatter(session.user.id, session.user.role, data.matterId, session.user.rolePermissions);

  if (data.sourceDocumentId) {
    const doc = await prisma.document.findUnique({
      where: { id: data.sourceDocumentId },
      select: { matterId: true, deletedAt: true }
    });
    if (!doc || doc.deletedAt) throw new Error("来源材料不存在或已删除");
    if (doc.matterId !== data.matterId) throw new Error("来源材料不属于该案件");
  }

  const created = await prisma.$transaction(async tx => {
    const row = await tx.evidenceItem.create({
      data: {
        matterId: data.matterId,
        title: data.title,
        content: data.content,
        kind: data.kind,
        sourceDocumentId: data.sourceDocumentId ?? null,
        sourcePage: data.sourcePage ?? null,
        createdById: session.user.id
      },
      select: { id: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "EVIDENCE_ITEM_CREATE",
      targetType: "EvidenceItem",
      targetId: row.id,
      detail: {
        matterId: data.matterId,
        kind: data.kind,
        sourceDocumentId: data.sourceDocumentId ?? null,
        sourcePage: data.sourcePage ?? null
      }
    });
    return row;
  });
  return { ok: true as const, id: created.id };
}

export type EvidenceItemView = {
  id: string;
  title: string;
  content: string;
  kind: "FACT" | "CLAIM" | "ANALYSIS" | "ISSUE" | "TODO_VERIFY";
  sourceDocumentId: string | null;
  /** 来源材料名；纯引用悬空（材料已删除）时为 null */
  sourceDocumentName: string | null;
  sourcePage: number | null;
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
};

/** 案件证据项列表（matters.read；含团队只读授权）。悬空引用不补名、不剔除。 */
export async function listEvidenceItems(matterId: string): Promise<EvidenceItemView[]> {
  const session = await requireSession("matters.read");
  await assertCanReadMatter(session.user.id, session.user.role, matterId, session.user.rolePermissions);

  const rows = await prisma.evidenceItem.findMany({
    where: { matterId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, title: true, content: true, kind: true,
      sourceDocumentId: true, sourcePage: true, createdById: true, createdAt: true,
      createdBy: { select: { name: true } }
    }
  });

  const docIds = [...new Set(rows.map(r => r.sourceDocumentId).filter((v): v is string => Boolean(v)))];
  const docs = docIds.length
    ? await prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(docs.map(d => [d.id, d.name] as const));

  return rows.map(r => ({
    ...r,
    sourceDocumentName: r.sourceDocumentId ? nameById.get(r.sourceDocumentId) ?? null : null,
    createdByName: r.createdBy?.name ?? null
  }));
}
