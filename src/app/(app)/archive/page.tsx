import Link from "next/link";
import { FileText, Calendar, User, Download } from "lucide-react";
import {
  listArchivedMatters
} from "@/server/archive/actions";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";
import { matterCategoryLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { PageHeader } from "@/components/patterns/moan";



export default async function ArchivePage() {
  const session = await requireSession("archive.read");
  const canAuditAll = isSystemAdmin(session.user);
  const items = await listArchivedMatters();

  return (
    <div className="space-y-4">
      <PageHeader
        className="!mb-0"
        title="归档管理"
        sub={<>已归档 <b>{items.length}</b> 件 · 按归档日期降序 · 点击进入案件可查看卷宗封皮与目录</>}
      />

      {items.length === 0 ? (
        <div className="ll-surface border-dashed py-16 text-center text-sm text-muted-foreground">
          暂无已归档案件。在案件详情顶部&ldquo;状态 → 归档&rdquo;完成归档流程后，会出现在这里。
        </div>
      ) : (
        <div className="ll-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFBFA] text-[10.5px] font-semibold tracking-[0.05em] text-[#98A3AD]">
              <tr>
                <th className="px-3 py-2 text-left font-normal w-32">所内案号</th>
                <th className="px-3 py-2 text-left font-normal">案件</th>
                <th className="px-3 py-2 text-left font-normal w-20">类别</th>
                <th className="px-3 py-2 text-left font-normal w-24">委托方</th>
                <th className="px-3 py-2 text-left font-normal w-20">结案方式</th>
                <th className="px-3 py-2 text-left font-normal w-28">结案日期</th>
                <th className="px-3 py-2 text-left font-normal w-28">归档日期</th>
                <th className="px-3 py-2 text-left font-normal w-20">归档人</th>
                <th className="px-3 py-2 text-left font-normal w-20">必交缺项</th>
                <th className="px-3 py-2 text-left font-normal w-24">材料核验</th>
                <th className="px-3 py-2 text-left font-normal w-20">审阅记录</th>
                <th className="px-3 py-2 text-left font-normal w-16">导出</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((rec) => (
                <tr key={rec.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-xs text-[#6C3FC5]">
                    {rec.matter.firmCaseNo ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={matterHref(rec.matter)}
                      className="hover:text-[#1E56C8] transition-colors line-clamp-1"
                    >
                      <FileText className="h-3 w-3 inline mr-1 text-muted-foreground" />
                      {rec.matter.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {matterCategoryLabel[rec.matter.category as keyof typeof matterCategoryLabel] ?? "类别待核实"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <User className="h-3 w-3 inline mr-1 text-muted-foreground" />
                    {rec.matter.primaryClient?.name ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {rec.closedReason ? CLOSED_REASON_CN[rec.closedReason] : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3 inline mr-1" />
                    {rec.completedAt ? rec.completedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {rec.archivedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{rec.archivedBy}</td>
                  <td className="px-3 py-2.5">
                    {!rec.materialSnapshotVerified ? (
                      <span className="text-xs text-[var(--amber)]">待核验</span>
                    ) : rec.missingItems.length > 0 ? (
                      <Badge variant="outline" className="border-[var(--amber-line)] text-[var(--amber)] text-[10px]">
                        {rec.missingItems.length} 项
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">无</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {rec.materialSnapshotVerified ? <span className="text-[var(--green)]">已固定</span> : <span className="text-[var(--amber)]">历史未固定</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {(canAuditAll || rec.archivedById === session.user.id) ? <Link className="text-primary underline" href={`/approvals?type=ARCHIVE_APPROVE&id=${rec.id}`}>查看</Link> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {rec.materialSnapshotVerified ? <a
                      href={`/api/archive/${rec.matter.id}/export?archiveId=${rec.id}`}
                      className="inline-flex items-center gap-1 text-xs text-[#1E56C8] hover:text-[#1E56C8]/80"
                      title="导出归档 ZIP"
                    >
                      <Download className="h-3 w-3" />
                      ZIP
                    </a> : <span className="text-xs text-muted-foreground" title="历史记录没有固定获批材料，不能生成可核验归档包">待核验</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
