import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { verifyCheckoutToken } from "@/lib/desktop/checkout-token";
import { resolveRoleUser } from "@/lib/roles/service";
import { canReadDocument } from "@/lib/approvals/documents";
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
    select: { active: true, role: true }
  });
  if (!user?.active) return NextResponse.json({ error: "账号已停用" }, { status: 403 });
  // 令牌有效期内角色可能被停用（停用即暂停业务访问），取件前复核，口径与日历令牌路由一致
  if (!(await resolveRoleUser(payload.userId, user.role)).enabled) {
    return NextResponse.json({ error: "账号所在角色已停用" }, { status: 403 });
  }

  const doc = await prisma.document.findFirst({
    where: { id: payload.docId, deletedAt: null },
    select: { id: true, name: true, path: true, encrypted: true, iv: true, authTag: true, mimeType: true, isLatest: true, version: true, matterId: true, intakeId: true, uploadedById: true }
  });
  if (!doc) return NextResponse.json({ error: "材料不存在" }, { status: 404 });

  // 令牌 15 分钟窗口内可能被移出案件团队：取件时重跑材料读取权（口径与签发口一致）
  if (!(await canReadDocument(payload.userId, doc))) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

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
