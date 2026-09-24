// @vitest-environment node
// B3 确认层回归（2026-09-20 第五轮审计 P1-2/P1-3/P2-8 修复的防线）：
// 混批建议拒绝、同批多条开庭建议幂等只建一个、跨批守卫不重复建、
// 全部建议处理完后 ORGANIZED 终态落位。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SmsSuggestion } from "@prisma/client";

const { db, tx, session, filing } = vi.hoisted(() => {
  const tx = {
    smsSuggestion: { findUnique: vi.fn(), update: vi.fn() },
    smsMessage: { findUnique: vi.fn(), update: vi.fn() },
    hearing: { create: vi.fn(), update: vi.fn() },
    deadline: { create: vi.fn() },
    matterProcedure: { findFirst: vi.fn() }
  };
  return {
    tx,
    db: {
      smsSuggestion: { findMany: vi.fn(), count: vi.fn() },
      smsMessage: { updateMany: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
    },
    session: { requireSession: vi.fn() },
    filing: { fileSmsInboundFilesToMatter: vi.fn() }
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: session.requireSession }));
vi.mock("@/lib/permissions", () => ({ assertCanHandleMatter: vi.fn(), assertCanAssociateMatter: vi.fn() }));
vi.mock("@/lib/archive/guard", () => ({ assertMatterWritable: vi.fn(), assertDocumentWritable: vi.fn(), isArchiveFolderName: vi.fn(() => false) }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/matters/route", () => ({ revalidateMatter: vi.fn() }));
vi.mock("@/server/reminders/responsibility", () => ({ responsibilityReady: vi.fn(async () => false) }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("@/server/sms/inbound-filing", () => ({ fileSmsInboundFilesToMatter: filing.fileSmsInboundFilesToMatter }));
vi.mock("@/server/sms/analysis", () => ({ analyzeInboundFile: vi.fn() }));

import { decideSmsSuggestions } from "@/server/sms/confirm-actions";

const SMS = { id: "s1", receivedById: "u1", matchedMatterId: "m1", generatedHearingId: null, generatedDeadlineId: null };

function suggestion(id: string, kind: string, sms = SMS, payload: Record<string, unknown> = {}): SmsSuggestion & { sms: typeof SMS } {
  return {
    id, smsId: sms.id, kind, fieldKey: null, currentValue: null, suggestedValue: null,
    targetId: null, sourcePage: null, sourceExcerpt: null, payload,
    status: "PENDING", fileId: null, decidedById: null, decidedAt: null,
    createdAt: new Date(), sms
  } as unknown as SmsSuggestion & { sms: typeof SMS };
}

beforeEach(() => {
  vi.resetAllMocks();
  session.requireSession.mockResolvedValue({ user: { id: "u1", role: "LAWYER" } });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  tx.smsSuggestion.update.mockResolvedValue({});
  tx.smsSuggestion.findUnique.mockResolvedValue({ status: "PENDING" });
  tx.matterProcedure.findFirst.mockResolvedValue({ id: "p1" });
  tx.hearing.create.mockResolvedValue({ id: "h-new" });
  db.smsSuggestion.count.mockResolvedValue(0);
  db.smsMessage.updateMany.mockResolvedValue({ count: 1 });
  filing.fileSmsInboundFilesToMatter.mockResolvedValue(0);
});

describe("B3 整理建议批量确认", () => {
  it("P1-2：混入不同来件的建议直接拒绝，不做任何写入", async () => {
    const other = { ...SMS, id: "s2", receivedById: "u2" };
    db.smsSuggestion.findMany.mockResolvedValue([
      suggestion("c1aaaaaaaaaaaaaaaaaaa1", "DOC_TYPE", SMS),
      suggestion("c1aaaaaaaaaaaaaaaaaaa2", "DOC_TYPE", other)
    ]);
    await expect(decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1", "c1aaaaaaaaaaaaaaaaaaa2"], decision: "REJECTED" })).rejects.toThrow("一次只能处理同一条来件的建议");
    expect(tx.smsSuggestion.update).not.toHaveBeenCalled();
    expect(db.smsMessage.updateMany).not.toHaveBeenCalled();
  });

  it("P1-3：同批两条开庭建议只建一个开庭（守卫在事务内重读）", async () => {
    db.smsSuggestion.findMany.mockResolvedValue([
      suggestion("c1aaaaaaaaaaaaaaaaaaa1", "HEARING", SMS, { dateText: "2026-10-20", timeText: "09:30", title: "开庭" }),
      suggestion("c1aaaaaaaaaaaaaaaaaaa2", "HEARING", SMS, { dateText: "2026-10-20", timeText: "09:30", title: "开庭" })
    ]);
    // 守卫重读：第一条建议时无开庭；第一条事务内写入后，第二条重读应看到（此处模拟已写入）
    tx.smsMessage.findUnique
      .mockResolvedValueOnce({ matchedMatterId: "m1", generatedHearingId: null })
      .mockResolvedValueOnce({ matchedMatterId: "m1", generatedHearingId: "h-new" });
    await decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1", "c1aaaaaaaaaaaaaaaaaaa2"], decision: "ACCEPTED" });
    expect(tx.hearing.create).toHaveBeenCalledTimes(1);
    expect(tx.smsSuggestion.update).toHaveBeenCalledTimes(2); // 两条都标 ACCEPTED
  });

  it("P1-3：来件已生成过开庭时守卫命中，不再建第二个（跨批幂等）", async () => {
    db.smsSuggestion.findMany.mockResolvedValue([
      suggestion("c1aaaaaaaaaaaaaaaaaaa1", "HEARING", SMS, { dateText: "2026-10-20", timeText: "09:30", title: "开庭" })
    ]);
    tx.smsMessage.findUnique.mockResolvedValue({ matchedMatterId: "m1", generatedHearingId: "h-existing" });
    await decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1"], decision: "ACCEPTED" });
    expect(tx.hearing.create).not.toHaveBeenCalled();
    expect(tx.smsSuggestion.update).toHaveBeenCalledTimes(1);
  });

  it("P2-8：采纳且无剩余待处理建议时推进 ORGANIZED", async () => {
    db.smsSuggestion.findMany.mockResolvedValue([suggestion("c1aaaaaaaaaaaaaaaaaaa1", "DOC_TYPE", SMS)]);
    db.smsSuggestion.count.mockResolvedValue(0);
    await decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1"], decision: "ACCEPTED" });
    expect(db.smsMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { processingState: "ORGANIZED" } })
    );
  });

  it("P2-8 复查补充：全部拒绝不推进 ORGANIZED（文件可能仍未处置，标记会掩盖待确认文件）", async () => {
    db.smsSuggestion.findMany.mockResolvedValue([suggestion("c1aaaaaaaaaaaaaaaaaaa1", "DOC_TYPE", SMS)]);
    db.smsSuggestion.count.mockResolvedValue(0);
    await decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1"], decision: "REJECTED" });
    expect(db.smsMessage.updateMany).not.toHaveBeenCalled();
  });

  it("P2-8：仍有待处理建议时不改状态", async () => {
    db.smsSuggestion.findMany.mockResolvedValue([suggestion("c1aaaaaaaaaaaaaaaaaaa1", "DOC_TYPE", SMS)]);
    db.smsSuggestion.count.mockResolvedValue(2);
    await decideSmsSuggestions({ ids: ["c1aaaaaaaaaaaaaaaaaaa1"], decision: "REJECTED" });
    expect(db.smsMessage.updateMany).not.toHaveBeenCalled();
  });
});
