import { canReadDocument } from "@/lib/approvals/documents";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { normalizeUploadedFilename } from "@/lib/filename";
import { watermarkPdf, watermarkImage, watermarkLine } from "@/lib/documents/watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // ?inline=1 时以 inline 方式返回，浏览器新标签内预览（PDF/图片/文本），否则下载
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const doc = await prisma.document.findFirst({
    where: { id: (await params).id, deletedAt: null }
  });
  if (!doc) return NextResponse.json({ error: "材料不存在" }, { status: 404 });

  if (!await canReadDocument(session.user.id, doc)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  let buf: Buffer;
  try {
    const stored = await storage.readFile(doc.path);
    if (doc.encrypted) {
      if (!doc.iv || !doc.authTag) {
        return NextResponse.json({ error: "加密元数据损坏" }, { status: 500 });
      }
      buf = decryptBuffer(stored, doc.iv, doc.authTag);
    } else {
      buf = stored;
    }
  } catch (err) {
    console.error("[download] 读取失败：", err);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }

  // v1.x P1 §四 + 收尾：PDF/图像下载加水印衍生副本（原件与校验值不动）。
  // 已签章文件不加改（不破坏签章完整性）；其余类型暂不加水印（审计已含下载人）。
  let outBuf = buf;
  let watermarked = false;
  const lowerMime = (doc.mimeType ?? "").toLowerCase();
  if (lowerMime.includes("pdf") || lowerMime.startsWith("image/")) {
    const sealed = await prisma.sealRequest.findFirst({
      where: { OR: [{ draftDocId: doc.id }, { stampedDocId: doc.id }] },
      select: { id: true }
    });
    if (!sealed) {
      const { getFirmProfile } = await import("@/server/settings/firm-profile");
      let firmName: string | null = null;
      try {
        firmName = (await getFirmProfile()).firmName ?? null;
      } catch {
        firmName = null;
      }
      const line = watermarkLine({ firm: firmName, userName: session.user.name, at: new Date() });
      const marked = lowerMime.includes("pdf")
        ? await watermarkPdf({ buf, text: line })
        : await watermarkImage({ buf, text: line });
      if (marked) {
        outBuf = marked;
        watermarked = true;
      }
    }
  }

  await audit({
    userId: session.user.id,
    action: "DOCUMENT_DOWNLOAD",
    targetType: "Document",
    targetId: doc.id,
    detail: { matterId: doc.matterId, intakeId: doc.intakeId, name: doc.name, watermarked }
  });

  const arrayBuffer = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength) as ArrayBuffer;
  const filename = normalizeUploadedFilename(doc.name);

  // inline 仅放行浏览器可安全渲染的类型（PDF/位图/纯文本）。落库 MIME 已由服务端
  // 按白名单扩展名推导，但历史行可能存有客户端声明的 text/html / svg——一律
  // 强制 attachment 并降级为 octet-stream，杜绝同源脚本执行。
  const lower = (doc.mimeType ?? "").toLowerCase();
  const inlineSafe =
    lower === "application/pdf" ||
    (lower.startsWith("image/") && lower !== "image/svg+xml") ||
    lower === "text/plain" ||
    lower === "text/markdown" ||
    lower === "text/csv";
  const dangerous = /html|svg|xml|javascript/.test(lower);
  const disposition = inline && inlineSafe ? "inline" : "attachment";

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": dangerous ? "application/octet-stream" : (doc.mimeType ?? "application/octet-stream"),
      "Content-Length": String(outBuf.byteLength),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      ...(watermarked ? { "X-Watermarked": "1" } : {})
    }
  });
}
