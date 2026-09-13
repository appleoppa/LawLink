// @vitest-environment node
/**
 * 逾期升级链单测（v5 报告 P1 收尾 a 项）。
 *
 * 覆盖：
 * - 送达：主办所在有效团队负责人（有事项访问资格）收到 URGENT 升级通知；
 * - 资格校验分支：负责人无该事项访问资格（matterReadVisibilityFilter 过滤为 0）
 *   → 记审计 SKIP_ESCALATION(reason=NO_MATTER_ACCESS)，不发送；
 * - 负责人账号停用 → SKIP_ESCALATION(reason=LEADER_INACTIVE)；
 * - 负责人即主办本人（SKIP_SELF）、当日去重（SUPPRESSED）、
 * - 未逾期档（offset < 1）不升级、主办不在任何有效团队时为空操作；
 * - 同一负责人挂多个团队只发一条。
 */
import { it, expect, vi, beforeEach } from "vitest";

const { db, notify, auditMock } = vi.hoisted(() => {
  const db: Record<string, any> = {
    team: { findMany: vi.fn() },
    matter: { count: vi.fn() },
    notification: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() }
  };
  return { db, notify: vi.fn(), auditMock: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/server/audit", () => ({ audit: auditMock }));
vi.mock("@/server/notifications/create", () => ({ createNotification: notify }));
vi.mock("@/lib/matters/route", () => ({ matterHref: (m: { id: string }) => `/matters/${m.id}` }));

import { escalateOverdueDeadlineToTeamLeaders } from "@/server/reminders/escalation";

const OWNER = "clawyer0000000000000000001"; // 主办（LAWYER，不在资格判定内）
const LEADER = "cleader00000000000000000001"; // 团队负责人（PRINCIPAL_LAWYER）
const LEADER2 = "cleader00000000000000000002";
const MATTER = "cmatter00000000000000000001";
const DEADLINE = "cidl000000000000000000001";

const base = {
  matterId: MATTER,
  matterTitle: "测试案件",
  internalCode: "M-2026-001",
  ownerId: OWNER,
  deadlineId: DEADLINE,
  deadlineTitle: "举证期限",
  offset: 2,
  todayStart: new Date("2026-09-13T00:00:00")
};

const team = (leaderId: string, role = "PRINCIPAL_LAWYER", active = true) => ({
  id: `cteam0000000000000000000${leaderId.slice(-1)}`,
  name: "团队",
  leader: { id: leaderId, name: "负责人", role, active }
});

beforeEach(() => {
  vi.clearAllMocks();
  db.matter.count.mockResolvedValue(1); // 默认：负责人有访问资格
  db.notification.findFirst.mockResolvedValue(null);
  notify.mockResolvedValue({});
});

it("有资格的团队负责人收到 URGENT 升级通知", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER)]);

  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SENT"]);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    userId: LEADER,
    type: "DEADLINE_REMINDER",
    priority: "URGENT",
    title: "【升级】逾期 2 天：举证期限",
    refType: "DueReminderEscalation:+2:Deadline",
    refId: DEADLINE
  }));
  // 资格校验走 matterReadVisibilityFilter（主任律师 -> 全所，但仍是显式 count 查询）
  expect(db.matter.count).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: MATTER, deletedAt: null })
  }));
  expect(auditMock).not.toHaveBeenCalled();
});

it("负责人无该事项访问资格 → 记 SKIP_ESCALATION 不发送", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER, "LAWYER")]); // 经办律师且非成员/无团队授权
  db.matter.count.mockResolvedValue(0);

  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SKIP_NO_ACCESS"]);
  expect(notify).not.toHaveBeenCalled();
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "SKIP_ESCALATION",
    targetType: "Deadline",
    targetId: DEADLINE,
    detail: expect.objectContaining({ leaderId: LEADER, reason: "NO_MATTER_ACCESS", matterId: MATTER })
  }));
});

it("负责人账号停用 → SKIP_ESCALATION(LEADER_INACTIVE)", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER, "PRINCIPAL_LAWYER", false)]);

  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SKIP_INACTIVE"]);
  expect(notify).not.toHaveBeenCalled();
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
    action: "SKIP_ESCALATION",
    detail: expect.objectContaining({ reason: "LEADER_INACTIVE" })
  }));
});

it("负责人即主办本人 → 跳过（已收原始提醒）", async () => {
  db.team.findMany.mockResolvedValue([team(OWNER)]);
  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SKIP_SELF"]);
  expect(notify).not.toHaveBeenCalled();
});

it("同一负责人挂两个团队只发一条", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER), team(LEADER)]);
  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SENT"]);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("当日已发过 → SUPPRESSED", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER)]);
  db.notification.findFirst.mockResolvedValue({ id: "sent" });
  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SUPPRESSED"]);
  expect(notify).not.toHaveBeenCalled();
});

it("未逾期档（offset < 1）与无有效团队均为空操作", async () => {
  expect(await escalateOverdueDeadlineToTeamLeaders({ ...base, offset: 0 })).toEqual([]);
  db.team.findMany.mockResolvedValue([]);
  expect(await escalateOverdueDeadlineToTeamLeaders(base)).toEqual([]);
  expect(notify).not.toHaveBeenCalled();
  expect(db.matter.count).not.toHaveBeenCalled();
});

it("多团队多负责人逐个判定：一个送达一个无资格", async () => {
  db.team.findMany.mockResolvedValue([team(LEADER), team(LEADER2, "LAWYER")]);
  db.matter.count.mockImplementation(async ({ where }: any) =>
    where.id === MATTER && where.AND ? 1 : 0
  );
  // 简化：按调用次序第一次（LEADER, PRINCIPAL 过滤宽）合格，第二次（LEADER2, LAWYER）不合格
  let call = 0;
  db.matter.count.mockImplementation(async () => (call++ === 0 ? 1 : 0));

  const outcomes = await escalateOverdueDeadlineToTeamLeaders(base);
  expect(outcomes).toEqual(["SENT", "SKIP_NO_ACCESS"]);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0].userId).toBe(LEADER);
});
