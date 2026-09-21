// @vitest-environment node
/**
 * 保全续封提醒单测（2026-09-20 第六轮体检 P1-2/P1-3 修复的防线用例）。
 *
 * 覆盖：
 * - 接收人校验：保全负责人停用 → 回退有效案件主办（此前直接投进停用账号）；
 * - 保全负责人与案件主办全部失效 → 不发原始提醒，升级给持「应急接管」资格者，
 *   无资格人则通知在任超管（对齐 recordOffboardingRisk 口径）并记审计；
 *   当日重复扫描不重复升级；
 * - 补扫档位（criticalOnly）：09:00 前仅补当日关键档（到期当天/逾期首日），
 *   提前档（如 30 天档）只在全量扫描触发——档位不再因当日停机永久丢失；
 * - 过期未续封：自动置 EXPIRED + 责任人 URGENT + 团队负责人升级链
 *   （口径与期限逾期升级一致）。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db, notify, auditMock } = vi.hoisted(() => {
  const db: Record<string, any> = {
    preservationProperty: { findMany: vi.fn(), update: vi.fn() },
    notification: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
    matter: { count: vi.fn() },
    systemSetting: { upsert: vi.fn() },
    jobQueue: {}
  };
  return { db, notify: vi.fn(), auditMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/lib/matters/route", () => ({ matterHref: (m: { id: string }) => `/matters/${m.id}` }));
vi.mock("@/server/cron/queue", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/server/settings/webhook-last-result", () => ({ saveWebhookLastResult: vi.fn() }));

import { scanPreservationReminders } from "@/server/cron/jobs/scan-due-reminders";

const OWNER = "clawyer0000000000000000001"; // 保全负责人（LAWYER）
const MATTER_OWNER = "clawyer0000000000000000002"; // 案件主办（LAWYER）
const LEADER = "cleader00000000000000000001"; // 团队负责人（PRINCIPAL_LAWYER）
const ADMIN = "cadmin00000000000000000001"; // 超管
const MATTER = "cmatter00000000000000000001";
const PROP = "cprop000000000000000000001";

const recipient = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, active: true, role: "LAWYER", roleDefinition: null, ...overrides
});

const property = (daysUntil: number, ownerOverrides: Record<string, unknown> = {}, matterOwnerOverrides: Record<string, unknown> = {}) => ({
  id: PROP,
  propertyType: "BANK_DEPOSIT",
  propertyDetail: "某银行账户存款",
  expiryDate: new Date(Date.now() + daysUntil * 86_400_000),
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

beforeEach(() => {
  vi.clearAllMocks();
  db.notification.findFirst.mockResolvedValue(null);
  db.user.findMany.mockResolvedValue([]);
  db.team.findMany.mockResolvedValue([]);
  db.matter.count.mockResolvedValue(1);
  notify.mockResolvedValue({});
  db.preservationProperty.update.mockResolvedValue({});
});

it("保全负责人停用时回退有效案件主办接收提醒", async () => {
  setProperties([property(7, { active: false })]);

  const result = await scanPreservationReminders();
  expect(result.preservationNotified).toBe(1);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: MATTER_OWNER,
    priority: "HIGH", // 7 天档：>3 天非紧急、≤15 天 HIGH
    refType: "PreservationExpiry:7",
    refId: PROP
  }));
});

it("接收人全部失效：不发原始提醒，升级给在任超管并记审计；当日重复扫描不重复升级", async () => {
  setProperties([property(7, { active: false }, { active: false })]);
  // 第一次 findMany（应急接管资格人）为空 → 第二次（超管兜底）返回超管
  db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: ADMIN }]);

  const first = await scanPreservationReminders();
  expect(first.preservationNotified).toBe(0);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: ADMIN,
    priority: "URGENT",
    title: expect.stringContaining("保全提醒无人接收"),
    refType: "PreservationRecipientMissing",
    refId: PROP
  }));
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "PRESERVATION_RECIPIENT_MISSING",
    targetType: "PreservationProperty",
    targetId: PROP
  }));

  // 同日补扫：去重命中，不再查接收人、不再发通知
  db.notification.findFirst.mockResolvedValue({ id: "dup" });
  db.user.findMany.mockClear();
  await scanPreservationReminders();
  expect(db.user.findMany).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledTimes(1);
});

it("criticalOnly 补扫只触发当日关键档，提前档等全量扫描（档位不再因停机永久丢失）", async () => {
  setProperties([property(30)]); // 30 天档

  const caught = await scanPreservationReminders({ criticalOnly: true });
  expect(caught.preservationScanned).toBe(0);
  expect(notify).not.toHaveBeenCalled();

  const full = await scanPreservationReminders({ criticalOnly: false });
  expect(full.preservationNotified).toBe(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: OWNER,
    refType: "PreservationExpiry:30",
    priority: "NORMAL"
  }));

  // 全量送达后当日再补扫：去重幂等
  db.notification.findFirst.mockResolvedValue({ id: "dup" });
  const again = await scanPreservationReminders({ criticalOnly: false });
  expect(again.suppressed).toBe(1);
  expect(again.preservationNotified).toBe(0);
});

it("过期未续封：置 EXPIRED + 责任人 URGENT + 团队负责人升级（口径同期限逾期升级）", async () => {
  setProperties([], [property(-2)]); // 已过期 2 天
  db.team.findMany.mockResolvedValue([{
    id: "cteam00000000000000000001",
    name: "诉讼一部",
    leader: { id: LEADER, name: "负责人", role: "PRINCIPAL_LAWYER", active: true }
  }]);

  const result = await scanPreservationReminders();
  expect(result.preservationExpired).toBe(1);
  expect(db.preservationProperty.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: PROP }, data: { status: "EXPIRED" } })
  );
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "PRESERVATION_STATUS_AUTO_EXPIRED",
    targetId: PROP
  }));

  const calls = notify.mock.calls.map((c) => c[0]);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: OWNER, priority: "URGENT", refType: "PreservationExpired" }),
    expect.objectContaining({
      userId: LEADER,
      priority: "URGENT",
      refType: "PreservationEscalation:+2:PreservationProperty",
      title: expect.stringContaining("【升级】保全已过期 2 天未续封")
    })
  ]));
  expect(result.escalationSent).toBe(1);
});
