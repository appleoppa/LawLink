import { NextResponse } from "next/server";
import { isManager } from "@/lib/permissions";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/options";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { buildMatterImportTemplate } from "@/server/imports/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user) && !isManager(session.user)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await buildMatterImportTemplate();
  } catch (err) {
    console.error("[imports/template] 生成失败：", err);
    return NextResponse.json({ error: "模板生成失败" }, { status: 500 });
  }

  const filename = "lawlink-案件导入模板.xlsx";
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new NextResponse(arr, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
