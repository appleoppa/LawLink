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

/**
 * 图像水印（v1.x 收尾：sharp 补齐 image/* 衍生副本）。
 * 与 PDF 同口径：页脚一行 + 对角线主水印；非 ASCII 字符转 "?"（容器内
 * 无中文字体时不至于渲染成豆腐块）；输出保持原格式（JPEG 直出、其余走
 * PNG），质量 90。失败返回 null，下载回退原件（不阻断业务）。
 */
export async function watermarkImage({ buf, text }: WatermarkInput): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    const safe = text.replace(/[^\x20-\x7E]/g, "?");
    const image = sharp(buf, { failOn: "none" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;
    const isJpeg = meta.format === "jpeg";
    const fontSize = Math.max(11, Math.round(meta.width / 90));
    const diagSize = Math.max(28, Math.round(meta.width / 14));
    const diag = safe.length > 24 ? safe.slice(0, 24) + "…" : safe;
    const footer = `<text x="50%" y="${meta.height - Math.round(fontSize * 0.8)}" font-size="${fontSize}" fill="#8c9496" fill-opacity="0.6" text-anchor="middle" font-family="sans-serif">${escapeXml(safe)}</text>`;
    const diagonal = `<text x="50%" y="50%" font-size="${diagSize}" fill="#8c9496" fill-opacity="0.13" text-anchor="middle" font-family="sans-serif" transform="rotate(-35 ${meta.width / 2} ${meta.height / 2})">${escapeXml(diag)}</text>`;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${diagonal}${footer}</svg>`);
    const marked = image.composite([{ input: svg, blend: "over" }]);
    if (isJpeg) {
      return await marked.jpeg({ quality: 90 }).toBuffer();
    }
    return await marked.png().toBuffer();
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
