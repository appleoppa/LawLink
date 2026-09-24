import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { ensureExt } from "@/lib/storage/mime-ext";
import { audit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const f = await prisma.firmFile.findUnique({
    where: { id, archivedAt: null }
  });
  if (!f) return NextResponse.json({ error: "资料不存在" }, { status: 404 });

  let buf: Buffer;
  try {
    buf = await storage.readFile(f.path);
  } catch (err) {
    console.error("[firm-files/download] 读取失败：", err);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }

  const inline = new URL(req.url).searchParams.get("inline") === "1";

  await audit({
    userId: session.user.id,
    action: inline ? "FIRM_FILE_PREVIEW" : "FIRM_FILE_DOWNLOAD",
    targetType: "FirmFile",
    targetId: f.id,
    detail: { name: f.name }
  });

  const filename = ensureExt(f.name, f.mimeType);
  // inline 仅放行浏览器可安全渲染的类型；历史行可能存客户端声明的 text/html /
  // svg（2026-09-19 前上传无校验）——强制 attachment 并降级 octet-stream
  const lower = (f.mimeType ?? "").toLowerCase();
  const inlineSafe =
    lower === "application/pdf" ||
    (lower.startsWith("image/") && lower !== "image/svg+xml") ||
    lower === "text/plain" ||
    lower === "text/markdown" ||
    lower === "text/csv";
  const dangerous = /html|svg|xml|javascript/.test(lower);
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new NextResponse(arr, {
    status: 200,
    headers: {
      "Content-Type": dangerous ? "application/octet-stream" : (f.mimeType ?? "application/octet-stream"),
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `${inline && inlineSafe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // 允许在 iframe 内预览
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60"
    }
  });
}
