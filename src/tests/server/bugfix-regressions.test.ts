// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
const { db, notify, webhook, session, writeFile } = vi.hoisted(() => {
  const tables = ["client", "matter", "matterStage", "task", "timelineEvent", "billing", "feeEntry", "commissionPlan", "deadline", "hearing", "notification", "preservationProperty", "auditLog", "document", "invoiceRequest", "systemSetting", "jobQueue", "payment", "receivable", "team", "user"] as const;
  const methods = ["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "count", "create", "update", "upsert", "createMany", "deleteMany"] as const;
  const models = Object.fromEntries(tables.map(table => [table,
    Object.fromEntries(methods.map(method => [method, vi.fn()]))
  ])) as Record<typeof tables[number], Record<typeof methods[number], ReturnType<typeof vi.fn>>>;
  return { db: { ...models, $transaction: vi.fn() }, notify: vi.fn(), webhook: vi.fn(), writeFile: vi.fn(), session: { user: { id: "clawyer0000000000000000001", role: "LAWYER" } } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(async () => session) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn(), matterHrefById: vi.fn(async () => "/matters/example") }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/server/settings/webhook", () => ({ sendWebhookText: webhook }));
vi.mock("@/server/notifications/approval", () => ({ notifyRoleApprovers: vi.fn() }));
vi.mock("@/lib/approvals/service", () => ({
  requireApprovalRoute: vi.fn(), assertApprovalItem: vi.fn(), canExecuteInvoice: vi.fn(async () => true), approvalAudit: vi.fn(),
  approvalTransaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db))
}));
vi.mock("@/lib/approvals/documents", () => ({ canReadDocument: vi.fn(async () => true) }));
vi.mock("@/lib/storage", () => ({ storage: { writeFile } }));
vi.mock("@/lib/storage/crypto", () => ({ encryptBuffer: vi.fn(() => ({ ciphertext: Buffer.from("mock"), iv: Buffer.from("mock"), authTag: Buffer.from("mock"), algorithm: "mock" })), sha256: vi.fn(() => "mock") }));

import { listClients, getClientById, getClientFinanceSummary } from "@/server/clients/actions";
import { createTask, updateTask } from "@/server/tasks/actions";
import { scanDueReminders } from "@/server/cron/jobs/scan-due-reminders";
import { runAuditCleanup } from "@/server/cron/jobs/audit-cleanup";
import { approveInvoiceRequest, createInvoiceRequest as createLegacyInvoice } from "@/server/invoices/actions";
import { createInvoiceRequest, createFeeEntry, setCommissionPlan } from "@/server/finance/actions";
import { commissionPlanSetSchema } from "@/server/finance/schemas";
import { allocateCommissions } from "@/server/finance/commissions";
import { clientVisibilityFilter, intakeVisibilityFilter, matterReadVisibilityFilter, matterVisibilityFilter } from "@/lib/permissions";

const mine = "cmatter000000000000000001";
const foreign = "cmatter000000000000000002";
const taskId = "ctask0000000000000000001";
const stageId = "cstage000000000000000001";
const user1 = "cuser00000000000000000001";
const user2 = "cuser00000000000000000002";
const invoiceInput = { matterId: mine, amount: 100, invoiceType: "PLAIN" as const, invoiceItem: "LAWYER_FEE" as const, buyerName: "测试客户", evidenceDocIds: ["evidence-example"] };
beforeEach(() => {
  vi.resetAllMocks(); session.user.role = "LAWYER";
  db.matter.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === mine ? { id: mine, status: "ACTIVE" } : null);
  db.matter.findUnique.mockResolvedValue({ id: mine, title: "测试案件", internalCode: "TEST", category: "CIVIL_COMMERCIAL" });
  db.matter.findUniqueOrThrow.mockResolvedValue({ category: "CIVIL_COMMERCIAL" });
  db.task.findUnique.mockResolvedValue({ matterId: mine });
  db.task.create.mockResolvedValue({ id: taskId, title: "测试事项" });
  db.matterStage.findFirst.mockResolvedValue({ id: stageId });
  db.client.findMany.mockResolvedValue([]); db.client.count.mockResolvedValue(0);
  db.client.findFirst.mockResolvedValue({ id: "shared-client" });
  db.billing.findMany.mockResolvedValue([]); db.feeEntry.findMany.mockResolvedValue([]); db.matter.count.mockResolvedValue(0);
  db.deadline.findMany.mockResolvedValue([]); db.hearing.findMany.mockResolvedValue([]);
  db.preservationProperty.findMany.mockResolvedValue([]); db.notification.findFirst.mockResolvedValue(null);
  // v1.x P1 收尾：逾期升级链默认无团队（不触发），专项用例在 reminder-escalation 测试覆盖
  db.team.findMany.mockResolvedValue([]);
  db.jobQueue.findUnique.mockResolvedValue({ id: "jq", status: "SUCCESS" });
  webhook.mockResolvedValue({ ok: true }); db.auditLog.count.mockResolvedValue(12);
  db.invoiceRequest.findUnique.mockResolvedValue({ id: "invoice-example", status: "PENDING", matterId: null, updatedAt: new Date(), evidenceDocIds: [], contractScanId: null, invoiceFileId: null });
  db.invoiceRequest.create.mockResolvedValue({ id: "invoice-example" });
  db.document.create.mockResolvedValue({ id: "invoice-document" }); db.document.findUnique.mockResolvedValue({ id: "evidence-example" });
  writeFile.mockResolvedValue("mock-only-no-file-written");
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("客户查询授权回归", () => {
  it.each([undefined, "Example"])("搜索 %s 保留可见性，列表与总数使用相同条件", async search => {
    await listClients({ search });
    const args = db.client.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([clientVisibilityFilter(session.user.id, "LAWYER")]);
    expect(db.client.count).toHaveBeenCalledWith({ where: args.where });
    if (search) expect(args.where.OR).toHaveLength(4);
    expect(args.include._count.select.matters.where).toEqual({ deletedAt: null, ...matterReadVisibilityFilter(session.user.id, "LAWYER") });
    expect(args.include._count.select.intakes.where).toEqual(intakeVisibilityFilter(session.user.id, "LAWYER"));
  });
  it.each(["LAWYER", "ASSISTANT", "FINANCE"])("共享客户的关联案件仍按正文权限筛选：%s", async role => {
    session.user.role = role; await getClientById("shared-client");
    const args = db.client.findFirst.mock.calls.at(-1)![0];
    expect(args.include.matters.where).toEqual({ deletedAt: null, ...matterReadVisibilityFilter(session.user.id, role) });
  });
  it.each(["LAWYER", "ASSISTANT", "FINANCE"])("共享客户的合同、收款及数量按财务权限筛选：%s", async role => {
    session.user.role = role; await getClientFinanceSummary("shared-client");
    const scope = { primaryClientId: "shared-client", deletedAt: null, ...matterVisibilityFilter(session.user.id, role) };
    expect(db.billing.findMany.mock.calls[0][0].where.matter).toEqual(scope);
    expect(db.feeEntry.findMany.mock.calls[0][0].where.matter).toEqual(scope);
    expect(db.matter.count).toHaveBeenCalledWith({ where: scope });
    expect(JSON.stringify(scope)).not.toContain("team");
  });
  it("无客户访问权时不查询客户财务", async () => {
    db.client.findFirst.mockResolvedValue(null);
    await expect(getClientFinanceSummary("other-client")).rejects.toThrow("客户不存在");
    expect(db.billing.findMany).not.toHaveBeenCalled();
  });
});

describe("事项必须绑定真实案件及阶段", () => {
  it("不能用自己的案件 ID 修改其他案件的事项", async () => {
    db.task.findUnique.mockResolvedValue({ matterId: foreign });
    await expect(updateTask({ id: taskId, matterId: mine, title: "修改", priority: 0 })).rejects.toThrow("不属于当前案件");
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it("输入真实但无权访问的案件也拒绝", async () => {
    db.task.findUnique.mockResolvedValue({ matterId: foreign });
    await expect(updateTask({ id: taskId, matterId: foreign, title: "修改", priority: 0 })).rejects.toThrow("无权关联");
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it("归档案件不可修改事项", async () => {
    db.matter.findFirst.mockResolvedValue({ id: mine, status: "ARCHIVED" });
    await expect(updateTask({ id: taskId, matterId: mine, title: "修改", priority: 0 })).rejects.toThrow("已归档");
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it.each([createTask, updateTask])("创建及修改均拒绝其他案件的阶段", async action => {
    db.matterStage.findFirst.mockResolvedValue(null);
    await expect(action({ id: taskId, matterId: mine, title: "修改", priority: 0, stageId })).rejects.toThrow("阶段不存在");
    expect(db.matterStage.findFirst).toHaveBeenCalledWith({ where: { id: stageId, procedure: { matterId: mine } }, select: { id: true } });
    expect(db.task.create).not.toHaveBeenCalled(); expect(db.task.update).not.toHaveBeenCalled();
  });
  it("同案阶段可以更新，写入条件包含真实案件", async () => {
    await updateTask({ id: taskId, matterId: mine, title: "修改", priority: 0, stageId });
    expect(db.task.update.mock.calls[0][0].where).toEqual({ id: taskId, matterId: mine });
  });
  it("未绑定阶段的事项仍可创建", async () => {
    await expect(createTask({ matterId: mine, title: "新增", priority: 0 })).resolves.toEqual({ ok: true, id: taskId });
    expect(db.matterStage.findFirst).not.toHaveBeenCalled();
  });
});

describe("提醒与审计保留", () => {
  it("提前三天、一天、当天、逾期一天的查询和文案对应，开庭不扫描昨天", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 6, 9));
    const matter = { id: mine, internalCode: "TEST", title: "测试案件", ownerId: session.user.id };
    // 首个 findMany 是 remindDays 并集查询（distinct 调用，无 dueAt 条件），返回默认值 3；
    // 其余按 dueAt 所在天返回该天的期限行。
    db.deadline.findMany.mockImplementation(async (args: { distinct?: string[]; where: { dueAt?: { gte: Date } } }) =>
      args.distinct ? [{ remindDays: 3 }] : [{ id: `d${args.where.dueAt!.gte.getDate()}`, title: "测试期限", dueAt: args.where.dueAt!.gte, remindDays: 3, procedure: { matter } }]);
    db.hearing.findMany.mockImplementation(async ({ where }) => [{ id: `h${where.startsAt.gte.getDate()}`, title: "测试开庭", startsAt: new Date(new Date(where.startsAt.gte).setHours(10, 30)), procedure: { matter } }]);
    await scanDueReminders();
    expect(db.deadline.findMany.mock.calls.map(([args]) => args.where.dueAt?.gte.getDate()).filter(Boolean)).toEqual([9, 7, 6, 5]);
    expect(db.hearing.findMany.mock.calls.map(([args]) => args.where.startsAt.gte.getDate())).toEqual([9, 7, 6]);
    const notifications = notify.mock.calls.map(([args]) => args);
    expect(notifications.filter(n => n.type === "DEADLINE_REMINDER").map(n => [n.title, n.priority])).toEqual([
      ["还有 3 天到期：测试期限", "NORMAL"], ["还有 1 天到期：测试期限", "HIGH"], ["今天到期：测试期限", "HIGH"], ["逾期 1 天：测试期限", "URGENT"]
    ]);
    expect(notifications.filter(n => n.type === "HEARING_REMINDER").map(n => n.title)).toEqual(["3 天后 10:30 开庭：测试开庭", "明天 10:30 开庭：测试开庭", "今天 10:30 开庭：测试开庭"]);
  });
  it("已发送的提醒仍会去重", async () => {
    db.deadline.findMany.mockResolvedValue([{ id: "d", procedure: { matter: { ownerId: session.user.id } } }]);
    db.notification.findFirst.mockResolvedValue({ id: "sent" });
    expect((await scanDueReminders()).suppressed).toBe(4); expect(notify).not.toHaveBeenCalled();
  });
  it.each(["90", "invalid", "-1"])("审计阈值 %s 仅统计，从不物理删除", async days => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", days);
    const result = await runAuditCleanup();
    expect(result).toMatchObject({ deleted: 0, eligibleForArchive: 12, retentionDays: days === "90" ? 90 : 365 });
    expect(db.auditLog.count).toHaveBeenCalledOnce(); expect(db.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe("分成比例及派生金额", () => {
  it.each([[80, 80], [100, 0.01]])("拒绝超额比例 %s + %s", (a, b) => {
    expect(commissionPlanSetSchema.safeParse({ matterId: mine, items: [{ userId: user1, percent: a }, { userId: user2, percent: b }] }).success).toBe(false);
  });
  it("重复受益人和超过两位小数均拒绝", () => {
    expect(commissionPlanSetSchema.safeParse({ matterId: mine, items: [{ userId: user1, percent: 20 }, { userId: user1, percent: 30 }] }).success).toBe(false);
    expect(commissionPlanSetSchema.safeParse({ matterId: mine, items: [{ userId: user1, percent: 33.333 }] }).success).toBe(false);
  });
  it("合计正好 100% 和清空方案均允许", () => {
    expect(commissionPlanSetSchema.safeParse({ matterId: mine, items: [{ userId: user1, percent: 33.33 }, { userId: user2, percent: 66.67 }] }).success).toBe(true);
    expect(commissionPlanSetSchema.safeParse({ matterId: mine, items: [] }).success).toBe(true);
  });
  it("服务端入口拒绝超额方案，不进入替换事务", async () => {
    await expect(setCommissionPlan({ matterId: mine, items: [{ userId: user1, percent: 80 }, { userId: user2, percent: 80 }] })).rejects.toThrow("不得超过");
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.commissionPlan.deleteMany).not.toHaveBeenCalled();
  });
  it("两分钱分给三人时合计仍为两分钱", () => {
    const shares = allocateCommissions(0.02, [33.33, 33.33, 33.34].map((percent, i) => ({ userId: `user${i}`, percent: new Prisma.Decimal(percent) })));
    expect(shares.map(p => p.toNumber())).toEqual([0.01, 0, 0.01]);
    expect(shares.reduce((s, p) => s.plus(p), new Prisma.Decimal(0)).toNumber()).toBe(0.02);
  });
  it("不足百分之百的方案只分配约定份额", () => {
    expect(allocateCommissions(100, [{ userId: user1, percent: new Prisma.Decimal(30) }]).map(p => p.toNumber())).toEqual([30]);
    expect(allocateCommissions(100, [])).toEqual([]);
  });
  it("派生分成同样拒绝历史超额方案", async () => {
    db.commissionPlan.findMany.mockResolvedValue([user1, user2].map(userId => ({ userId, percent: new Prisma.Decimal(80) })));
    db.feeEntry.create.mockResolvedValue({ id: "receipt" });
    await expect(createFeeEntry({ matterId: mine, amount: 100, type: "RECEIVED", occurredAt: new Date() })).rejects.toThrow("分成方案无效");
    expect(db.feeEntry.create.mock.calls.filter(([args]) => args.data.type === "COMMISSION")).toHaveLength(0);
  });
});

describe("开票状态及归档门禁", () => {
  function form(number?: string, upload = true) {
    const fd = new FormData(); fd.set("requestId", "invoice-example");
    if (number !== undefined) fd.set("invoiceNo", number);
    if (upload) fd.set("invoiceFile", new File(["mock pdf"], "invoice.pdf", { type: "application/pdf" }));
    return fd;
  }
  it.each([undefined, "", "  "])("号码 %s 时拒绝开具，且不写附件", async number => {
    await expect(approveInvoiceRequest(form(number))).rejects.toThrow("必须填写发票号码");
    expect(writeFile).not.toHaveBeenCalled(); expect(db.document.create).not.toHaveBeenCalled(); expect(db.invoiceRequest.update).not.toHaveBeenCalled();
  });
  it("附件和号码齐全时记录 ISSUED、修剪后的号码和时间", async () => {
    expect((await approveInvoiceRequest(form(" INV-001 "))).status).toBe("ISSUED");
    expect(db.invoiceRequest.update.mock.calls[0][0].data).toMatchObject({ status: "ISSUED", invoiceNo: "INV-001", issuedAt: expect.any(Date) });
  });
  it("不传发票时只批准，已批准申请须上传发票才能继续", async () => {
    expect((await approveInvoiceRequest(form(undefined, false))).status).toBe("APPROVED");
    expect(db.invoiceRequest.update.mock.calls[0][0].data.issuedAt).toBeUndefined();
    db.invoiceRequest.findUnique.mockResolvedValue({ status: "APPROVED", matterId: mine });
    await expect(approveInvoiceRequest(form(undefined, false))).rejects.toThrow("请上传电子发票");
  });
  it.each(["ISSUED", "REJECTED"])("%s 状态不得再次开具", async status => {
    db.invoiceRequest.findUnique.mockResolvedValue({ status, matterId: mine });
    await expect(approveInvoiceRequest(form("INV"))).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled(); expect(db.invoiceRequest.update).not.toHaveBeenCalled();
  });
  it("新旧入口均阻止归档案件新增开票申请", async () => {
    db.matter.findFirst.mockResolvedValue({ id: mine, status: "ARCHIVED" });
    await expect(createInvoiceRequest(invoiceInput)).rejects.toThrow("已归档");
    await expect(createLegacyInvoice({ matterId: mine, amount: 100 })).rejects.toThrow("已归档");
    expect(db.invoiceRequest.create).not.toHaveBeenCalled();
  });
  it("可写案件的正常开票申请可提交", async () => {
    await expect(createInvoiceRequest(invoiceInput)).resolves.toMatchObject({ id: "invoice-example" });
    expect(db.invoiceRequest.create).toHaveBeenCalledOnce();
  });
  it("无关联案件保留财务授权并要求说明", async () => {
    await expect(createInvoiceRequest({ ...invoiceInput, matterId: null, noMatterReason: "咨询服务" })).rejects.toThrow("仅财务");
    session.user.role = "FINANCE";
    await expect(createInvoiceRequest({ ...invoiceInput, matterId: null })).rejects.toThrow("原因说明");
    await expect(createInvoiceRequest({ ...invoiceInput, matterId: null, noMatterReason: "咨询服务", evidenceDocIds: [] })).resolves.toMatchObject({ id: "invoice-example" });
  });
});
