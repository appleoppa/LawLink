import { beforeEach, describe, expect, it, vi } from "vitest";
const { run, create } = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn() }));
const { findUnique, intakeFindFirst } = vi.hoisted(() => ({ findUnique: vi.fn(), intakeFindFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { conflictCheck: { findUnique }, intake: { findFirst: intakeFindFirst } } }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ user: { id: "test-user", role: "LAWYER" } }) }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: async (fn:(db:unknown)=>unknown) => fn({conflictCheck:{create}}) }));
vi.mock("@/server/intakes/workflow", () => ({ currentActor:vi.fn(),intakeWorkflowReady:async()=>false }));
vi.mock("@/lib/roles/service", () => ({ roleMutation: async (_user: unknown, _permission: unknown, fn: (db: unknown) => unknown) => fn({ conflictCheck: { create } }) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/conflicts/algorithm", () => ({ runConflictCheck: run, conflictHitKey: vi.fn() }));
import { runCheckAndSave, setConflictConclusion } from "@/server/conflicts/actions";
import { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";

beforeEach(() => {
  vi.resetAllMocks();
  run.mockResolvedValue({ hits: [], sameNameClients: [], idMatchedClients: [] });
  create.mockResolvedValue({ id: "check", hits: [] });
  // 收案对象级授权：默认放行（登记人本人可见）
  intakeFindFirst.mockResolvedValue({ id: "cintake000000000000000001" });
});
describe("新收案完整检索条件", () => {
  const intakeId = "cintake000000000000000001";
  it("收案检索缺少身份时阻止检索和保存，不默认当作对方", async () => {
    await expect(runCheckAndSave({ intakeId, queries: [{ name: "测试公司" }] })).rejects.toThrow("收案检索必须包含当事人身份");
    expect(run).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("自动携带全部当事人身份和企业证件条件，并消除重复委托方", async () => {
    const queries = buildIntakeConflictQueries({
      client: { name: " 测试公司 ", idNumber: "TEST-CODE" },
      parties: [
        { role: "CLIENT_PARTY", name: "测试公司", idNumber: null, enterpriseSocialCode: "TEST-CODE" },
        { role: "CLIENT_PARTY", name: "测试公司", idNumber: null },
        { role: "CO_LITIGANT", name: "共同诉讼人", idNumber: null },
        { role: "THIRD_PARTY", name: "第三人", idNumber: "TEST-ID" }
      ]
    });
    expect(queries).toHaveLength(3);
    await runCheckAndSave({ intakeId, queries });
    expect(run.mock.calls[0][0]).toMatchObject([{ role: "CLIENT_PARTY", idNumber: "TEST-CODE" }, { role: "CO_LITIGANT" }, { role: "THIRD_PARTY", idNumber: "TEST-ID" }]);
    expect(create.mock.calls[0][0].data.queryPayload.queries.map((q: { role: string }) => q.role)).toEqual(["CLIENT_PARTY", "CO_LITIGANT", "THIRD_PARTY"]);
  });
  it("独立快捷检索仍允许只输入名称", async () => {
    await expect(runCheckAndSave({ queries: [{ name: "测试公司" }] })).resolves.toMatchObject({ ok: true });
  });
  it("工作区预检不出结论：未命中也保持待定，不自动记为可承办", async () => {
    await runCheckAndSave({ queries: [{ name: "测试公司" }] });
    expect(create.mock.calls[0][0].data).toMatchObject({ conclusion: "PENDING", decidedById: null, note: null });
    expect(run.mock.calls[0][1]).toMatchObject({ excludeIntakeId: undefined });
  });
  it("收案正式检索未命中仍自动给出未命中结论，并排除收案自身", async () => {
    await runCheckAndSave({ intakeId, queries: [{ role: "OPPOSING_PARTY", name: "测试公司" }] });
    expect(create.mock.calls[0][0].data.conclusion).toBe("DIFFERENT");
    expect(run.mock.calls[0][1]).toMatchObject({ excludeIntakeId: intakeId });
  });
  it("预检记录不能设置检索结论", async () => {
    findUnique.mockResolvedValue({ intakeId: null });
    await expect(setConflictConclusion({ checkId: "ccheck00000000000000000001", conclusion: "DIFFERENT" })).rejects.toThrow("冲突预检仅供了解情况");
  });
  it("不可见收案不能挂正式检索：对象级授权先行，不落检索记录", async () => {
    intakeFindFirst.mockResolvedValue(null);
    await expect(runCheckAndSave({ intakeId, queries: [{ role: "OPPOSING_PARTY", name: "测试公司" }] })).rejects.toThrow("收案不存在或无权访问");
    expect(run).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("不可见收案的检索结论不能被改写", async () => {
    findUnique.mockResolvedValue({ intakeId: "cintake000000000000000002" });
    intakeFindFirst.mockResolvedValue(null);
    await expect(setConflictConclusion({ checkId: "ccheck00000000000000000001", conclusion: "DIFFERENT" })).rejects.toThrow("收案不存在或无权访问");
  });
});
