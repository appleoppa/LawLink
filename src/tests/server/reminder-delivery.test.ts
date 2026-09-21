// @vitest-environment node
/**
 * 提醒台账投递器单测（F-1 阶段一，2026-09-21）。
 *
 * 覆盖投递器三段职责：
 * - 送达：OFFSET 行复核通过（状态生效/档位一致/接收人未漂移/当日未发过）→ 通知 + 行 SENT；
 * - 作废（复核竞态防线）：到期日漂移 TIER_DRIFT、接收人漂移 RECIPIENT_DRIFT、
 *   对象解除/删除 → SUPERSEDED/CANCELLED，零发送——已失效的提醒不再投出；
 * - EXPIRED / RECIPIENT_MISSING 行的受众实时解析与当日通知去重；
 * - 发送失败：attempts+1 保持 PENDING 重试，超限置 FAILED。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db, notify, auditMock, escalate } = vi.hoisted(() => {
  const db: Record<string, any> = {
    reminderDelivery: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    preservationProperty: { findUnique: vi.fn(), findMany: vi.fn() },
    notification: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
    matter: { count: vi.fn() }
  };
  return { db, notify: vi.fn(), auditMock: vi.fn(), escalate: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/lib/matters/route", () => ({ matterHref: (m: { id: string }) => `/matters/${m.id}` }));
vi.mock("@/server/reminders/escalation", () => ({ escalateOverduePreservationToTeamLeaders: escalate }));

import { deliverPendingReminders, voidPendingPreservation, pickPreservationRecipient } from "@/server/reminders/delivery";

const OWNER = "clawyer0000000000000000001";
const ADMIN = "cadmin00000000000000000001";
const MATTER = "cmatter00000000000000000001";
const PROP = "cprop000000000000000000001";

const prop = (overrides: Record<string, unknown> = {}) => ({
  id: PROP,
  propertyType: "BANK_DEPOSIT",
  propertyDetail: "某银行账户存款",
  expiryDate: new Date(Date.now() + 7 * 86_400_000), // 默认 7 天后到期
  status: "ACTIVE",
  target: {
    name: "张三",
    case: {
      remindDays: [30, 15, 7, 3, 1],
      owner: { id: OWNER, active: true, role: "LAWYER", roleDefinition: null },
      matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: { id: OWNER, active: true, role: "LAWYER", roleDefinition: null } }
    }
  },
  ...overrides
});

const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
  objectType: "PRESERVATION_PROPERTY",
  objectId: PROP,
  kind: "OFFSET",
  offset: 7,
  channel: "IN_APP",
  dayKey: "",
  userId: OWNER,
  attempts: 0,
  ...overrides
});

const updates: any[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  db.notification.findFirst.mockResolvedValue(null);
  notify.mockResolvedValue({});
  db.user.findMany.mockResolvedValue([]);
  escalate.mockResolvedValue([]);
  db.reminderDelivery.update.mockImplementation(async (args: any) => {
    updates.push(args);
    return {};
  });
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 0 });
});

it("OFFSET 行复核通过：发送档位通知并落 SENT", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValue(prop());

  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ processed: 1, sent: 1, voided: 0 });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: OWNER,
    priority: "HIGH", // 7 天档
    refType: "PreservationExpiry:7",
    refId: PROP
  }));
  expect(updates.at(-1)?.data).toMatchObject({ status: "SENT" });
});

it("到期日漂移（登记后改期）：行 SUPERSEDED，零发送——不投已失效提醒", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({ expiryDate: new Date(Date.now() + 20 * 86_400_000) })); // 改到 20 天后，档位漂移

  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ processed: 1, voided: 1, sent: 0 });
  expect(notify).not.toHaveBeenCalled();
  expect(updates.at(-1)?.data).toMatchObject({ status: "SUPERSEDED" });
});

it("接收人漂移（登记后停用）：行 SUPERSEDED，零发送，交下次扫描重登记", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({
    target: {
      name: "张三",
      case: {
        remindDays: [7],
        owner: { id: OWNER, active: false, role: "LAWYER", roleDefinition: null },
        matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: { id: "other", active: true, role: "LAWYER", roleDefinition: null } }
      }
    }
  }));

  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ voided: 1, sent: 0 });
  expect(notify).not.toHaveBeenCalled();
  expect(updates.at(-1)?.data.status).toBe("SUPERSEDED");
});

it("对象已解除（LIFTED）：行 CANCELLED；对象已删除：行 CANCELLED", async () => {
  db.reminderDelivery.findMany.mockResolvedValueOnce([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValueOnce(prop({ status: "LIFTED" }));
  const first = await deliverPendingReminders();
  expect(first).toMatchObject({ voided: 1, sent: 0 });
  expect(updates.at(-1)?.data.status).toBe("CANCELLED");

  db.reminderDelivery.findMany.mockResolvedValueOnce([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValueOnce(null);
  const second = await deliverPendingReminders();
  expect(second).toMatchObject({ voided: 1, sent: 0 });
  expect(notify).not.toHaveBeenCalled();
});

it("EXPIRED 行：状态仍 EXPIRED 时发 URGENT 通知；受众实时解析（负责人停用回退案件主办）", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow({ kind: "EXPIRED", offset: 2, userId: "" })]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({
    status: "EXPIRED",
    expiryDate: new Date(Date.now() - 2 * 86_400_000),
    target: {
      name: "张三",
      case: {
        remindDays: [7],
        owner: { id: OWNER, active: false, role: "LAWYER", roleDefinition: null },
        matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: { id: "matter-owner", active: true, role: "LAWYER", roleDefinition: null } }
      }
    }
  }));

  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ sent: 1 });
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: "matter-owner",
    priority: "URGENT",
    refType: "PreservationExpired"
  }));
});

it("ESCALATION 行：调用团队负责人升级（受众实时解析），行落 SENT", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow({ kind: "ESCALATION", offset: 2, userId: "" })]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({ status: "EXPIRED", expiryDate: new Date(Date.now() - 2 * 86_400_000) }));
  escalate.mockResolvedValue(["SENT"]);

  const result = await deliverPendingReminders();
  expect(escalate).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: OWNER,
    propertyId: PROP,
    daysOverdue: 2
  }));
  expect(result).toMatchObject({ sent: 1 });
  expect(notify).not.toHaveBeenCalled(); // 升级通知由 escalation 模块负责
});

it("RECIPIENT_MISSING 行：接收人已恢复 → SUPERSEDED；仍缺失 → 通知超管兜底", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow({ kind: "RECIPIENT_MISSING", offset: 0, userId: "" })]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({
    target: {
      name: "张三",
      case: {
        remindDays: [7],
        owner: { id: OWNER, active: true, role: "LAWYER", roleDefinition: null },
        matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: { id: OWNER, active: true, role: "LAWYER", roleDefinition: null } }
      }
    }
  }));
  await deliverPendingReminders();
  expect(updates.at(-1)?.data.status).toBe("SUPERSEDED"); // RECIPIENT_RECOVERED

  db.reminderDelivery.findMany.mockResolvedValue([pendingRow({ kind: "RECIPIENT_MISSING", offset: 0, userId: "" })]);
  db.preservationProperty.findUnique.mockResolvedValue(prop({
    target: {
      name: "张三",
      case: {
        remindDays: [7],
        owner: { id: OWNER, active: false, role: "LAWYER", roleDefinition: null },
        matter: { id: MATTER, title: "借款纠纷", internalCode: "M-2026-001", owner: { id: OWNER, active: false, role: "LAWYER", roleDefinition: null } }
      }
    }
  }));
  db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: ADMIN }]);
  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ sent: 1 });
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: ADMIN,
    priority: "URGENT",
    refType: "PreservationRecipientMissing"
  }));
});

it("发送失败：attempts+1 保持 PENDING 重试；当日通知已存在时幂等不重发", async () => {
  db.reminderDelivery.findMany.mockResolvedValue([pendingRow()]);
  db.preservationProperty.findUnique.mockResolvedValue(prop());
  notify.mockRejectedValue(new Error("通知写入失败"));

  const result = await deliverPendingReminders();
  expect(result).toMatchObject({ failed: 1 });
  expect(updates.at(-1)?.data).toMatchObject({ status: "PENDING", attempts: 1, lastError: "通知写入失败" });

  // 当日通知已发过（dup 命中）：直接落 SENT，不再创建
  notify.mockClear();
  db.notification.findFirst.mockResolvedValue({ id: "existing" });
  const dupResult = await deliverPendingReminders();
  expect(dupResult).toMatchObject({ sent: 1 });
  expect(notify).not.toHaveBeenCalled();
});

it("voidPendingPreservation：按对象批量作废 PENDING 行", async () => {
  db.reminderDelivery.updateMany.mockResolvedValue({ count: 2 });
  const n = await voidPendingPreservation(["a", "b"], "SUPERSEDED", "RENEWED");
  expect(n).toBe(2);
  expect(db.reminderDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { objectType: "PRESERVATION_PROPERTY", objectId: { in: ["a", "b"] }, status: "PENDING" },
    data: { status: "SUPERSEDED", detail: { reason: "RENEWED" } }
  }));
});

it("pickPreservationRecipient：负责人有效优先，回退案件主办，全失效为 null", () => {
  const mk = (id: string, active: boolean) => ({ id, active, role: "LAWYER", roleDefinition: null });
  expect(pickPreservationRecipient({ owner: mk("o", true), matter: { id: "m", title: "t", internalCode: "c", owner: mk("x", true) } })?.id).toBe("o");
  expect(pickPreservationRecipient({ owner: mk("o", false), matter: { id: "m", title: "t", internalCode: "c", owner: mk("x", true) } })?.id).toBe("x");
  expect(pickPreservationRecipient({ owner: mk("o", false), matter: null })).toBeNull();
});
