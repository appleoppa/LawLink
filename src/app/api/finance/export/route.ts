import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { matterFinanceVisibilityFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { RECEIVABLE: "应收", RECEIVED: "实收", REFUND: "退款/冲正", COST: "支出", COMMISSION: "分成" };

/** 墨案 08「导出流水」：按财务可见范围导出收付流水 CSV；需财务查看 + 报表导出权限，写审计 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!hasCustomPermission(session.user, "finance.read") || !hasCustomPermission(session.user, "reports.export")) {
    return NextResponse.json({ error: "导出流水需要财务查看与报表导出权限" }, { status: 403 });
  }
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? "0");
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000) : undefined;

  const rows = await prisma.feeEntry.findMany({
    where: {
      matter: { deletedAt: null, ...matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) },
      ...(since ? { occurredAt: { gte: since } } : {})
    },
    orderBy: { occurredAt: "desc" },
    take: 5000,
    include: {
      matter: { select: { internalCode: true, title: true } },
      recordedBy: { select: { name: true } },
      beneficiaryUser: { select: { name: true } }
    }
  });

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["日期", "案件编号", "案件名称", "类型", "确认状态", "金额", "对方户名", "方式", "发票号", "分成受益人", "备注", "经手"];
  const lines = rows.map((r) =>
    [
      r.occurredAt.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
      r.matter.internalCode,
      r.matter.title,
      TYPE_LABEL[r.type] ?? r.type,
      // 待确认实收尚未入账，导出必须标明，不能与已确认实收混在一起统计
      r.type === "RECEIVED" ? (r.confirmState === "CONFIRMED" ? "已确认" : "待确认") : "—",
      Number(r.amount).toFixed(2),
      r.payerOrPayee,
      r.method,
      r.invoiceNo,
      r.beneficiaryUser?.name,
      r.note,
      r.recordedBy.name
    ].map(esc).join(",")
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n");

  await audit({
    userId: session.user.id,
    action: "FINANCE_EXPORT",
    targetType: "FeeEntryList",
    targetId: since ? `last-${days}d` : "all",
    detail: { rows: rows.length }
  });

  const filename = `lawlink-收付流水-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
