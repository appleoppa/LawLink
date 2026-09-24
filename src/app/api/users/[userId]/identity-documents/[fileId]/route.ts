import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer } from "@/lib/storage/crypto";
import { auditStrict } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string; fileId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { active: true, systemRole: true } });
  if (!actor?.active) return NextResponse.json({ error: "账号不可用" }, { status: 401 });
  const { userId, fileId } = await params;
  if (actor.systemRole !== "SUPER_ADMIN" && session.user.id !== userId) {
    return NextResponse.json({ error: "无权查看该证件照片" }, { status: 403 });
  }
  const file = await prisma.userIdentityDocument.findFirst({ where: { id: fileId, userId, active: true } });
  if (!file) return NextResponse.json({ error: "证件照片不存在" }, { status: 404 });

  try {
    const ciphertext = await storage.readFile(file.path);
    const image = decryptBuffer(ciphertext, file.iv, file.authTag);
    // P0-7：证件明文查看属关键动作，审计失败即失败——不得出现
    // "照片已返回但无审计记录"的不可核验状态（严格版审计抛错）。
    await auditStrict({
      userId: session.user.id,
      action: "USER_IDENTITY_PHOTO_VIEW",
      targetType: "UserIdentityDocument",
      targetId: file.id,
      detail: { ownerUserId: userId, pageKind: file.pageKind }
    });
    return new NextResponse(new Uint8Array(image), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "证件照片读取失败" }, { status: 500 });
  }
}
