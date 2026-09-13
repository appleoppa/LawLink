import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { verifyCheckoutToken } from "@/lib/desktop/checkout-token";
import { audit } from "@/server/audit";

/**
 * 连接器凭 checkout 令牌拉取原件（编辑用副本，不加下载水印；
 * 令牌短时且签发即审计——取件行为本身全程留痕）。
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "缺少令牌" }, { status: 400 });

  const payload = verifyCheckoutToken(token);
  if (!payload) return NextResponse.json({ error: "令牌无效或已过期" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { active: true }
  });
  if (!user?.active) return NextResponse.json({ error: "账号已停用" }, { status: 403 });

  const doc = await prisma.document.findFirst({
    where: { id: payload.docId, deletedAt: null },
    select: { id: true, name: true, path: true, encrypted: true, iv: true, authTag: true, mimeType: true, isLatest: true, version: true }
  });
  if (!doc) return NextResponse.json({ error: "材料不存在" }, { status: 404 });

  let buf: Buffer;
  try {
    const stored = await storage.readFile(doc.path);
    buf = doc.encrypted && doc.iv && doc.authTag ? decryptBuffer(stored, doc.iv, doc.authTag) : stored;
  } catch {
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }

  await audit({
    userId: payload.userId,
    action: "DESKTOP_FILE_FETCH",
    targetType: "Document",
    targetId: doc.id,
    detail: { jti: payload.jti, baselineVersion: payload.baselineVersion, currentVersion: doc.version }
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "Cache-Control": "no-store"
    }
  });
}
