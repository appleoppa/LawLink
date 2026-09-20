/**
 * 上传文件类型校验
 *
 * 三道闸：
 *   1. 文件名扩展名必须在白名单内（不区分大小写）
 *   2. 落库 MIME 一律由服务端按已校验扩展名推导（EXT_MIME），不信任客户端声明
 *   3. 文件大小 ≤ maxBytes
 *
 * 2026-09-19 审计修复：此前落库 mimeType 直接取 FormData 的 file.type（客户端可
 * 任意声明），配合下载 inline 同源渲染构成存储型 XSS（.txt 扩展 + text/html 声明
 * 即可在同所浏览器执行脚本）。扩展名白名单不含 html/svg，但 MIME 与扩展名不校验
 * 一致性，故改由服务端统一推导——落库值永远与白名单扩展名同族，浏览器不可能把
 * 白名单类型渲染成 HTML。历史已落库的 text/html / svg 行由下载路由的 inline
 * 白名单兜底强制 attachment。
 *
 * 故意不读 magic bytes：sniffing 增加复杂度但绕过门槛只是稍微提高，
 * 投入产出比不高。本系统假设是律所内部使用，主要防止意外（误传 .exe）
 * 而非对抗主动攻击。
 */

export type UploadPurpose = "document" | "invoice" | "seal" | "stamp" | "firmfile";

const DOC_EXT = [
  "pdf",
  "doc", "docx",
  "xls", "xlsx",
  "ppt", "pptx",
  "txt",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff",
  "zip", "rar", "7z",
  "mp3", "wav", "m4a",
  "mp4", "mov", "avi"
];

// 发票 / 用章场景更窄：仅图片或 PDF
const NARROW_EXT = ["pdf", "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff"];

const ALLOWED: Record<UploadPurpose, Set<string>> = {
  document: new Set(DOC_EXT),
  invoice: new Set(NARROW_EXT),
  seal: new Set(DOC_EXT), // 待盖章稿允许 docx/pdf
  stamp: new Set(NARROW_EXT), // 盖章后扫描件只允许图片 / PDF
  firmfile: new Set(DOC_EXT) // 律所公共资料：与案件材料同口径（此前完全无类型校验）
};

// 浏览器会执行内容的类型：无论何种场景，客户端声明为这些类型即直接拒绝
//（落库 MIME 虽由服务端推导，提前拒绝可阻止「白名单扩展名 + 恶意内容」文件入库）
const DANGEROUS_CLIENT_MIME = /(^|\/)(html|xhtml|svg|xml|javascript|ecmascript)(\+xml|$|[;+.])/i;

// 扩展名 → 落库规范 MIME（与浏览器渲染语义一致；不含任何可执行类型）
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo"
};

function getExt(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export interface FileValidationOptions {
  purpose: UploadPurpose;
  maxBytes: number;
}

/**
 * 抛中文异常（前端 toast 直接显示）；通过返回归一化的 ext 与落库用规范 mimeType。
 */
export function validateUploadedFile(
  file: File,
  opts: FileValidationOptions
): { ext: string; mimeType: string } {
  if (file.size === 0) throw new Error("文件为空");
  if (file.size > opts.maxBytes) {
    throw new Error(
      `文件超过 ${Math.round(opts.maxBytes / 1024 / 1024)}MB 限制`
    );
  }
  const ext = getExt(file.name);
  if (!ext) throw new Error(`文件名缺少扩展名：${file.name}`);
  if (!ALLOWED[opts.purpose].has(ext)) {
    throw new Error(
      `不允许的文件类型：.${ext}（${opts.purpose}）`
    );
  }
  if (file.type && DANGEROUS_CLIENT_MIME.test(file.type)) {
    throw new Error(`不允许的文件类型：${file.type}`);
  }
  return { ext, mimeType: EXT_MIME[ext] ?? "application/octet-stream" };
}
