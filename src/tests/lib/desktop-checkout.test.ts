// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

/** 桌面连接器服务侧地基（DESKTOP-CONNECTOR-PLAN 步骤 1）：
 * 令牌签发/防篡改/过期，以及受控回传的冲突拦截与归属校验。 */
process.env.STORAGE_ENCRYPTION_KEY ??= Buffer.from("k".repeat(32)).toString("base64");

const { db, session } = vi.hoisted(() => {
  const db: Record<string, any> = {
    document: { findUnique: vi.fn() },
    $transaction: vi.fn()
  };
  return {
    db,
    session: {
      expires: new Date(Date.now() + 3600_000).toISOString(),
      user: { id: "clawyer0000000000000000001", role: "LAWYER", systemRole: "NONE", avatar: null, rolePermissions: undefined }
    }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: vi.fn(async () => {}) }));

import { issueCheckoutToken, verifyCheckoutToken } from "@/lib/desktop/checkout-token";
import { uploadNewVersion } from "@/server/documents/actions";
import { getStorageEncryptionKey } from "@/lib/storage/crypto";

const DOC = "cdocume00000000000000000001";

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createHmac("sha256", getStorageEncryptionKey()).update("lawlink:desktop-checkout:v1").digest();
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

describe("checkout 令牌（HMAC 域分隔）", () => {
  it("签发→验证往返保持负载；篡改拒绝", () => {
    const { token } = issueCheckoutToken({ docId: DOC, userId: "u1", baselineVersion: 2, fileName: "合同.docx" });
    expect(verifyCheckoutToken(token)).toMatchObject({ docId: DOC, userId: "u1", baselineVersion: 2 });
    expect(verifyCheckoutToken(token.slice(0, -3) + "aaa")).toBeNull();
    expect(verifyCheckoutToken("not-a-token")).toBeNull();
  });

  it("过期令牌拒绝", () => {
    const expired = sign({ docId: DOC, userId: "u1", baselineVersion: 1, fileName: "a", jti: "j", exp: Date.now() - 1000 });
    expect(verifyCheckoutToken(expired)).toBeNull();
  });
});

describe("uploadNewVersion 受控回传（冲突拦截）", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "合同-v2.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("基线不匹配（他人已传新版）→ 拒绝并提示基于新版另存", async () => {
    const { token } = issueCheckoutToken({ docId: DOC, userId: session.user.id, baselineVersion: 2, fileName: "a.docx" });
    db.document.findUnique.mockResolvedValue({ id: DOC, deletedAt: null, isLatest: true, version: 3, matterId: null, intakeId: null, familyId: DOC });
    await expect(uploadNewVersion({ documentId: DOC, file, checkoutToken: token }))
      .rejects.toThrow(/已被他人更新为第 3 版/);
  });

  it("令牌换人 → 拒绝", async () => {
    const other = issueCheckoutToken({ docId: DOC, userId: "clawyer0000000000000000002", baselineVersion: 1, fileName: "a.docx" });
    db.document.findUnique.mockResolvedValue({ id: DOC, deletedAt: null, isLatest: true, version: 1, matterId: null, intakeId: null, familyId: DOC });
    await expect(uploadNewVersion({ documentId: DOC, file, checkoutToken: other.token }))
      .rejects.toThrow(/不属于当前账号/);
  });
});
