// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { watermarkPdf, watermarkLine } from "@/lib/documents/watermark";

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

describe("下载水印（P1 §四）", () => {
  it("PDF 加水印：副本可解析、与原件字节不同、页数不变", async () => {
    const original = await samplePdf();
    const marked = await watermarkPdf({ buf: original, text: "LawLink | Ye Sen | 2026-09-13 14:30" });
    expect(marked).not.toBeNull();
    expect(marked!.length).toBeGreaterThan(0);
    expect(Buffer.compare(original, marked!)).not.toBe(0);
    const parsed = await PDFDocument.load(marked!);
    expect(parsed.getPageCount()).toBe(2);
  });

  it("非 PDF / 损坏输入返回 null（不抛错，不阻断下载）", async () => {
    expect(await watermarkPdf({ buf: Buffer.from("not a pdf"), text: "x" })).toBeNull();
    expect(await watermarkPdf({ buf: Buffer.from(""), text: "x" })).toBeNull();
  });

  it("中文文案转 ASCII 安全形态（Helvetica 可编码）", async () => {
    const original = await samplePdf();
    const marked = await watermarkPdf({ buf: original, text: "立正律所 · 叶森" });
    expect(marked).not.toBeNull(); // 内部已替换非 ASCII，加载成功
  });

  it("水印行拼装：过滤空段、上海时刻到分钟（2026-09-20 时区收尾）", () => {
    expect(watermarkLine({ firm: "LawLink", userName: "Ye", at: new Date("2026-09-13T06:30:00Z") }))
      .toBe("LawLink | Ye | 2026-09-13 14:30");
    expect(watermarkLine({})).toBe("");
  });
});
