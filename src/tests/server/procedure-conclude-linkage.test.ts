import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 2026-09-21 全流程验收发现（P1）：填写「裁决/结案时间」不联动程序状态，
 * ENGAGED 程序无任何 UI 入口置为 CONCLUDED，结案门禁永远拦截。
 * 本测试锁定联动：concludedAt 有值 → status=CONCLUDED。
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    matterProcedure: { findUnique: vi.fn(), update: vi.fn() },
    procedureParty: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    party: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    matter: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
  }
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/roles/service", () => ({ checkRoleMutation: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ assertCanHandleMatter: vi.fn() }));
vi.mock("@/server/procedures/route", () => ({ assertAgencyAllowedForProcedure: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "u1", role: "LAWYER" } }))
}));

import { prisma } from "@/lib/prisma";
import { updateProcedureInfo } from "@/server/matters/actions";

const procFindUnique = prisma.matterProcedure.findUnique as ReturnType<typeof vi.fn>;
const procUpdate = prisma.matterProcedure.update as ReturnType<typeof vi.fn>;
const partyFindMany = prisma.procedureParty.findMany as ReturnType<typeof vi.fn>;
const partyValidFind = prisma.party.findMany as ReturnType<typeof vi.fn>;

describe("updateProcedureInfo 程序终结联动", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    procFindUnique.mockResolvedValue({ matterId: "m1", type: "FIRST_INSTANCE" });
    partyFindMany.mockResolvedValue([]);
    partyValidFind.mockResolvedValue([]);
    procUpdate.mockResolvedValue({});
  });

  it("填写裁决/结案时间时程序状态联动为 CONCLUDED", async () => {
    await updateProcedureInfo({
      procedureId: "p1",
      concludedAt: "2026-09-20",
      procedureParties: []
    });
    const data = procUpdate.mock.calls[0][0].data;
    expect(data.concludedAt).toBeInstanceOf(Date);
    expect(data.status).toBe("CONCLUDED");
  });

  it("未填写结案时间不改动状态（缺省路径不含 status 键）", async () => {
    await updateProcedureInfo({ procedureId: "p1", caseNumber: "（2026）沪0101民初1号", procedureParties: [] });
    const data = procUpdate.mock.calls[0][0].data;
    expect(data.concludedAt).toBeNull();
    expect("status" in data).toBe(false);
  });
});
