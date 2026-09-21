// 内部 helper：仅供 server action 调用，调用方负责 session 与权限校验。
// 不能标 "use server"：这里接受 userId/matterId 参数且不做鉴权，
// 一旦成为 server action 端点会被客户端直接伪造调用。
import type { DocumentCategory, SmsType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { ensureExt } from "@/lib/storage/mime-ext";
import { normalizeUploadedFilename } from "@/lib/filename";
import { assertSafeHttpUrl, safeFetch } from "@/lib/net/safe-url";
import { audit } from "@/server/audit";
import { assertDocumentWritable } from "@/lib/archive/guard";
import { recordTimelineEvent } from "@/server/timeline/record";
import type {
  ParsedSms,
  SmsAttachmentResult,
  SmsDocumentLink
} from "@/lib/sms-parser";
import { ActionError } from "@/lib/action-error";

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
  /** B1：未匹配案件时为 null——文件只入分诊人私有来件暂存（SmsInboundFile），不建正式材料 */
  matterId: string | null;
  procedureId: string | null;
  smsType: SmsType;
};

export async function downloadSmsAttachments({
  smsId,
  userId,
  parsed,
  matterId,
  procedureId,
  actor
}: {
  smsId: string;
  userId: string;
  parsed: ParsedSms;
  /** B1 先取件后匹配：null 时文件入私有暂存，不再要求先关联案件（v3 §4.1） */
  matterId: string | null;
  procedureId?: string | null;
  /** 复查修复 P2-3：cron 队列取件重试无请求上下文，显式传操作人替代 guard 内 requireSession */
  actor?: { id: string; role: string; managerAuthorized?: boolean };
}): Promise<SmsAttachmentResult[]> {
  // 2026-09-20 第五轮审计 P2-2 修复：合伙人粘贴含他人经办案件案号的短信自动取件，
  // 此前被 associate 口径的 guard 拒绝（与外层 handle 断言口径冲突）。
  if (matterId) await assertDocumentWritable(matterId, { kind: "upload", allowPrincipal: true, actor });

  const links = parsed.documentLinks.length > 0
    ? parsed.documentLinks
    : parsed.urls.map((url) => ({
        url,
        platform: null,
        credentials: [],
        requiresLogin: false,
        extractionCodes: []
      }));

  const ctx: DownloadContext = {
    smsId,
    userId,
    matterId,
    procedureId: procedureId ?? null,
    smsType: parsed.smsType
  };
  const results: SmsAttachmentResult[] = [];
  for (const link of links) {
    results.push(...await downloadFromDocumentLink(link, ctx));
  }
  return results;
}

async function downloadFromDocumentLink(
  link: SmsDocumentLink,
  ctx: DownloadContext
): Promise<SmsAttachmentResult[]> {
  try {
    const results = await downloadFromUrl(link.url, ctx, new Set<string>());
    const gotAny = results.some(r => r.status === "DOWNLOADED" || r.status === "ALREADY_DOWNLOADED");
    if (link.requiresLogin && !gotAny) {
      return [{
        url: link.url,
        status: "LOGIN_REQUIRED",
        message: link.extractionCodes.length > 0
          ? "该送达入口可能需要登录或输入提取码，已识别到短信内的验证码/提取码"
          : "该送达入口可能需要网页登录、验证码或专有流程，需人工打开处理",
        checkedAt: new Date().toISOString()
      }];
    }
    return results;
  } catch (err) {
    return [{
      url: link.url,
      status: "FAILED",
      message: err instanceof Error ? err.message : "附件提取失败",
      checkedAt: new Date().toISOString()
    }];
  }
}

async function downloadFromUrl(
  url: string,
  ctx: DownloadContext,
  visited: Set<string>
): Promise<SmsAttachmentResult[]> {
  if (visited.has(url)) {
    return [{
      url,
      status: "FAILED",
      message: "链接跳转循环，已停止",
      checkedAt: new Date().toISOString()
    }];
  }
  visited.add(url);

  const { response, finalUrl } = await fetchWithRedirects(url);
  if (!response.ok) {
    return [{
      url,
      status: "FAILED",
      message: `访问失败：HTTP ${response.status}`,
      checkedAt: new Date().toISOString()
    }];
  }

  const contentType = baseMime(response.headers.get("content-type"));
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentType === "text/html" || finalUrl.toLowerCase().includes(".html")) {
    if (contentLength > MAX_HTML_BYTES) {
      return [{
        url,
        status: "NO_FILE_FOUND",
        message: "送达页面过大，未自动解析页面内附件",
        checkedAt: new Date().toISOString()
      }];
    }
    // 2026-09-20 P3 修复：HTML 分支此前用 response.text() 只查 Content-Length 头，
    // 谎报长度的响应可无界读入内存——改走与附件相同的流式限量读取。
    const htmlBuf = await readBodyWithLimit(response, MAX_HTML_BYTES);
    if (!htmlBuf) {
      return [{
        url,
        status: "NO_FILE_FOUND",
        message: "送达页面实际大小超过上限，未自动解析页面内附件",
        checkedAt: new Date().toISOString()
      }];
    }
    const html = htmlBuf.toString("utf8");
    const allCandidates = extractFileLinksFromHtml(html, finalUrl);
    const candidates = allCandidates.slice(0, MAX_PAGE_FILE_CANDIDATES);
    if (candidates.length) {
      // B1 全量枚举（v3 §2 缺口）：一个送达页可能同时挂受理通知书、传票、举证通知等多份
      // 文书——逐件取件逐件记录，部分失败显示部分完成，不因首个成功而漏掉其余文件。
      // 页面文件总数未知：候选达到 MAX_PAGE_FILE_CANDIDATES 上限时完整性待人工核对。
      const all: SmsAttachmentResult[] = [];
      for (const candidate of candidates) {
        all.push(...await downloadFromUrl(candidate, ctx, visited));
      }
      // v3 §4.3：平台页面文件总数未知——候选达到枚举上限时完整性待人工核对，不能把找到的数量当成全部
      if (allCandidates.length > MAX_PAGE_FILE_CANDIDATES) {
        all.push({
          url,
          status: "NO_FILE_FOUND",
          message: `页面文件候选超过 ${MAX_PAGE_FILE_CANDIDATES} 个（发现 ${allCandidates.length} 个），可能仍有未列出的附件，请人工打开链接核对`,
          checkedAt: new Date().toISOString()
        });
      }
      return all.length > 0 ? all : [{
        url,
        status: "NO_FILE_FOUND",
        message: "页面内未发现可直接下载的文书附件",
        checkedAt: new Date().toISOString()
      }];
    }
    return [{
      url,
      status: htmlLooksLikeLogin(html) ? "LOGIN_REQUIRED" : "NO_FILE_FOUND",
      message: htmlLooksLikeLogin(html)
        ? "页面需要登录、验证码或确认签收，未自动下载"
        : "页面内未发现可直接下载的文书附件",
      checkedAt: new Date().toISOString()
    }];
  }

  if (!isSupportedFile(contentType, finalUrl)) {
    return [{
      url,
      status: "UNSUPPORTED_TYPE",
      message: contentType ? `链接不是支持的文书文件：${contentType}` : "链接不是可识别的文书文件",
      checkedAt: new Date().toISOString()
    }];
  }
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    return [{
      url,
      status: "FAILED",
      message: "附件超过 20MB 限制",
      checkedAt: new Date().toISOString()
    }];
  }

  // v3 §4.3：超时要覆盖响应体——按流读取并在超过上限时立即中止，
  // 不依赖（可被谎报的）Content-Length；上限前完成则正常返回。
  const buffer = await readBodyWithLimit(response, MAX_ATTACHMENT_BYTES);
  if (buffer === null) {
    return [{
      url,
      status: "FAILED",
      message: "附件超过 20MB 限制",
      checkedAt: new Date().toISOString()
    }];
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return [{
      url,
      status: "FAILED",
      message: "附件超过 20MB 限制",
      checkedAt: new Date().toISOString()
    }];
  }
  if (buffer.length === 0) {
    return [{
      url,
      status: "FAILED",
      message: "附件为空",
      checkedAt: new Date().toISOString()
    }];
  }

  const hash = sha256(buffer);
  // B1 先取件后匹配：未匹配案件的文件不入正式材料查重（Document 查重仅对已匹配案），
  // 私有暂存的同内容去重由 SmsInboundFile (smsId, sha256) 唯一约束承担。
  let existing: { id: string; name: string; mimeType: string | null; size: number | null } | null = null;
  if (ctx.matterId) {
    existing = await prisma.document.findFirst({
      where: {
        matterId: ctx.matterId,
        sha256: hash,
        deletedAt: null
      },
      select: { id: true, name: true, mimeType: true, size: true }
    });
  }
  if (existing) {
    await recordInboundFile({
      ctx,
      sourceUrl: url,
      filename: buildAttachmentName(response, finalUrl),
      mimeType: contentType || "application/octet-stream",
      buffer,
      hash,
      documentId: existing.id,
      state: "FILED"
    });
    return [{
      url,
      status: "ALREADY_DOWNLOADED",
      message: "该附件已在本案材料中",
      documentId: existing.id,
      documentName: existing.name,
      mimeType: existing.mimeType,
      size: existing.size ?? undefined,
      checkedAt: new Date().toISOString()
    }];
  }

  const filename = buildAttachmentName(response, finalUrl);
  const mimeType = contentType || "application/octet-stream";
  // 未匹配案件：只入私有来件暂存，待匹配后经「转正」成为正式材料（B1 §2.2）
  if (!ctx.matterId) {
    const inbound = await savePrivateInboundFile({ ctx, sourceUrl: url, buffer, filename, mimeType, hash });
    return [{
      url,
      status: "DOWNLOADED",
      message: inbound.created ? "已存入私有来件区（未匹配案件），匹配案件后转正式材料" : "该文件已在本次来件中",
      documentName: inbound.filename,
      mimeType,
      size: buffer.length,
      checkedAt: new Date().toISOString()
    }];
  }

  const document = await saveAttachmentDocument({
    ctx,
    buffer,
    filename,
    mimeType,
    hash
  });
  await recordInboundFile({ ctx, sourceUrl: url, filename, mimeType, buffer, hash, documentId: document.id, state: "FILED", storageKey: document.path });

  return [{
    url,
    status: "DOWNLOADED",
    message: "已保存为案件材料",
    documentId: document.id,
    documentName: document.name,
    mimeType: document.mimeType,
    size: document.size ?? undefined,
    checkedAt: new Date().toISOString()
  }];
}

/** 流式读取响应体至上限；超限返回 null（调用方按超限处理），下载中断即失败 */
async function readBodyWithLimit(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchWithRedirects(url: string): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const safeUrl = await assertSafeHttpUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await safeFetch(safeUrl.toString(), {
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
  throw new ActionError("链接重定向次数过多");
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
  // 转正路径：未匹配案件的文件走 savePrivateInboundFile，到这里的必有案件归属
  if (!ctx.matterId) throw new ActionError("内部错误：转正路径要求案件归属");
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
    select: { id: true, name: true, mimeType: true, size: true, path: true }
  });

  await recordTimelineEvent(prisma, {
      matterId: ctx.matterId,
      eventType: "DOCUMENT_UPLOADED",
      title: `提取法院短信附件：${filename}`,
      occurredAt: new Date(),
      refType: "Document",
      refId: doc.id
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

/**
 * B1：来件文件记录（SmsInboundFile）。同一来件内同内容幂等——
 * (smsId, sha256) 唯一约束 + skipDuplicates，队列重试/重复执行不会重复建行
 * （v3 §4.3「去重与幂等由服务端及数据库约束共同保证」）。
 */
async function recordInboundFile(input: {
  ctx: DownloadContext;
  sourceUrl: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  hash: string;
  documentId: string | null;
  state: "PENDING_REVIEW" | "FILED";
  uploadSource?: "LINK_FETCH" | "MANUAL_UPLOAD";
  storageKey?: string;
}): Promise<{ created: boolean }> {
  const res = await prisma.smsInboundFile.createMany({
    data: [{
      smsId: input.ctx.smsId,
      matterId: input.ctx.matterId,
      documentId: input.documentId,
      sourceUrl: input.sourceUrl,
      storageKey: input.storageKey ?? "",
      originalName: input.filename,
      mimeType: input.mimeType,
      size: input.buffer.length,
      sha256: input.hash,
      downloadedById: input.ctx.userId,
      uploadSource: input.uploadSource ?? "LINK_FETCH",
      state: input.state
    }],
    skipDuplicates: true
  });
  return { created: res.count > 0 };
}

/**
 * B1：私有来件暂存（未匹配案件）——文件加密落盘到 storage/sms-inbound/，
 * 只记 SmsInboundFile（PENDING_REVIEW），不建正式 Document；
 * 匹配案件后由 fileSmsInboundToMatter 转正。
 */
async function savePrivateInboundFile(input: {
  ctx: DownloadContext;
  sourceUrl: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  hash: string;
}): Promise<{ created: boolean; filename: string }> {
  // 暂存区明文落盘：storage/ 为本地私有目录（不入 git、下载经鉴权 API），
  // 转正为正式材料时按部署加密策略（STORAGE_ENCRYPTION_KEY）重新加密并保存完整元数据。
  const storageKey = await storage.writeFile("sms-inbound", input.buffer);
  const { created } = await recordInboundFile({
    ctx: input.ctx,
    sourceUrl: input.sourceUrl,
    filename: input.filename,
    mimeType: input.mimeType,
    buffer: input.buffer,
    hash: input.hash,
    documentId: null,
    state: "PENDING_REVIEW",
    storageKey
  });
  if (created) {
    await audit({
      userId: input.ctx.userId,
      action: "SMS_INBOUND_FILE_SAVED",
      targetType: "SmsMessage",
      targetId: input.ctx.smsId,
      detail: { name: input.filename, size: input.buffer.length, sourceUrl: input.sourceUrl, area: "private" }
    });
  }
  return { created, filename: input.filename };
}

function categoryForSmsAttachment(smsType: SmsType, filename: string): DocumentCategory {  if (smsType === "JUDGMENT_NOTICE" || /判决|裁定|裁判|调解书/.test(filename)) return "JUDGMENT";
  if (smsType === "EVIDENCE_SUBMIT" || /证据|材料|举证/.test(filename)) return "EVIDENCE";
  if (/起诉|答辩|上诉|申请书|反诉|代理词|意见/.test(filename)) return "PLEADING";
  if (smsType === "SERVICE_NOTICE" || smsType === "FILING_NOTICE" || smsType === "FEE_NOTICE") return "PROCEDURE";
  return "OTHER";
}
