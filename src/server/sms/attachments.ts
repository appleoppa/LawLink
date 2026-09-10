// 内部 helper：仅供 server action 调用，调用方负责 session 与权限校验。
// 不能标 "use server"：这里接受 userId/matterId 参数且不做鉴权，
// 一旦成为 server action 端点会被客户端直接伪造调用。
import { lookup } from "node:dns/promises";
import net from "node:net";
import type { DocumentCategory, SmsType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { ensureExt } from "@/lib/storage/mime-ext";
import { normalizeUploadedFilename } from "@/lib/filename";
import { audit } from "@/server/audit";
import { assertDocumentWritable } from "@/lib/archive/guard";
import type {
  ParsedSms,
  SmsAttachmentResult,
  SmsDocumentLink
} from "@/lib/sms-parser";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;
const MAX_PAGE_FILE_CANDIDATES = 5;

const FILE_EXTS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "zip",
  "rar",
  "7z"
] as const;

const FILE_EXT_RE = new RegExp(`\\.(${FILE_EXTS.join("|")})(?:[?#]|$)`, "i");

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/x-7z-compressed": ".7z"
};

type DownloadContext = {
  smsId: string;
  userId: string;
  matterId: string;
  procedureId: string | null;
  smsType: SmsType;
};

export async function downloadSmsAttachments({
  smsId,
  userId,
  parsed,
  matterId,
  procedureId
}: {
  smsId: string;
  userId: string;
  parsed: ParsedSms;
  matterId: string;
  procedureId: string | null;
}): Promise<SmsAttachmentResult[]> {
  await assertDocumentWritable(matterId, { kind: "upload" });

  const links = parsed.documentLinks.length > 0
    ? parsed.documentLinks
    : parsed.urls.map((url) => ({
        url,
        platform: null,
        credentials: [],
        requiresLogin: false,
        extractionCodes: []
      }));

  const results: SmsAttachmentResult[] = [];
  for (const link of links) {
    const result = await downloadFromDocumentLink(link, {
      smsId,
      userId,
      matterId,
      procedureId,
      smsType: parsed.smsType
    });
    results.push(result);
  }
  return results;
}

async function downloadFromDocumentLink(
  link: SmsDocumentLink,
  ctx: DownloadContext
): Promise<SmsAttachmentResult> {
  try {
    const result = await downloadFromUrl(link.url, ctx, new Set<string>());
    if (
      link.requiresLogin &&
      (result.status === "NO_FILE_FOUND" || result.status === "UNSUPPORTED_TYPE")
    ) {
      return {
        url: link.url,
        status: "LOGIN_REQUIRED",
        message: link.extractionCodes.length > 0
          ? "该送达入口可能需要登录或输入提取码，已识别到短信内的验证码/提取码"
          : "该送达入口可能需要网页登录、验证码或专有流程，需人工打开处理",
        checkedAt: new Date().toISOString()
      };
    }
    return result;
  } catch (err) {
    return {
      url: link.url,
      status: "FAILED",
      message: err instanceof Error ? err.message : "附件提取失败",
      checkedAt: new Date().toISOString()
    };
  }
}

async function downloadFromUrl(
  url: string,
  ctx: DownloadContext,
  visited: Set<string>
): Promise<SmsAttachmentResult> {
  if (visited.has(url)) {
    return {
      url,
      status: "FAILED",
      message: "链接跳转循环，已停止",
      checkedAt: new Date().toISOString()
    };
  }
  visited.add(url);

  const { response, finalUrl } = await fetchWithRedirects(url);
  if (!response.ok) {
    return {
      url,
      status: "FAILED",
      message: `访问失败：HTTP ${response.status}`,
      checkedAt: new Date().toISOString()
    };
  }

  const contentType = baseMime(response.headers.get("content-type"));
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentType === "text/html" || finalUrl.toLowerCase().includes(".html")) {
    if (contentLength > MAX_HTML_BYTES) {
      return {
        url,
        status: "NO_FILE_FOUND",
        message: "送达页面过大，未自动解析页面内附件",
        checkedAt: new Date().toISOString()
      };
    }
    const html = await response.text();
    const candidates = extractFileLinksFromHtml(html, finalUrl).slice(0, MAX_PAGE_FILE_CANDIDATES);
    for (const candidate of candidates) {
      const result = await downloadFromUrl(candidate, ctx, visited);
      if (result.status === "DOWNLOADED" || result.status === "ALREADY_DOWNLOADED") {
        return { ...result, url };
      }
    }
    return {
      url,
      status: htmlLooksLikeLogin(html) ? "LOGIN_REQUIRED" : "NO_FILE_FOUND",
      message: htmlLooksLikeLogin(html)
        ? "页面需要登录、验证码或确认签收，未自动下载"
        : "页面内未发现可直接下载的文书附件",
      checkedAt: new Date().toISOString()
    };
  }

  if (!isSupportedFile(contentType, finalUrl)) {
    return {
      url,
      status: "UNSUPPORTED_TYPE",
      message: contentType ? `链接不是支持的文书文件：${contentType}` : "链接不是可识别的文书文件",
      checkedAt: new Date().toISOString()
    };
  }
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    return {
      url,
      status: "FAILED",
      message: "附件超过 20MB 限制",
      checkedAt: new Date().toISOString()
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return {
      url,
      status: "FAILED",
      message: "附件超过 20MB 限制",
      checkedAt: new Date().toISOString()
    };
  }
  if (buffer.length === 0) {
    return {
      url,
      status: "FAILED",
      message: "附件为空",
      checkedAt: new Date().toISOString()
    };
  }

  const hash = sha256(buffer);
  const existing = await prisma.document.findFirst({
    where: {
      matterId: ctx.matterId,
      sha256: hash,
      deletedAt: null
    },
    select: { id: true, name: true, mimeType: true, size: true }
  });
  if (existing) {
    return {
      url,
      status: "ALREADY_DOWNLOADED",
      message: "该附件已在本案材料中",
      documentId: existing.id,
      documentName: existing.name,
      mimeType: existing.mimeType,
      size: existing.size ?? undefined,
      checkedAt: new Date().toISOString()
    };
  }

  const filename = buildAttachmentName(response, finalUrl);
  const document = await saveAttachmentDocument({
    ctx,
    buffer,
    filename,
    mimeType: contentType || "application/octet-stream",
    hash
  });

  return {
    url,
    status: "DOWNLOADED",
    message: "已保存为案件材料",
    documentId: document.id,
    documentName: document.name,
    mimeType: document.mimeType,
    size: document.size ?? undefined,
    checkedAt: new Date().toISOString()
  };
}

async function fetchWithRedirects(url: string): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safeUrl = await assertSafeHttpUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(safeUrl.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "LawLink/1.0 court-sms-attachment-fetcher",
          Accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,application/zip,*/*;q=0.8"
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: safeUrl.toString() };
        current = new URL(location, safeUrl).toString();
        continue;
      }
      return { response, finalUrl: safeUrl.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("链接重定向次数过多");
}

async function assertSafeHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("链接格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 HTTP/HTTPS 链接");
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error("不允许访问本机或内网地址");
  }
  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error("不允许访问本机或内网地址");
  }
  return url;
}

function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map((v) => parseInt(v, 10));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(address)) {
    const low = address.toLowerCase();
    return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80:");
  }
  return true;
}

function extractFileLinksFromHtml(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const attrPattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  for (const m of html.matchAll(attrPattern)) {
    const raw = m[1]?.trim();
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("#")) continue;
    const next = new URL(raw, baseUrl).toString();
    if (FILE_EXT_RE.test(next)) urls.push(next);
  }
  const inlinePattern = /https?:\/\/[^\s"'<>]+/gi;
  for (const m of html.matchAll(inlinePattern)) {
    const raw = m[0]?.trim();
    if (raw && FILE_EXT_RE.test(raw)) urls.push(raw);
  }
  return Array.from(new Set(urls));
}

function htmlLooksLikeLogin(html: string): boolean {
  return /登录|账号|密码|验证码|签收|确认送达|提取码|取件码|人机|captcha/i.test(html);
}

function baseMime(mime: string | null): string | null {
  if (!mime) return null;
  return mime.split(";")[0]?.trim().toLowerCase() || null;
}

function isSupportedFile(mimeType: string | null, url: string): boolean {
  if (mimeType && MIME_EXT[mimeType]) return true;
  if (mimeType?.startsWith("image/")) return true;
  return FILE_EXT_RE.test(url);
}

function buildAttachmentName(response: Response, finalUrl: string): string {
  const dispositionName = filenameFromDisposition(response.headers.get("content-disposition"));
  const urlName = filenameFromUrl(finalUrl);
  const mimeType = baseMime(response.headers.get("content-type"));
  const base = sanitizeFilename(normalizeUploadedFilename(dispositionName || urlName || "法院短信送达文书"));
  const withExt = ensureExt(base, mimeType);
  if (/\.[A-Za-z0-9]{1,5}$/.test(withExt)) return withExt;
  const ext = mimeType ? MIME_EXT[mimeType] : null;
  return `${withExt}${ext ?? ".bin"}`;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return star[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain?.[1]?.trim() ?? null;
}

function filenameFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return name || null;
  } catch {
    return null;
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "法院短信送达文书").slice(0, 120);
}

async function saveAttachmentDocument({
  ctx,
  buffer,
  filename,
  mimeType,
  hash
}: {
  ctx: DownloadContext;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  hash: string;
}) {
  const encrypted = Boolean(process.env.STORAGE_ENCRYPTION_KEY);
  let stored = buffer;
  let iv: string | null = null;
  let authTag: string | null = null;
  let algorithm: string | null = null;
  if (encrypted) {
    const enc = encryptBuffer(buffer);
    stored = enc.ciphertext;
    iv = enc.iv.toString("base64");
    authTag = enc.authTag.toString("base64");
    algorithm = enc.algorithm;
  }

  const path = await storage.writeFile(`m_${ctx.matterId}`, stored);
  const doc = await prisma.document.create({
    data: {
      matterId: ctx.matterId,
      procedureId: ctx.procedureId,
      name: filename,
      category: categoryForSmsAttachment(ctx.smsType, filename),
      path,
      mimeType,
      size: buffer.length,
      sha256: hash,
      encrypted,
      algorithm,
      iv,
      authTag,
      tags: ["法院短信", "电子送达", "自动提取"],
      uploadedById: ctx.userId
    },
    select: { id: true, name: true, mimeType: true, size: true }
  });

  await prisma.timelineEvent.create({
    data: {
      matterId: ctx.matterId,
      eventType: "DOCUMENT_UPLOADED",
      title: `提取法院短信附件：${filename}`,
      occurredAt: new Date(),
      refType: "Document",
      refId: doc.id
    }
  });

  await audit({
    userId: ctx.userId,
    action: "SMS_ATTACHMENT_DOWNLOAD",
    targetType: "Document",
    targetId: doc.id,
    detail: { smsId: ctx.smsId, matterId: ctx.matterId, name: filename, size: buffer.length }
  });

  return doc;
}

function categoryForSmsAttachment(smsType: SmsType, filename: string): DocumentCategory {
  if (smsType === "JUDGMENT_NOTICE" || /判决|裁定|裁判|调解书/.test(filename)) return "JUDGMENT";
  if (smsType === "EVIDENCE_SUBMIT" || /证据|材料|举证/.test(filename)) return "EVIDENCE";
  if (/起诉|答辩|上诉|申请书|反诉|代理词|意见/.test(filename)) return "PLEADING";
  if (smsType === "SERVICE_NOTICE" || smsType === "FILING_NOTICE" || smsType === "FEE_NOTICE") return "PROCEDURE";
  return "OTHER";
}
