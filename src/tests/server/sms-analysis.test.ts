// @vitest-environment node
// B2 阅读分析管道回归：AI 未配置降级 NEEDS_OCR（不显示为分析成功）、
// AI 输出结构化落建议、拒绝过的建议不重复弹回。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, ai, ocr } = vi.hoisted(() => ({
  db: {
    smsInboundFile: { findUnique: vi.fn(), update: vi.fn() },
    smsSuggestion: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    matterProcedure: { findFirst: vi.fn(), findMany: vi.fn() }
  },
  ai: { aiChat: vi.fn() },
  ocr: { recognizeText: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai/client", () => ({ aiChat: ai.aiChat, AiNotConfiguredError: class extends Error { constructor() { super("AI 未配置，请先到 管理后台 → AI 与元典 填写 API key"); this.name = "AiNotConfiguredError"; } } }));
vi.mock("@/server/ocr/provider", () => ({ recognizeText: ocr.recognizeText, OcrNotConfiguredError: class extends Error { constructor(m: string) { super(m); this.name = "OcrNotConfiguredError"; } } }));
vi.mock("@/lib/storage", () => ({ storage: { readFile: vi.fn(async () => Buffer.from("第1页内容\f第2页内容")), writeFile: vi.fn(async () => "k") } }));
vi.mock("@/lib/documents/text-extraction", () => ({
  extractDocumentTextLayer: vi.fn(async () => ({ text: "第1页内容\f第2页内容", pageCount: 2, source: "PDF_TEXT" })),
  NoTextLayerError: class extends Error {},
  UnsupportedTextExtraction: class extends Error {}
}));

import { analyzeInboundFile, analyzeDocumentText } from "@/server/sms/analysis";
import { AiNotConfiguredError } from "@/lib/ai/client";

const FILE = { id: "f1", smsId: "s1", storageKey: "k", mimeType: "application/pdf", displayName: null, originalName: "传票.pdf", downloadedById: "u1", state: "FILED", sms: { id: "s1", matchedMatterId: null, smsType: "HEARING_NOTICE", parsedJson: {} } };

beforeEach(() => {
  vi.resetAllMocks();
  db.smsInboundFile.findUnique.mockResolvedValue(FILE);
  db.smsInboundFile.update.mockResolvedValue({});
  db.smsSuggestion.findFirst.mockResolvedValue(null);
  db.smsSuggestion.create.mockResolvedValue({});
  db.matterProcedure.findFirst.mockResolvedValue(null);
  global.fetch = vi.fn();
});

describe("B2 阅读分析管道", () => {
  it("AI 未配置时文件降级 NEEDS_OCR，不显示为分析成功", async () => {
    ai.aiChat.mockRejectedValue(new AiNotConfiguredError());
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("NEEDS_OCR");
    const update = db.smsInboundFile.update.mock.calls.at(-1)![0]; // 末笔为终态写入（首笔是 ANALYZING 占位）
    expect(update.data.analysisState).toBe("NEEDS_OCR");
    expect(update.data.analysisError).toContain("AI 未配置");
  });

  it("AI 结构化输出落建议：文书分类 + 未匹配案号提出归属 + 开庭/期限事项", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({
      docType: "传票", suggestedName: "传票-张三案.pdf",
      fields: [{ key: "caseNumber", value: "（2026）沪01民初1号", page: 1, excerpt: "案号（2026）沪01民初1号" }],
      events: [
        { kind: "HEARING", title: "开庭", dateText: "2026-10-20", timeText: "09:30" },
        { kind: "DEADLINE", title: "举证期限", dateText: "2026-10-10" }
      ],
      caseNumbers: ["（2026）沪01民初1号"], court: "上海市第一中级人民法院"
    }) });
    db.matterProcedure.findFirst.mockResolvedValue({ id: "p1", matterId: "m1", matter: { internalCode: "A-1", title: "张三案" } });
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("ANALYZED");
    expect(res.suggestionCount).toBe(4); // DOC_TYPE + MATTER_MATCH + HEARING + DEADLINE（未匹配案件无 FIELD_CHANGE 可比）
    const kinds = db.smsSuggestion.create.mock.calls.map(c => c[0].data.kind);
    expect(kinds).toContain("MATTER_MATCH");
    expect(kinds).toContain("HEARING");
    expect(kinds).toContain("DEADLINE");
  });

  it("拒绝过/已存在的同内容建议不重复创建", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({ docType: "传票", fields: [], events: [{ kind: "HEARING", title: "开庭", dateText: "2026-10-20" }], caseNumbers: [] }) });
    db.smsSuggestion.findFirst.mockResolvedValue({ id: "old", status: "REJECTED" });
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("ANALYZED");
    expect(db.smsSuggestion.create).not.toHaveBeenCalled();
  });

  it("AI 输出垃圾文本时标 FAILED 并保留错误信息", async () => {
    ai.aiChat.mockResolvedValue({ content: "这不是 JSON" });
    const res = await analyzeInboundFile("f1");
    expect(res.state).toBe("FAILED");
  });

  it("analyzeDocumentText 拒绝编造：无日期事件被过滤", async () => {
    ai.aiChat.mockResolvedValue({ content: JSON.stringify({ docType: "其他", fields: [], events: [{ kind: "HEARING", title: "无日期开庭", dateText: "" }], caseNumbers: [] }) });
    const doc = await analyzeDocumentText("文本");
    expect(doc.events).toHaveLength(0);
  });
});
