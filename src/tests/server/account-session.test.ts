import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
const { user } = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: { user } }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
import { authOptions } from "@/lib/auth/options";
const jwt = authOptions.callbacks!.jwt!;
const token: JWT = { id: "user-id", role: "LAWYER", systemRole: "SUPER_ADMIN", avatar: null, sessionVersion: 0 };
async function refresh(value: JWT = token) { return jwt({ token: { ...value }, account: null, user: undefined } as unknown as Parameters<typeof jwt>[0]); }
beforeEach(() => { vi.resetAllMocks(); user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", sessionVersion: 0, name: "同事", email: "lawyer@example.invalid", avatar: null }); });
describe("已有会话的账号状态验证", () => {
  it("旧登录中的管理员角色会实时降为数据库角色", async () => { expect((await refresh()).role).toBe("LAWYER"); });
  it("账号停用后旧 token 失效", async () => { user.findUnique.mockResolvedValue({ active: false }); expect((await refresh()).id).toBe(""); });
  it("密码重置导致会话版本提升，既有登录失效", async () => { user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", systemRole: "SUPER_ADMIN", sessionVersion: 1 }); expect((await refresh()).id).toBe(""); });
  it("不存在的账号不保留登录", async () => { user.findUnique.mockResolvedValue(null); expect((await refresh()).id).toBe(""); });
  it("旧版无版本 token 仅在账号仍处于初始版本时兼容", async () => {
    expect((await refresh({ ...token, sessionVersion: undefined })).id).toBe("user-id");
    user.findUnique.mockResolvedValue({ active: true, role: "LAWYER", sessionVersion: 1 }); expect((await refresh({ ...token, sessionVersion: undefined })).id).toBe("");
  });
});
