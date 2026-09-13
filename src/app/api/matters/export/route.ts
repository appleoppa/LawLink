import { hasCustomPermission } from "@/lib/roles/catalog";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { audit } from "@/server/audit";
import {
  buildMattersExportWorkbook,
  resolveMattersExportParams
} from "@/server/matters/export-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!hasCustomPermission(session.user, "matters.export")) return NextResponse.json({ error: "无导出权限" }, { status: 403 });
  if (!hasCustomPermission(session.user, "matters.read") || !hasCustomPermission(session.user, "finance.read") || !hasCustomPermission(session.user, "documents.download")) return NextResponse.json({ error: "导出完整案件需要案件查看、财务查看和材料下载权限" }, { status: 403 });

  const url = new URL(req.url);
  const params = resolveMattersExportParams(url.searchParams);

  let result: Awaited<ReturnType<typeof buildMattersExportWorkbook>>;
  try {
    result = await buildMattersExportWorkbook(params, {
      id: session.user.id,
      role: session.user.role,
      rolePermissions: session.user.rolePermissions
    });
  } catch (err) {
    console.error("[matters/export] 生成失败：", err);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }

  await audit({
    userId: session.user.id,
    action: "MATTERS_EXPORT",
    targetType: "MatterList",
    targetId: params.tab,
    detail: {
      tab: params.tab,
      tabLabel: result.tabLabel,
      total: result.total,
      filters: params,
      bytes: result.buffer.byteLength
    }
  });

  const arr = result.buffer.buffer.slice(
    result.buffer.byteOffset,
    result.buffer.byteOffset + result.buffer.byteLength
  ) as ArrayBuffer;

  return new NextResponse(arr, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(result.buffer.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    }
  });
}
