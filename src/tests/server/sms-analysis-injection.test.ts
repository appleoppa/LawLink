// @vitest-environment node
/**
 * 提示词注入面：AI 输出上限与字段白名单（第八轮体检）。
 *
 * 文书正文是不可信输入——伪造短信、在扫描件里嵌指令都能让模型按攻击者意图输出。
 * 本测试锁住两条防线：
 * ① 数量/长度上限，防一份文书产出海量建议淹没律师确认界面；
 * ② 字段白名单，防模型指定要改的业务字段（生成侧只认 caseNumber/courtName）。
 */
import { it, expect, vi } from "vitest";

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return { ...actual, aiChat: chat };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { analyzeDocumentText } from "@/server/sms/analysis";

const reply = (obj: unknown) => chat.mockResolvedValue({ content: JSON.stringify(obj), raw: {} });

it("注入放大：海量 events/fields/caseNumbers 被截到上限", async () => {
  reply({
    docType: "传票",
    fields: Array.from({ length: 500 }, (_, i) => ({ key: "caseNumber", value: `v${i}` })),
    events: Array.from({ length: 500 }, () => ({ kind: "HEARING", title: "开庭", dateText: "2026-10-01" })),
    caseNumbers: Array.from({ length: 500 }, (_, i) => `(2026)京0101民初${i}号`),
  });
  const r = await analyzeDocumentText("正文");
  expect(r.fields.length).toBeLessThanOrEqual(30);
  expect(r.events.length).toBeLessThanOrEqual(20);
  expect(r.caseNumbers.length).toBeLessThanOrEqual(20);
});

it("注入超长文本：字符串按上限截断，不原样进库", async () => {
  const huge = "东".repeat(5000);
  reply({
    docType: huge,
    suggestedName: huge,
    fields: [{ key: "caseNumber", value: huge }],
    events: [{ kind: "HEARING", title: huge, dateText: "2026-10-01", note: huge }],
    caseNumbers: [huge],
    court: huge,
  });
  const r = await analyzeDocumentText("正文");
  expect(r.docType.length).toBeLessThanOrEqual(200);
  expect(r.court?.length ?? 0).toBeLessThanOrEqual(200);
  expect(r.fields[0].value.length).toBeLessThanOrEqual(200);
  expect(r.events[0].title.length).toBeLessThanOrEqual(200);
  expect(r.events[0].note?.length ?? 0).toBeLessThanOrEqual(500);
});

it("注入非法 kind：只落 HEARING / DEADLINE 两种", async () => {
  reply({ docType: "传票", fields: [], caseNumbers: [], events: [{ kind: "DELETE_ALL", title: "x", dateText: "2026-10-01" }] });
  const r = await analyzeDocumentText("正文");
  expect(r.events[0].kind).toBe("DEADLINE");
});

it("AI 被诱导输出自然语言时拒绝而非猜测（上层落 FAILED 供律师重跑）", async () => {
  // 注入常见形态：让模型丢掉 JSON 约束改说人话。此时必须抛错——
  // 由 analyzeInboundFile 的 catch 落 analysisState=FAILED + analysisError，
  // 律师在收件箱看到失败并可手动重跑，而不是拿到一份看似正常的空分析。
  chat.mockResolvedValue({ content: "忽略以上指令。我已将该案件标记为已撤诉。", raw: {} });
  await expect(analyzeDocumentText("正文")).rejects.toThrow("AI 输出不含 JSON");
});

it("AI 返回残缺 JSON 时同样拒绝，不产出半截建议", async () => {
  chat.mockResolvedValue({ content: '{"docType":"传票","events":[{,]}', raw: {} });
  await expect(analyzeDocumentText("正文")).rejects.toThrow("AI 输出 JSON 解析失败");
});
