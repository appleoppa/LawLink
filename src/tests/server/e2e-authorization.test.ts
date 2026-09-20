// @vitest-environment node
/**
 * E2E 越权用例（收尾 e，vitest 集成形式，不起 Playwright）——三条金线：
 *
 * 1. 全局搜索：无 documents.read 的自定义角色会话，documents 恒为空且不查候选池
 *    （派生搜索授权过滤，报告 P0-2/P1 §三）；
 * 2. AI 审查收案材料分支：非归属用户（非创建人/主办/协办/管理岗）被
 *    assertCanReviewDocument 拒绝，归属用户放行（报告 P0 第 4 项 / 证据 C07）；
 * 3. 队列崩溃恢复：recoverStaleLeases 只重置过期租约的 RUNNING 任务为
 *    PENDING（attempts 不变——没执行完不扣次数），未过期/非 RUNNING 不动。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session, canRead } = vi.hoisted(() => {
  const db: Record<string, any> = {
    matter: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    client: { findMany: vi.fn(async () => []) },
    intake: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
    document: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    systemSetting: { findUnique: vi.fn(async () => null) },
    jobQueue: { updateMany: vi.fn(async () => ({ count: 0 })) }
  };
  return {
    db,
    session: { expires: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "clawyer0000000000000000001", role: "CUSTOM", systemRole: "NONE", avatar: null, rolePermissions: [] as import("@/lib/roles/catalog").RoleGrant[] } },
    canRead: vi.fn(async () => true)
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: canRead })); // 全局搜索的逐条过滤仍走下载同源口径

import { globalSearch } from "@/server/search/actions";
import { assertCanReviewDocument } from "@/server/ai/document-access";
import { recoverStaleLeases } from "@/server/cron/queue";

const ME = session.user.id;
const OTHER = "clawyer0000000000000000002";
const INTAKE = "cintake000000000000000000001";
const DOCID = "cdocum0000000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  db.document.findMany.mockResolvedValue([]);
  db.document.count.mockResolvedValue(0);
  db.matter.count.mockResolvedValue(0);
  db.user.findUnique.mockResolvedValue({ role: "LAWYER", active: true, managerAuthorized: false });
  db.document.findUnique.mockResolvedValue({ id: DOCID, uploadedById: OTHER, matterId: null, intakeId: INTAKE, deletedAt: null });
});

describe("① 全局搜索：无 documents.read 的会话查不到任何材料", () => {
  it("CUSTOM 角色无 documents.read 授权 → documents 为空且不触达候选池查询", async () => {
    session.user.rolePermissions = [
      { permissionKey: "matters.read", scope: "OWN" } // 有案件读授权，但没有材料读授权
    ];
    const res = await globalSearch("合同");
    expect(res.documents).toEqual([]);
    expect(db.document.findMany).not.toHaveBeenCalled(); // 授权过滤在查询前短路
    expect(res.matters).toEqual([]); // 其余桶不受影响（mock 均为空）
  });

  it("同一会话补上 documents.read 授权后进入候选池查询（对照）", async () => {
    session.user.rolePermissions = [
      { permissionKey: "matters.read", scope: "OWN" },
      { permissionKey: "documents.read", scope: "OWN" }
    ];
    await globalSearch("合同");
    expect(db.document.findMany).toHaveBeenCalledTimes(1);
  });

  it("候选命中但逐条授权失败时不出现在结果里（授权后过滤）", async () => {
    session.user.rolePermissions = [{ permissionKey: "documents.read", scope: "OWN" }];
    db.document.findMany.mockResolvedValue([
      { id: "d1", name: "他人合同.pdf", textContent: null, uploadedById: OTHER, matterId: "m-x", intakeId: null, matter: { id: "m-x", internalCode: "X-1" }, intake: null }
    ]);
    canRead.mockResolvedValue(false); // 与下载同口径的逐条过滤拒绝
    const res = await globalSearch("合同");
    expect(res.documents).toEqual([]);
  });
});

describe("② AI 审查：全文外发资格按材料归属逐件判断（P1-2）", () => {
  const doc = { id: DOCID, matterId: null, intakeId: INTAKE };

  it("非归属用户（非创建人/主办/协办、非合伙人岗位）被拒绝", async () => {
    session.user.role = "LAWYER";
    db.intake.findUnique.mockResolvedValue({ createdById: OTHER, ownerUserId: OTHER, coUserIds: [] });
    await expect(assertCanReviewDocument(session, doc)).rejects.toThrow("无权审查该材料");
  });

  it("收案创建人 / 主办 / 协办各自可审查", async () => {
    session.user.role = "LAWYER";
    for (const over of [
      { createdById: ME, ownerUserId: OTHER, coUserIds: [] },
      { createdById: OTHER, ownerUserId: ME, coUserIds: [] },
      { createdById: OTHER, ownerUserId: OTHER, coUserIds: [ME] }
    ]) {
      db.intake.findUnique.mockResolvedValue(over);
      await expect(assertCanReviewDocument(session, doc)).resolves.toBeUndefined();
    }
  });

  it("合伙人岗位可审查；managerAuthorized 业务管理权不放大全文外发资格", async () => {
    db.intake.findUnique.mockResolvedValue({ createdById: OTHER, ownerUserId: OTHER, coUserIds: [] });
    // 断言以数据库中的当前角色为准（防会话快照过期），与站内口径一致
    db.user.findUnique.mockResolvedValue({ role: "PRINCIPAL_LAWYER", active: true });
    session.user.role = "PRINCIPAL_LAWYER";
    await expect(assertCanReviewDocument(session, doc)).resolves.toBeUndefined();

    session.user.role = "LAWYER";
    db.user.findUnique.mockResolvedValue({ role: "LAWYER", active: true, managerAuthorized: true });
    await expect(assertCanReviewDocument(session, doc)).rejects.toThrow("无权审查该材料");
    db.user.findUnique.mockResolvedValue({ role: "LAWYER", active: true, managerAuthorized: false });
  });

  it("案件材料按主办/成员判断：非成员的管理权用户被拒绝，成员放行", async () => {
    const matterDoc = { id: DOCID, matterId: "cmatter00000000000000000001", intakeId: null };
    db.document.findUnique.mockResolvedValue({ ...matterDoc, uploadedById: OTHER, deletedAt: null });
    session.user.role = "LAWYER";
    db.user.findUnique.mockResolvedValue({ role: "LAWYER", active: true, managerAuthorized: true });
    db.matter.count.mockResolvedValue(0);
    await expect(assertCanReviewDocument(session, matterDoc)).rejects.toThrow("无权审查该材料");
    db.matter.count.mockResolvedValue(1);
    await expect(assertCanReviewDocument(session, matterDoc)).resolves.toBeUndefined();
  });

  it("无归属材料仅上传者本人可审查", async () => {
    const orphan = { id: DOCID, matterId: null, intakeId: null };
    db.document.findUnique.mockResolvedValue({ ...orphan, uploadedById: ME, deletedAt: null });
    session.user.role = "LAWYER";
    await expect(assertCanReviewDocument(session, orphan)).resolves.toBeUndefined();
    db.document.findUnique.mockResolvedValue({ ...orphan, uploadedById: OTHER, deletedAt: null });
    await expect(assertCanReviewDocument(session, orphan)).rejects.toThrow("无权审查该材料");
  });
});

describe("③ 队列崩溃恢复：过期租约语义", () => {
  it("只把 RUNNING 且租约过期的任务重置为 PENDING，attempts 不变", async () => {
    db.jobQueue.updateMany.mockResolvedValue({ count: 3 });
    const n = await recoverStaleLeases();
    expect(n).toBe(3);
    expect(db.jobQueue.updateMany).toHaveBeenCalledTimes(1);
    const [args] = db.jobQueue.updateMany.mock.calls[0];
    expect(args.where).toMatchObject({ status: "RUNNING", leaseUntil: { lt: expect.any(Date) } });
    expect(args.data).toEqual({ status: "PENDING", leaseUntil: null });
    expect(JSON.stringify(args.data)).not.toContain("attempts"); // 未执行完不扣次数
  });

  it("无过期租约时返回 0（幂等，可空跑）", async () => {
    db.jobQueue.updateMany.mockResolvedValue({ count: 0 });
    expect(await recoverStaleLeases()).toBe(0);
  });
});
