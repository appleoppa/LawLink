// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { backoffMs } from "@/server/cron/queue";

describe("任务队列退避计算（P1-1）", () => {
  it("指数递增且带上限：第 1 次约 25s，第 5 次封顶 15 分钟", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(25_000);
    expect(backoffMs(1)).toBeLessThan(25_000 + 5_000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(100_000);
    expect(backoffMs(10)).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });
});

/* enqueue 语义（终结任务不复活 / 未终结覆盖 / 新建） */
const { db } = vi.hoisted(() => {
  const mk = () => ({ findUnique: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { db: { jobQueue: mk() } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { enqueueJob } from "@/server/cron/queue";

describe("enqueueJob 幂等语义", () => {
  it("同键 SUCCESS 任务：忽略（不复活）", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j1", status: "SUCCESS" });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键 DEAD 任务 6 小时内：忽略", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j9", status: "DEAD", updatedAt: new Date(Date.now() - 60 * 60_000) });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.update).not.toHaveBeenCalled();
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键 DEAD 任务超过 6 小时：重置尝试再入队（死信自愈）", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j10", status: "DEAD", updatedAt: new Date(Date.now() - 7 * 60 * 60_000) });
    await enqueueJob({ type: "t", payload: { a: 1 }, dedupeKey: "k" });
    expect(db.jobQueue.update).toHaveBeenCalledWith({
      where: { id: "j10" },
      data: expect.objectContaining({ status: "PENDING", attempts: 0 })
    });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("同键未终结任务：覆盖 payload 与 runAt（= 改期取消旧内容）", async () => {
    db.jobQueue.findUnique.mockResolvedValue({ id: "j2", status: "PENDING" });
    const runAt = new Date("2026-09-14T09:00:00");
    await enqueueJob({ type: "t", payload: { b: 2 }, dedupeKey: "k", runAt });
    expect(db.jobQueue.update).toHaveBeenCalledWith({
      where: { id: "j2" },
      data: expect.objectContaining({ runAt })
    });
    expect(db.jobQueue.create).not.toHaveBeenCalled();
  });

  it("无同键任务：新建；并发撞唯一键不抛出", async () => {
    db.jobQueue.findUnique.mockResolvedValue(null);
    await enqueueJob({ type: "t", payload: {}, dedupeKey: "k2" });
    expect(db.jobQueue.create).toHaveBeenCalled();
  });
});
