// @vitest-environment node
/**
 * 证据项（EvidenceItem）动作单测 —— P2 材料出处链第一阶段（报告 §6.3）。
 *
 * 覆盖：
 * - 创建成功：事实/主张条目 + 来源文档与页码 + 同事务审计；
 * - 出处校验：来源文档不属于该案件 / 已删除 / 收案阶段（matterId=null）均拒绝；
 * - 页码必须挂在文档上（无文档的页码无意义）；
 * - 列表：按 matters.read 读取、解析来源材料名、悬空引用不补名不剔除；
 * - 无案件访问权时创建/列表被权限断言拦截。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session, perms } = vi.hoisted(() => {
  const db: Record<string, any> = {
    document: { findUnique: vi.fn(), findMany: vi.fn() },
    evidenceItem: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn()
  };
  return {
    db,
    session: { user: { id: "clawyer0000000000000000001", role: "LAWYER", rolePermissions: undefined } },
    perms: { assertCanAccessMatter: vi.fn(async () => {}), assertCanReadMatter: vi.fn(async () => {}), assertCanHandleMatter: vi.fn(async () => {}) }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", () => perms);

import { createEvidenceItem, listEvidenceItems } from "@/server/evidence/actions";
import { auditTx } from "@/server/audit";

const MATTER = "cmatter00000000000000000001";
const OTHER = "cmatter00000000000000000002";
const DOC = "cdocume000000000000000000001";
const ITEM = "ceviden000000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  perms.assertCanAccessMatter.mockResolvedValue(undefined);
  perms.assertCanReadMatter.mockResolvedValue(undefined);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
  db.evidenceItem.create.mockResolvedValue({ id: ITEM });
});

describe("创建证据项", () => {
  it("带来源文档与页码创建成功，同事务审计", async () => {
    db.document.findUnique.mockResolvedValue({ matterId: MATTER, deletedAt: null });

    const res = await createEvidenceItem({
      matterId: MATTER,
      title: "对方主张合同已解除",
      content: "庭审中对方代理人主张双方已于 2026-03 合意解除。",
      kind: "CLAIM",
      sourceDocumentId: DOC,
      sourcePage: 3
    });

    expect(res).toEqual({ ok: true, id: ITEM });
    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        matterId: MATTER,
        kind: "CLAIM",
        sourceDocumentId: DOC,
        sourcePage: 3,
        createdById: session.user.id
      })
    }));
    expect(auditTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "EVIDENCE_ITEM_CREATE",
      targetType: "EvidenceItem",
      targetId: ITEM
    }));
  });

  it("无来源文档的纯分析条目也允许创建", async () => {
    const res = await createEvidenceItem({
      matterId: MATTER, title: "诉讼时效分析", content: "自知道权利受损之日起未满三年。", kind: "ANALYSIS"
    });
    expect(res.ok).toBe(true);
    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceDocumentId: null, sourcePage: null })
    }));
  });

  it("来源文档不属于该案件时拒绝（防跨案挂链）", async () => {
    db.document.findUnique.mockResolvedValue({ matterId: OTHER, deletedAt: null });
    await expect(
      createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "FACT", sourceDocumentId: DOC })
    ).rejects.toThrow("来源材料不属于该案件");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("来源文档已删除时拒绝", async () => {
    db.document.findUnique.mockResolvedValue({ matterId: MATTER, deletedAt: new Date() });
    await expect(
      createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "FACT", sourceDocumentId: DOC })
    ).rejects.toThrow("来源材料不存在或已删除");
  });

  it("来源文档尚挂在收案阶段（matterId=null）时拒绝", async () => {
    db.document.findUnique.mockResolvedValue({ matterId: null, deletedAt: null });
    await expect(
      createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "FACT", sourceDocumentId: DOC })
    ).rejects.toThrow("来源材料不属于该案件");
  });

  it("页码必须挂在来源文档上", async () => {
    await expect(
      createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "FACT", sourcePage: 5 } as never)
    ).rejects.toThrow();
    expect(db.evidenceItem.create).not.toHaveBeenCalled();
  });

  it("无案件办理权时被权限断言拦截（P1-1：证据项创建走经办断言）", async () => {
    perms.assertCanHandleMatter.mockRejectedValue(new Error("案件不存在"));
    await expect(
      createEvidenceItem({ matterId: MATTER, title: "x", content: "y", kind: "ISSUE" })
    ).rejects.toThrow("案件不存在");
    expect(db.evidenceItem.create).not.toHaveBeenCalled();
  });
});

describe("证据项列表", () => {
  it("解析来源材料名；悬空引用返回 null 而非剔除", async () => {
    db.evidenceItem.findMany.mockResolvedValue([
      { id: ITEM, title: "a", content: "c", kind: "FACT", sourceDocumentId: DOC, sourcePage: 2, createdById: session.user.id, createdAt: new Date() },
      { id: "ceviden000000000000000000002", title: "b", content: "c", kind: "TODO_VERIFY", sourceDocumentId: "cdocume00000000000000000000X", sourcePage: null, createdById: session.user.id, createdAt: new Date() }
    ]);
    db.document.findMany.mockResolvedValue([{ id: DOC, name: "借款合同.pdf" }]);

    const rows = await listEvidenceItems(MATTER);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceDocumentName).toBe("借款合同.pdf");
    // 引用的材料已不存在：纯引用悬空，不补名、不剔除
    expect(rows[1].sourceDocumentName).toBeNull();
    expect(rows[1].sourceDocumentId).toBe("cdocume00000000000000000000X");
  });

  it("无 matters.read 级案件访问权时被拦截", async () => {
    perms.assertCanReadMatter.mockRejectedValue(new Error("案件不存在"));
    await expect(listEvidenceItems(MATTER)).rejects.toThrow("案件不存在");
    expect(db.evidenceItem.findMany).not.toHaveBeenCalled();
  });
});
