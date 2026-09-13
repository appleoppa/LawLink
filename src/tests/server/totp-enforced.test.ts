// @vitest-environment node
/**
 * TOTP 管理端强制开启（收尾 c）单测。
 *
 * 覆盖：
 * - forceEnforceTotp：仅 SUPER_ADMIN；置位 + USER_TOTP_ENFORCE 审计；幂等不重复审计；
 *   enabled=false 撤销；账号不存在拒绝；
 * - 登录 authorize：enforced 且未绑定 → 正确密码也拒绝并审计
 *   LOGIN_TOTP_ENFORCED_REJECT（不计失败锁定）；enforced 且已绑定 → 走既有 TOTP 校验；
 * - disableTotp：被强制的账号不可自行关闭；
 * - checkLoginTotpEnforcement 预检只在 enforced&&!enabled 时为 true。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, session, auditMock, approvalAuditMock, approvalTx, requireSessionMock } = vi.hoisted(() => {
  const db: Record<string, any> = {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data }))
    },
    systemSetting: { findUnique: vi.fn(async () => null) }
  };
  return {
    db,
    session: { user: { id: "cadmin00000000000000000001", role: "PRINCIPAL_LAWYER", systemRole: "SUPER_ADMIN", rolePermissions: undefined } },
    auditMock: vi.fn(),
    approvalAuditMock: vi.fn(),
    approvalTx: vi.fn(),
    requireSessionMock: vi.fn()
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", async () => {
  const { isSystemAdmin } = await import("@/lib/auth/system-role");
  return {
    requireSession: requireSessionMock,
    requireSystemAdmin: async () => {
      if (!isSystemAdmin(session.user)) throw new Error("仅系统超级管理员可执行");
      return session;
    }
  };
});
vi.mock("@/server/audit", () => ({ audit: auditMock, auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/approvals/service", () => ({
  approvalTransaction: approvalTx,
  approvalAudit: approvalAuditMock
}));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(async () => true) } }));
vi.mock("@/server/auth/totp-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/totp-actions")>();
  return {
    ...actual,
    verifyLoginSecondFactor: vi.fn(async () => true) // authorize 内部依赖；其余用真实现
  };
});

import { forceEnforceTotp } from "@/server/users/actions";
import { disableTotp, checkLoginTotpEnforcement } from "@/server/auth/totp-actions";
import { authOptions } from "@/lib/auth/options";

const ADMIN = session.user.id;
const TARGET = "cuser00000000000000000001";

/** requireSession 统一走 mock；session.user.systemRole 可变以驱动 requireSystemAdmin */
beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockImplementation(async () => session);
  approvalTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
  // users/actions assertCurrentAdmin 复用 db.user.findUnique（ADMIN 行）
  db.user.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === ADMIN ? { active: true, systemRole: session.user.systemRole } : null
  );
});

describe("forceEnforceTotp（仅 SUPER_ADMIN）", () => {
  it("非系统管理员调用被拒绝", async () => {
    session.user.systemRole = "NONE";
    await expect(forceEnforceTotp({ id: TARGET })).rejects.toThrow();
    expect(approvalAuditMock).not.toHaveBeenCalled();
    session.user.systemRole = "SUPER_ADMIN";
  });

  it("置位成功并写 USER_TOTP_ENFORCE 审计", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ADMIN ? { active: true, systemRole: "SUPER_ADMIN" } : { active: true, totpEnforced: false, totpEnabled: true }
    );
    const res = await forceEnforceTotp({ id: TARGET });
    expect(res).toEqual({ ok: true, enforced: true });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TARGET },
      data: { totpEnforced: true }
    }));
    expect(approvalAuditMock).toHaveBeenCalledWith(expect.anything(), ADMIN, "USER_TOTP_ENFORCE", TARGET, expect.objectContaining({ enforced: true, alreadyBound: true }));
  });

  it("幂等：状态未变不重复更新/审计", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ADMIN ? { active: true, systemRole: "SUPER_ADMIN" } : { active: true, totpEnforced: true, totpEnabled: false }
    );
    const res = await forceEnforceTotp({ id: TARGET });
    expect(res).toEqual({ ok: true, enforced: true });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(approvalAuditMock).not.toHaveBeenCalled();
  });

  it("enabled=false 撤销强制（解锁误设置）", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ADMIN ? { active: true, systemRole: "SUPER_ADMIN" } : { active: true, totpEnforced: true, totpEnabled: true }
    );
    const res = await forceEnforceTotp({ id: TARGET, enabled: false });
    expect(res).toEqual({ ok: true, enforced: false });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { totpEnforced: false } }));
  });

  it("账号不存在拒绝", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === ADMIN ? { active: true, systemRole: "SUPER_ADMIN" } : null
    );
    await expect(forceEnforceTotp({ id: TARGET })).rejects.toThrow("账号不存在");
  });
});

describe("登录 authorize 的强制拦截", () => {
  // 本地 node_modules 的 next-auth/providers/credentials.js 曾被改写为 stub
  // （authorize 恒 null，真实配置挂在 provider.options）——两种形态都取得到真实实现。
  const provider = authOptions.providers[0] as { authorize?: (c: unknown) => Promise<unknown>; options?: { authorize?: (c: unknown) => Promise<unknown> } };
  const authorize = provider.options?.authorize ?? provider.authorize!;

  const loginRow = (over: Record<string, unknown>) => ({
    id: TARGET, name: "用户甲", email: "a@example.com", passwordHash: "hash",
    active: true, role: "LAWYER", systemRole: "NONE", sessionVersion: 0, avatar: null,
    failedLoginAttempts: 0, lockedUntil: null, totpEnabled: false, totpEnforced: false, ...over
  });

  it("enforced 且未绑定：密码正确也拒绝并审计（不计失败锁定）", async () => {
    db.user.findUnique.mockResolvedValue(loginRow({ totpEnforced: true, totpEnabled: false }));
    const res = await authorize({ email: "a@example.com", password: "correct" });
    expect(res).toBeNull();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "LOGIN_TOTP_ENFORCED_REJECT",
      targetId: TARGET,
      detail: expect.objectContaining({ hint: "BIND_TOTP_FIRST" })
    }));
    expect(db.user.update).not.toHaveBeenCalled(); // 不累计 failedLoginAttempts
  });

  it("enforced 且已绑定：走既有 TOTP 校验并放行", async () => {
    db.user.findUnique.mockResolvedValue(loginRow({ totpEnforced: true, totpEnabled: true }));
    const res = await authorize({ email: "a@example.com", password: "correct", totpCode: "123456" });
    expect(res).toMatchObject({ id: TARGET });
    expect(auditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN_TOTP_ENFORCED_REJECT" }));
  });

  it("未强制且未绑定：正常放行（默认行为不变）", async () => {
    db.user.findUnique.mockResolvedValue(loginRow({}));
    const res = await authorize({ email: "a@example.com", password: "correct" });
    expect(res).toMatchObject({ id: TARGET });
  });
});

describe("disableTotp / 登录页预检", () => {
  it("被强制的账号不可自行关闭双步验证", async () => {
    requireSessionMock.mockImplementation(async () => ({ user: { id: TARGET, role: "LAWYER", rolePermissions: undefined } }));
    db.user.findUnique.mockResolvedValue({ totpSecret: "s", totpEnabled: true, totpEnforced: true, recoveryCodeHashes: [] });
    const res = await disableTotp({ code: "123456" });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无法自行关闭");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("checkLoginTotpEnforcement 仅在 enforced 且未绑定时为 true", async () => {
    db.user.findUnique.mockResolvedValue({ totpEnforced: true, totpEnabled: false });
    expect(await checkLoginTotpEnforcement("a@example.com")).toBe(true);
    db.user.findUnique.mockResolvedValue({ totpEnforced: true, totpEnabled: true });
    expect(await checkLoginTotpEnforcement("a@example.com")).toBe(false);
    db.user.findUnique.mockResolvedValue(null);
    expect(await checkLoginTotpEnforcement("nobody@example.com")).toBe(false);
  });
});
