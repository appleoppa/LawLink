import Link from "next/link";
import { Download } from "lucide-react";
import {
  listArchivedMatters
} from "@/server/archive/actions";
import { listArchivePageData } from "@/server/archive/borrow";
import { BorrowPanel } from "./_components/borrow-panel";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import { formatDate } from "@/lib/utils";
import { requireSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { matterCategoryLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { PageHeader } from "@/components/patterns/moan";

export default async function ArchivePage() {
  // F-6：页面放开为登录可进——archive.read 持有者见全量台账；
  // 其他成员经「案卷借阅」面板检索、申请、审批与限时查阅
  const session = await requireSession();
  const page = await listArchivePageData();
  const canAuditAll = isSystemAdmin(session.user);
  const items = page.hasArchiveRead ? await listArchivedMatters() : [];

  return (
    <div className="space-y-4">
      <PageHeader
        className="!mb-0"
        title="归档管理"
        sub={<>已归档 <b>{items.length}</b> 件 · 按归档日期降序 · 点击进入案件可查看卷宗封皮与目录</>}
      />

      <BorrowPanel mine={page.borrows.mine} pending={page.borrows.pending} canApply={!page.hasArchiveRead} />

      {page.hasArchiveRead && items.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="mo-empty-title">暂无已归档案件</div>
            <div className="mo-empty-desc">在案件详情「···」菜单发起归档申请，审批通过后会出现在这里。</div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="mo-scroll-x">
            <table className="mo-table" style={{ minWidth: 1080, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 150, paddingLeft: 20 }}>归档号 / 所内案号</th>
                  <th>案件</th>
                  <th style={{ width: 84 }}>类别</th>
                  <th style={{ width: 120 }}>委托方</th>
                  <th style={{ width: 76 }}>结案方式</th>
                  <th style={{ width: 108 }}>结案日期</th>
                  <th style={{ width: 108 }}>归档日期</th>
                  <th style={{ width: 70 }}>归档人</th>
                  <th style={{ width: 92 }}>材料</th>
                  <th style={{ width: 96 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((rec) => (
                  <tr key={rec.id} data-spine="bronze">
                    <td style={{ paddingLeft: 20 }}>
                      <div className="font-mono text-[12px] font-semibold">{rec.archiveNo}</div>
                      <div className="font-mono text-[11px] text-[var(--t-muted)]">{rec.matter.firmCaseNo ?? "—"}</div>
                    </td>
                    <td className="min-w-0">
                      <Link href={matterHref(rec.matter)} className="block truncate font-semibold hover:text-[var(--teal-deep)]" title={rec.matter.title}>
                        {rec.matter.title}
                      </Link>
                    </td>
                    <td className="t-sm">{matterCategoryLabel[rec.matter.category as keyof typeof matterCategoryLabel] ?? "类别待核实"}</td>
                    <td className="t-sm truncate" title={rec.matter.primaryClient?.name ?? undefined}>{rec.matter.primaryClient?.name ?? "—"}</td>
                    <td className="t-sm">{rec.closedReason ? CLOSED_REASON_CN[rec.closedReason] : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-[var(--t-secondary)]">{rec.completedAt ? formatDate(rec.completedAt) : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-[var(--t-secondary)]">{formatDate(rec.archivedAt)}</td>
                    <td className="t-sm">{rec.archivedBy}</td>
                    <td>
                      {!rec.materialSnapshotVerified ? (
                        <span className="badge b-amber" title="历史归档记录没有固定获批材料清单">未固定</span>
                      ) : rec.missingItems.length > 0 ? (
                        <span className="badge b-amber">缺 {rec.missingItems.length} 项</span>
                      ) : (
                        <span className="badge b-green">齐全</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2 whitespace-nowrap text-[12px]">
                        {canAuditAll || rec.archivedById === session.user.id ? (
                          <Link className="text-[var(--teal-deep)] hover:underline" href={`/approvals?type=ARCHIVE_APPROVE&id=${rec.id}`}>审阅记录</Link>
                        ) : null}
                        {rec.materialSnapshotVerified ? (
                          <a href={`/api/archive/${rec.matter.id}/export?archiveId=${rec.id}`} className="inline-flex items-center gap-1 text-[var(--teal-deep)] hover:underline" title="导出归档 ZIP">
                            <Download className="h-3 w-3" />
                            ZIP
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
