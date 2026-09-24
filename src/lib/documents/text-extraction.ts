/**
 * 文档抽取文本层（报告 P0-2）。
 *
 * 从 review-document 的内联实现抽出共享：docx（mammoth）、PDF 文本层
 * （unpdf）、纯文本直读。无文本层的扫描件返回 noText——通用卷宗 OCR
 * 属 P1 评估项（现有发票/证件识别不能直接等同），当前标 SKIP。
 * 抽取失败不吞错：调用方按 FAILED 落库（失败页不可隐去）。
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { DocumentOcrStatus, DocumentTextSource } from "@prisma/client";

export interface ExtractedText {
  text: string;
  pageCount: number | null;
  source: DocumentTextSource;
}

export class UnsupportedTextExtraction extends Error {
  constructor(mime: string) {
    super(`暂不支持抽取该类型（${mime || "未知"}）`);
  }
}

export class NoTextLayerError extends Error {
  constructor() {
    super("无可抽取文本（可能是扫描件 PDF / 空文档）");
  }
}

export async function extractDocumentTextLayer(
  buf: Buffer,
  mimeType: string | null
): Promise<ExtractedText> {
  const mt = (mimeType || "").toLowerCase();

  if (mt === "application/pdf" || mt.endsWith("pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    // v1.x：分页抽取，页与页以 \f 分隔——全文命中可换算页码（P0-2 页码定位）
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const merged = pages.map(p => p.trim()).join("\f").replace(/\f+$/, "");
    if (!merged) throw new NoTextLayerError();
    return { text: merged, pageCount: totalPages ?? pages.length, source: "PDF_TEXT" };
  }

  if (
    mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt.endsWith("wordprocessingml.document")
  ) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const text = value.trim();
    if (!text) throw new NoTextLayerError();
    return { text, pageCount: null, source: "DOCX" };
  }

  if (mt.startsWith("text/")) {
    const text = buf.toString("utf8").trim();
    if (!text) throw new NoTextLayerError();
    return { text, pageCount: null, source: "MANUAL" };
  }

  throw new UnsupportedTextExtraction(mimeType ?? "");
}

/** 按抽取结果给出落库的处理状态 */
export function ocrStatusFor(err: unknown): DocumentOcrStatus {
  if (err instanceof NoTextLayerError) return "SKIP"; // 扫描件暂无 OCR，明确跳过
  return "FAILED";
}


/** 命中位置 → 页码（1 起；textContent 以 \f 分页） */
export function pageOfOffset(textContent: string, offset: number): number {
  let page = 1;
  for (let i = 0; i < offset && i < textContent.length; i++) {
    if (textContent.charCodeAt(i) === 12) page++; // \f
  }
  return page;
}
