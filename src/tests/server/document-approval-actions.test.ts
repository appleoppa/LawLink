import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, session, state } = vi.hoisted(() => {
  const state = { status: "PENDING_REVIEW", failAudit: false, rules: true };
  const db = { user: { findUnique: vi.fn() }, document: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, systemSetting: { findUnique: vi.fn() }, approvalPermissionRule: { findMany: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() };
  return { db, state, session: { user: { id: "reviewer", role: "LAWYER" } } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { approveDocument } from "@/server/documents/actions";
const revision = new Date("2026-09-06T00:00:00Z");
beforeEach(() => {
  vi.resetAllMocks(); state.status = "PENDING_REVIEW"; state.failAudit = false; state.rules = true;
  db.user.findUnique.mockResolvedValue({ active: true, role: "LAWYER" });
  db.systemSetting.findUnique.mockResolvedValue({ value: { enabled: true, allowSelfApproval: false } });
  db.document.findUnique.mockImplementation(async () => ({ id: "doc", uploadedById: "author", matterId: null, name: "待审稿", status: state.status, updatedAt: revision }));
  db.document.findUniqueOrThrow.mockResolvedValue({ uploadedById: "author", matter: null, intake: null });
  db.approvalPermissionRule.findMany.mockImplementation(async () => state.rules ? [{ action: "DOCUMENT_APPROVE", caseScope: "NON_CASE", categories: [], allSealPurposes: false, purposeId: null, sealTypes: [] }] : []);
  db.document.update.mockImplementation(async ({ where, data }) => { if (where.status !== state.status || where.updatedAt !== revision) throw new Error("already processed"); state.status = data.status; return { id: "doc" }; });
  db.auditLog.create.mockImplementation(async () => { if (state.failAudit) throw new Error("audit unavailable"); });
  db.$transaction.mockImplementation(async fn => { const before = state.status; try { return await fn(db); } catch (e) { state.status = before; throw e; } });
});
describe("文书审批服务端入口", () => {
  it("普通律师在获授精确事项后可以审批，不要求升级管理角色", async () => { await expect(approveDocument("doc")).resolves.toEqual({ ok: true }); expect(state.status).toBe("APPROVED"); });
  it("直接调用入口也不能绕过撤权", async () => { state.rules = false; await expect(approveDocument("doc")).rejects.toThrow("未获授"); expect(db.document.update).not.toHaveBeenCalled(); });
  it("同一待审文书只能处理一次", async () => { await approveDocument("doc"); await expect(approveDocument("doc")).rejects.toThrow("不在待审核"); expect(db.document.update).toHaveBeenCalledOnce(); });
  it("审计失败时，事务失败而不是返回审批成功", async () => { state.failAudit = true; await expect(approveDocument("doc")).rejects.toThrow("audit unavailable"); expect(state.status).toBe("PENDING_REVIEW"); });
});
