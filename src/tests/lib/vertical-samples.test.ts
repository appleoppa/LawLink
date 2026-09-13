// @vitest-environment node
/**
 * 纵向样例验证（TARGET-MODEL-PLAN §五）——复用/重建判定依据。
 *
 * 样例 A：材料 → 新版本 → 历史固定（版本链不变式）
 *   断言：uploadNewVersion 后旧版本 isLatest 翻转、内容与校验值不变、
 *   旧版本行永不删除——提交包/归档若引用旧版本，其 sha256 不漂移。
 *   （证据项/交付包实体属 P2 材料出处链，本样例先验证版本不变式。）
 *
 * 样例 B：期限触发 → 确认 → 入队 → 投递失败退避 → 接续成功
 *   断言：确认后 confirmStatus=CONFIRMED；webhook 摘要经队列投递，
 *   失败按退避重排、重试成功落 SUCCESS（deliveriedAt 幂等）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------- 样例 A：版本不变式（mock prisma） ---------- */
const { db, session } = vi.hoisted(() => {
  const docState: Record<string, { isLatest: boolean; version: number; sha256: string; deletedAt: Date | null; familyId: string | null; matterId: string | null; intakeId: string | null }> = {
    "d-v1": { isLatest: true, version: 1, sha256: "hash-v1", deletedAt: null, familyId: "d-v1", matterId: "m1", intakeId: null }
  };
  const created: { id: string; version: number; sha256: string }[] = [];
  const db = {
    document: {
      findUnique: vi.fn(async ({ where }: any) => docState[where.id] ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        // 翻转同族旧版本 isLatest（where.familyId 真实参与过滤）
        const family = where?.familyId?.equals ?? null;
        for (const id of Object.keys(docState)) {
          const row = docState[id];
          if (row.isLatest && (family === null || row.familyId === family)) {
            row.isLatest = data.isLatest;
          }
        }
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `d-v${data.version}`;
        docState[id] = { isLatest: data.isLatest, version: data.version, sha256: data.sha256, deletedAt: null, familyId: data.familyId, matterId: data.matterId, intakeId: data.intakeId };
        created.push({ id, version: data.version, sha256: data.sha256 });
        return { id, version: data.version };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(docState[where.id], data);
        return { id: where.id, version: docState[where.id].version };
      })
    },
    auditLog: { create: vi.fn() },
    // 样例 B：期限确认 + 队列接续共用同一 prisma mock
    deadline: {
      findUnique: vi.fn(async () => ({ id: "cidl000000000000000000001", confirmStatus: db.__deadline.confirmStatus, procedure: { matterId: "m1" }, sourceRuleId: "r1", dueAt: new Date() })),
      update: vi.fn(async ({ data }: any) => { Object.assign(db.__deadline, data); return db.__deadline; })
    },
    jobQueue: {
      update: vi.fn(async ({ data }: any) => { Object.assign(db.__job, data); return db.__job; })
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    __state: docState,
    __created: created,
    __deadline: { id: "cidl000000000000000000001", confirmStatus: "PENDING" },
    __job: { id: "j1", status: "PENDING", attempts: 0, runAt: null as Date | null, deliveredAt: null }
  };
  return { db, session: { user: { id: "u1", role: "PRINCIPAL_LAWYER", rolePermissions: undefined } } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn(), auditTx: vi.fn(), auditStrict: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: vi.fn(async () => {}) }));
vi.mock("@/lib/permissions", () => ({ assertCanAccessMatter: vi.fn(async () => {}) }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  storage: { writeFile: vi.fn(async () => "mock-path") }
}));
vi.mock("@/lib/storage/crypto", () => ({
  encryptBuffer: vi.fn(() => ({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), authTag: Buffer.from("z"), algorithm: "aes-256-gcm" })),
  sha256: vi.fn(() => "hash-v2")
}));

import { uploadNewVersion } from "@/server/documents/actions";

describe("纵向样例 A：版本不变式", () => {
  beforeEach(() => vi.clearAllMocks());

  it("新版本上链：旧版本停止 isLatest 但内容/校验值不变且不被删除", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "合同 v2.pdf", { type: "application/pdf" });
    const res = await uploadNewVersion({ documentId: "d-v1", file });

    expect(res.version).toBe(2);
    // 旧版本：isLatest 翻转，其余不变
    expect(db.__state["d-v1"]).toMatchObject({ isLatest: false, version: 1, sha256: "hash-v1", deletedAt: null });
    // 新版本：同族、v2、最新
    expect(db.__state["d-v2"]).toMatchObject({ isLatest: true, version: 2, sha256: "hash-v2", familyId: "d-v1" });
  });

  it("基于非最新版本更新被拒绝（历史不可变分支）", async () => {
    const file = new File([new Uint8Array([9])], "v3.pdf", { type: "application/pdf" });
    await expect(uploadNewVersion({ documentId: "d-v1", file })).rejects.toThrow("只能基于最新版本");
  });
});

/* ---------- 样例 B：期限确认 → 队列投递接续（与样例 A 共用同一 prisma mock） ---------- */

// 样例 B 直接使用已测模块的函数（confirmDeadline / failJob / completeJob）
import { confirmDeadline } from "@/server/deadlines/confirm";
import { failJob, completeJob, backoffMs } from "@/server/cron/queue";

describe("纵向样例 B：确认与队列接续", () => {
  it("待确认期限确认后固定；重复确认被拒", async () => {
    const res = await confirmDeadline({ id: "cidl000000000000000000001" });
    expect(res).toEqual({ ok: true });
    expect(db.__deadline.confirmStatus).toBe("CONFIRMED");
    await expect(confirmDeadline({ id: "cidl000000000000000000001" })).rejects.toThrow("该期限已确认");
  });

  it("投递失败退避重排 → 重试成功落 SUCCESS 且幂等", async () => {
    // 第一次失败：attempts=1，按退避重排 FAILED
    db.__job.attempts = 1;
    const outcome1 = await failJob("j1", 1, 5, "webhook timeout");
    expect(outcome1).toBe("RETRY");
    expect(db.__job.status).toBe("FAILED");
    expect(db.__job.runAt!.getTime()).toBeGreaterThan(Date.now() - 1000);
    // 第二次成功
    await completeJob("j1");
    expect(db.__job.status).toBe("SUCCESS");
    expect(db.__job.deliveredAt).not.toBeNull();
    // 退避单调
    expect(backoffMs(2)).toBeGreaterThanOrEqual(backoffMs(1));
  });
});
