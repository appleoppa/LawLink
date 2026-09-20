/**
 * B2 来件阅读与建议（docs/SYSTEM-AUDIT-REMEDIATION-V3-20260920.md §5）：
 * 文件类型核验 → 文本层提取 → 无文本层时 OCR → AI 结构化分析 → 与档案比对 → 形成建议。
 *
 * 处理顺序与降级（v3 §5.1/验收 9）：AI/OCR 未配置时保存、取件与人工确认照常，
 * 文件标 NEEDS_OCR/FAILED 可见，不显示为分析成功；AI 只产出建议，不直接写案件。
 * 建议「拒绝过的重跑不重复弹回，除非来源变化」——按 (fileId, kind, fieldKey, suggestedValue)
 * 去重并保留 REJECTED 历史。
 */
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { aiChat } from "@/lib/ai/client";
import { extractDocumentTextLayer, NoTextLayerError, UnsupportedTextExtraction } from "@/lib/documents/text-extraction";
import { recognizeText, OcrNotConfiguredError } from "@/server/ocr/provider";
import type { SmsSuggestionKind } from "@prisma/client";

const MAX_ANALYSIS_TEXT_CHARS = 12_000;

interface AnalyzedDoc {
  docType: string;
  suggestedName: string | null;
  fields: { key: string; value: string; page?: number; excerpt?: string }[];
  events: { kind: "HEARING" | "DEADLINE"; title: string; dateText: string; timeText?: string; note?: string }[];
  caseNumbers: string[];
  court: string | null;
}

/** 文本 → AI 结构化分析（纯函数化出口便于测试；AI 未配置抛 AiNotConfiguredError） */
export async function analyzeDocumentText(text: string, hint?: string): Promise<AnalyzedDoc> {
  const clipped = text.slice(0, MAX_ANALYSIS_TEXT_CHARS);
  const result = await aiChat({
    messages: [
      {
        role: "system",
        content:
          "你是法院文书结构化助手。只输出一个 JSON 对象，不要输出任何其他文字。字段：docType（文书类型，如 受理通知书/传票/举证通知书/缴费通知书/判决书/裁定书/送达回证/其他）、suggestedName（规范文件名或 null）、fields（数组，每项 {key,value,page,excerpt}，key 限 caseNumber/courtName/acceptedAt/judgeName/clerkPhone/courtRoom）、events（数组，每项 {kind:HEADING|DEADLINE 修正为 HEARING|DEADLINE,title,dateText,timeText,note}，仅来自文书的明确安排）、caseNumbers（文书中出现的全部案号）、court（法院名称或 null）。dateText 用 YYYY-MM-DD；无把握的值不要编造，省略该字段。kind 只能是 HEARING 或 DEADLINE。"
      },
      { role: "user", content: `文书文本（\\f 分页，页码按出现顺序递增）：\n${clipped}${hint ? `\n\n上下文提示：${hint}` : ""}` }
    ],
    logAction: "sms-doc-analysis"
  });
  const json = extractJson(result.content);
  return normalizeAnalyzed(json);
}

function extractJson(content: string): Record<string, unknown> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 输出不含 JSON");
  try {
    return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("AI 输出 JSON 解析失败");
  }
}

function normalizeAnalyzed(raw: Record<string, unknown>): AnalyzedDoc {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const fields = Array.isArray(raw.fields)
    ? (raw.fields as Record<string, unknown>[]).map(f => ({
        key: str(f.key) ?? "",
        value: str(f.value) ?? "",
        page: typeof f.page === "number" ? f.page : undefined,
        excerpt: str(f.excerpt) ?? undefined
      })).filter(f => f.key && f.value)
    : [];
  const events = Array.isArray(raw.events)
    ? (raw.events as Record<string, unknown>[]).map(e => ({
        kind: e.kind === "HEARING" ? "HEARING" as const : "DEADLINE" as const,
        title: str(e.title) ?? "法院文书事项",
        dateText: str(e.dateText) ?? "",
        timeText: str(e.timeText) ?? undefined,
        note: str(e.note) ?? undefined
      })).filter(e => e.dateText)
    : [];
  return {
    docType: str(raw.docType) ?? "其他",
    suggestedName: str(raw.suggestedName),
    fields,
    events,
    caseNumbers: Array.isArray(raw.caseNumbers) ? (raw.caseNumbers as unknown[]).map(v => str(v)).filter((v): v is string => Boolean(v)) : [],
    court: str(raw.court)
  };
}

/**
 * 分析一个来件文件并落建议（幂等入口：每个文件可重复分析，建议按内容去重）。
 * 返回分析状态；不抛中断性错误——全部失败形态落 analysisState。
 */
export async function analyzeInboundFile(fileId: string): Promise<{ state: string; suggestionCount: number }> {
  const file = await prisma.smsInboundFile.findUnique({
    where: { id: fileId },
    include: { sms: { select: { id: true, matchedMatterId: true, smsType: true, parsedJson: true } } }
  });
  if (!file) throw new Error("来件文件不存在");

  await prisma.smsInboundFile.update({ where: { id: fileId }, data: { analysisState: "ANALYZING", analysisError: null } });
  try {
    const buffer = await storage.readFile(file.storageKey);
    let text: string;
    let pageCount: number | null = null;
    try {
      const extracted = await extractDocumentTextLayer(buffer, file.mimeType);
      text = extracted.text;
      pageCount = extracted.pageCount;
    } catch (err) {
      if (err instanceof NoTextLayerError) {
        const ocr = await recognizeText({ data: buffer, mimeType: file.mimeType, hint: file.displayName ?? file.originalName });
        text = ocr.text;
      } else if (err instanceof UnsupportedTextExtraction) {
        // 图片等非文档类型直接走 OCR
        const ocr = await recognizeText({ data: buffer, mimeType: file.mimeType, hint: file.displayName ?? file.originalName });
        text = ocr.text;
      } else {
        throw err;
      }
    }
    if (!text.trim()) throw new Error("未取得可分析文本");

    const analyzed = await analyzeDocumentText(text, `来源：法院短信来件（${file.sms.smsType}）`);
    const pageCountFinal = pageCount ?? countPages(text);

    await prisma.smsInboundFile.update({
      where: { id: fileId },
      data: { analysisState: "ANALYZED", analyzedAt: new Date(), docType: analyzed.docType, displayName: file.displayName ?? analyzed.suggestedName ?? undefined, extractedPages: pageCountFinal }
    });

    // 建议落库：DOC_TYPE + FIELD_CHANGE（有匹配案件才有「原值→建议值」可比）+ HEARING/DEADLINE
    const created = await persistSuggestions(file.smsId, fileId, file.sms.matchedMatterId, analyzed, file.downloadedById);
    return { state: "ANALYZED", suggestionCount: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败";
    const state = err instanceof OcrNotConfiguredError ? "NEEDS_OCR" : "FAILED";
    await prisma.smsInboundFile.update({ where: { id: fileId }, data: { analysisState: state, analysisError: message } });
    return { state, suggestionCount: 0 };
  }
}

function countPages(text: string): number {
  return text.split("\f").filter(p => p.trim()).length || 1;
}

async function persistSuggestions(
  smsId: string,
  fileId: string,
  matchedMatterId: string | null,
  analyzed: AnalyzedDoc,
  createdById: string
): Promise<number> {
  const rows: {
    smsId: string; fileId: string; kind: SmsSuggestionKind; targetType?: string; targetId?: string;
    fieldKey?: string; currentValue?: string; suggestedValue?: string; sourcePage?: number; sourceExcerpt?: string;
    payload?: object;
  }[] = [{ smsId, fileId, kind: "DOC_TYPE", suggestedValue: analyzed.docType, payload: { suggestedName: analyzed.suggestedName, caseNumbers: analyzed.caseNumbers, court: analyzed.court } }];

  // 案件匹配建议：文书案号与已有归属不一致/未匹配时提出（不自动选首条）
  if (!matchedMatterId && analyzed.caseNumbers.length) {
    const proc = await prisma.matterProcedure.findFirst({
      where: { caseNumber: { in: analyzed.caseNumbers }, matter: { deletedAt: null } },
      select: { id: true, matterId: true, matter: { select: { internalCode: true, title: true } } }
    });
    if (proc) {
      rows.push({ smsId, fileId, kind: "MATTER_MATCH", targetId: proc.matterId, suggestedValue: `${proc.matter.internalCode} · ${proc.matter.title}`, sourceExcerpt: analyzed.caseNumbers.join("、"), payload: { caseNumbers: analyzed.caseNumbers } });
    }
  }

  // 字段修正：与已匹配案件的程序比对（原值→建议值）
  if (matchedMatterId) {
    const procedures = await prisma.matterProcedure.findMany({
      where: { matterId: matchedMatterId },
      orderBy: { order: "asc" },
      select: { id: true, caseNumber: true, handlingAgency: true, type: true, procedureParties: { select: { party: { select: { name: true } } } } }
    });
    const primary = procedures[0];
    if (primary) {
      for (const f of analyzed.fields) {
        if (f.key === "caseNumber") {
          if (f.value && (!primary.caseNumber || primary.caseNumber !== f.value)) {
            rows.push({ smsId, fileId, kind: "FIELD_CHANGE", targetType: "MatterProcedure", targetId: primary.id, fieldKey: "caseNumber", currentValue: primary.caseNumber ?? "", suggestedValue: f.value, sourcePage: f.page, sourceExcerpt: f.excerpt });
          }
        } else if (f.key === "courtName") {
          if (f.value && (!primary.handlingAgency || !primary.handlingAgency.includes(f.value))) {
            rows.push({ smsId, fileId, kind: "FIELD_CHANGE", targetType: "MatterProcedure", targetId: primary.id, fieldKey: "handlingAgency", currentValue: primary.handlingAgency ?? "", suggestedValue: f.value, sourcePage: f.page, sourceExcerpt: f.excerpt });
          }
        }
      }
    }
  }

  // 事项建议：开庭/期限（确认后建立；缴费通知建待办不自动记支付——v3 §5.3）
  for (const e of analyzed.events) {
    rows.push({
      smsId, fileId, kind: e.kind === "HEARING" ? "HEARING" : "DEADLINE",
      suggestedValue: `${e.title} ${e.dateText}${e.timeText ? ` ${e.timeText}` : ""}`,
      sourceExcerpt: e.note,
      payload: { title: e.title, dateText: e.dateText, timeText: e.timeText, note: e.note }
    });
  }

  // 去重：REJECTED 的建议不重复弹回，除非建议值变化（v3 §5.2）
  let created = 0;
  for (const row of rows) {
    const dup = await prisma.smsSuggestion.findFirst({
      where: { smsId, fileId, kind: row.kind, fieldKey: row.fieldKey ?? null, suggestedValue: row.suggestedValue ?? "" },
      select: { id: true, status: true }
    });
    if (dup) continue;
    await prisma.smsSuggestion.create({
      data: {
        smsId: row.smsId, fileId: row.fileId, kind: row.kind,
        targetType: row.targetType ?? null, targetId: row.targetId ?? null,
        fieldKey: row.fieldKey ?? null, currentValue: row.currentValue ?? null,
        suggestedValue: row.suggestedValue ?? null,
        sourcePage: row.sourcePage ?? null, sourceExcerpt: row.sourceExcerpt ?? null,
        payload: (row.payload ?? {}) as object, createdById
      }
    });
    created++;
  }
  return created;
}
