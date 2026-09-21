// @vitest-environment node
/**
 * 保全提醒登记扫描单测（F-1 阶段一，2026-09-21 改写）。
 *
 * 扫描职责 = 登记 PENDING 台账行（不再直接创建通知）；发送/复核/作废在
 * reminder-delivery.test.ts 覆盖。本文件覆盖：
 * - 档位登记：有效保全负责人停用 → 以案件主办为接收人登记 OFFSET 行；
 * - 无接收人：登记 RECIPIENT_MISSING 行（userId 空串），当日重复登记计 suppressed；
 * - criticalOnly 补扫只登记当日关键档；同键重复登记幂等（P2002 → suppressed）；
 * - 过期翻转：置 EXPIRED + 取消残余 OFFSET PENDING + 登记 EXPIRED/ESCALATION 行。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db, auditMock } = vi.hoisted(() => {
  const db: Record<string, any> = {
    preservationProperty: { findMany: vi.fn(), update: vi.fn() },
    reminderDelivery: { createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    notification: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
    matter: { count: vi.fn() },
    systemSetting: { upsert: vi.fn() },
    jobQueue: {}
  };
  return { db, auditMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/matters/route", () => ({ matterHref: (m: { id: string }) => `/matters/${m.id}` }));
vi.mock("@/server/cron/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/server/settings/webhook-last-result", () => ({ saveWebhookLastResult: vi.fn() }));
vi.mock("@/server/notifications/create", () => ({ createNotification: vi.fn() }));

import { scanPreservationReminders } from "@/server/cron/jobs/scan-due-reminders";

const OWNER = "clawyer0000000000000000001"; // 保全负责人（LAWYER）
const MATTER_OWNER = "clawyer0000000000000000002"; // 案件主办（LAWYER）
const MATTER = "cmatter00000000000000000001";
const PROP = "cprop000000000000000000001";

const recipient = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, active: true, role: "LAWYER", roleDefinition: null, ...overrides
});

const property = (daysUntil: number, ownerOverrides: Record<string, unknown> = {}, matterOwnerOverrides: Record<string, unknown> = {}, status = "ACTIVE") => ({
  id: PROP,
  propertyType: "BANK_DEPOSIT",
  propertyDetail: "某银行账户存款",
  expiryDate: new Date(Date.now() + daysUntil * 86_400_000),
  status,
  target: {
    name: "张三",
    case: {
      remindDays: [30, 15, 7, 3, 1],
      owner: recipient(OWNER, ownerOverrides),
      matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: recipient(MATTER_OWNER, matterOwnerOverrides) }
    }
  }
});

/** 主循环与 lapsed 两次 findMany 用 where 形状区分 */
function setProperties(active: unknown[], lapsed: unknown[] = []) {
  db.preservationProperty.findMany.mockImplementation(async (args: any) =>
    args.where.expiryDate ? lapsed : active
  );
}

const registeredRows: any[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  registeredRows.length = 0;
  db.reminderDelivery.createMany.mockImplementation(async (args: any) => {
    registeredRows.push(args.data[0]);
    return { count: 1 };
  });
  db.reminderDelivery.update.mockResolvedValue({});
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 0 });
  db.preservationProperty.update.mockResolvedValue({});
});

it("保全负责人停用时以案件主办为接收人登记 OFFSET 台账行（不直接发通知）", async () => {
  setProperties([property(7, { active: false })]);

  const result = await scanPreservationReminders();
  expect(result.preservationNotified).toBe(1);
  expect(registeredRows).toHaveLength(1);
  expect(registeredRows[0]).toMatchObject({
    objectType: "PRESERVATION_PROPERTY",
    objectId: PROP,
    kind: "OFFSET",
    offset: 7,
    channel: "IN_APP",
    userId: MATTER_OWNER,
    status: "PENDING"
  });
  expect(db.notification.findFirst).not.toHaveBeenCalled();
});

it("接收人全部失效：登记 RECIPIENT_MISSING 行（userId 空串）；当日重复登记计 suppressed", async () => {
  setProperties([property(7, { active: false }, { active: false })]);

  const first = await scanPreservationReminders();
  expect(first.preservationNotified).toBe(0);
  expect(registeredRows).toHaveLength(1);
  expect(registeredRows[0]).toMatchObject({ kind: "RECIPIENT_MISSING", offset: 0, userId: "", status: "PENDING" });

  // 同键重复：createMany 计数 0（重复登记计 suppressed）
  db.reminderDelivery.createMany.mockResolvedValueOnce({ count: 0 });
  const again = await scanPreservationReminders();
  expect(again.suppressed).toBe(1);
});

it("criticalOnly 补扫只登记当日关键档；全量登记提前档；重复登记幂等", async () => {
  setProperties([property(30)]); // 30 天档

  const caught = await scanPreservationReminders({ criticalOnly: true });
  expect(caught.preservationScanned).toBe(0);
  expect(registeredRows).toHaveLength(0);

  const full = await scanPreservationReminders({ criticalOnly: false });
  expect(full.preservationNotified).toBe(1);
  expect(registeredRows[0]).toMatchObject({ kind: "OFFSET", offset: 30, userId: OWNER });

  db.reminderDelivery.createMany.mockResolvedValueOnce({ count: 0 });
  const again = await scanPreservationReminders({ criticalOnly: false });
  expect(again.suppressed).toBe(1);
  expect(again.preservationNotified).toBe(0);
});

it("过期翻转：置 EXPIRED + 取消残余 OFFSET 登记 + 登记 EXPIRED 与 ESCALATION 行", async () => {
  setProperties([], [property(-2)]); // 已过期 2 天
  db.team.findMany.mockResolvedValue([]);

  const result = await scanPreservationReminders();
  expect(result.preservationExpired).toBe(1);
  expect(db.preservationProperty.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: PROP }, data: { status: "EXPIRED" } })
  );
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "PRESERVATION_STATUS_AUTO_EXPIRED",
    targetId: PROP
  }));
  // 残余 OFFSET PENDING 行取消（防投递已失效档位）
  expect(db.reminderDelivery.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        objectType: "PRESERVATION_PROPERTY",
        objectId: { in: [PROP] },
        status: "PENDING"
      }),
      data: expect.objectContaining({ status: "CANCELLED" })
    })
  );
  // EXPIRED + ESCALATION 各登记一行（受众投递时解析，userId 空串）
  const kinds = registeredRows.map((r) => r.kind).sort();
  expect(kinds).toEqual(["ESCALATION", "EXPIRED"]);
  expect(registeredRows.find((r) => r.kind === "EXPIRED")).toMatchObject({ offset: 2, userId: "" });
  expect(registeredRows.find((r) => r.kind === "ESCALATION")).toMatchObject({ offset: 2, userId: "" });
  expect(result.escalationSent).toBe(1);
});
