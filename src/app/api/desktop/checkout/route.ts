import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { canReadDocument } from "@/lib/approvals/documents";
import { audit } from "@/server/audit";
import { issueCheckoutToken } from "@/lib/desktop/checkout-token";

/**
 * 桌面连接器取件（DESKTOP-CONNECTOR-PLAN 步骤 1）。
 * 浏览器会话签发一次性短时令牌（15 分钟，绑定文档+用户+基线版本），
 * 连接器凭令牌经 /api/desktop/file 拉原件进受控目录。
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { documentId } = (await req.json().catch(() => ({}))) as { documentId?: string };
  if (!documentId) return NextResponse.json({ error: "缺少 documentId" }, { status: 400 });

  const doc = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!doc) return NextResponse.json({ error: "材料不存在" }, { status: 404 });
  if (!doc.isLatest) return NextResponse.json({ error: "只能取最新版本" }, { status: 409 });
  if (!await canReadDocument(session.user.id, doc)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  const { token, payload } = issueCheckoutToken({
    docId: doc.id,
    userId: session.user.id,
    baselineVersion: doc.version,
    fileName: doc.name
  });

  await audit({
    userId: session.user.id,
    action: "DESKTOP_CHECKOUT",
    targetType: "Document",
    targetId: doc.id,
    detail: { matterId: doc.matterId, baselineVersion: doc.version, jti: payload.jti }
  });

  return NextResponse.json({
    token,
    documentId: doc.id,
    fileName: doc.name,
    baselineVersion: doc.version,
    fileUrl: `/api/desktop/file?token=${encodeURIComponent(token)}`,
    expiresInMs: payload.exp - Date.now()
  });
}
