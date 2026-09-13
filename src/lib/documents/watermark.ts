/**
 * 下载水印（P1 §四）：PDF 逐页对角线水印的衍生副本生成。
 *
 * 原则：原件与校验值永不改动；水印只作用于下载/预览的响应副本；
 * 已签章文件（SealRequest 关联）不加水印（不破坏签章完整性），调用方跳过。
 * 非法/损坏 PDF 原样返回（水印失败不阻断合法下载，审计仍记录原件哈希）。
 */
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

export interface WatermarkInput {
  buf: Buffer;
  /** 水印行文字，如「立正律师事务所 · 叶森 · 2026-09-13 14:30」 */
  text: string;
}

/** 给 PDF 每页加浅灰对角线水印，返回新副本 Buffer；非 PDF 或失败返回 null */
export async function watermarkPdf({ buf, text }: WatermarkInput): Promise<Buffer | null> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // CJK 字符 Helvetica 无法编码——中文名统一转 ASCII 安全形态（拼音/编号由调用方传入时规避）
    const safeText = text.replace(/[^\x20-\x7E]/g, "?");
    const size = 10;
    const width = font.widthOfTextAtSize(safeText, size);
    const pages = doc.getPages();
    for (const page of pages) {
      const { width: pw, height: ph } = page.getSize();
      page.drawText(safeText, {
        x: Math.max(4, (pw - width) / 2),
        y: 8,
        size,
        font,
        color: rgb(0.55, 0.58, 0.6),
        opacity: 0.55
      });
      // 对角线主水印（居中旋转 35°）
      page.drawText(safeText, {
        x: pw / 2 - width / 2,
        y: ph / 2,
        size: size + 4,
        font,
        color: rgb(0.62, 0.65, 0.67),
        opacity: 0.16,
        rotate: degrees(35)
      });
    }
    return Buffer.from(await doc.save());
  } catch {
    return null;
  }
}

/** 水印行文案（页脚用 ASCII 安全；中文场景传英文/编号） */
export function watermarkLine(parts: { firm?: string | null; userName?: string | null; at?: Date }): string {
  const segs = [
    parts.firm?.trim(),
    parts.userName?.trim(),
    parts.at ? parts.at.toISOString().slice(0, 16).replace("T", " ") : undefined
  ].filter(Boolean) as string[];
  return segs.join(" | ");
}
