"use client";

import type { IntakeStatus, ConflictSeverity } from "@prisma/client";
import { matterCategoryLabel, matterCategoryShort, intakeStatusLabel } from "@/lib/enums";

export type IntakeRow = {
  id: string;
  title: string;
  category: keyof typeof matterCategoryLabel;
  status: IntakeStatus;
  receivedAt: Date;
  client: { id: string; name: string } | null;
  cause: { id: string; name: string } | null;
  conflictChecks: { id: string; conclusion: string; hits: { severity: ConflictSeverity }[] }[];
  parties: { name: string }[];
  matter: { id: string; internalCode: string } | null;
  claimAmount?: number | null;
  ownerName?: string | null;
};

/**
 * v0.17: 待审批 / 待补正 收案列表 — 复用 MattersTable 的 CaseListCard 保证视觉一致
 */
export function IntakesTable({
  items,
  kind = "intake"
}: {
  items: IntakeRow[];
  kind?: "intake" | "revision";
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card py-20 text-center">
        <div className="text-base text-muted-foreground">
          {kind === "revision" ? "暂无待补正收案" : "暂无待审批收案"}
        </div>
        <div className="text-xs text-muted-foreground/70">
          {kind === "revision"
            ? "在 待审批 中拒绝的收案，可补正材料后重新提交，会出现在这里"
            : (
              <>
                点击右上角 <span className="text-foreground/80">新建收案</span> 开始
              </>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="ll-surface overflow-hidden">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: "30%" }}>收案 / 当事人</th>
            <th style={{ width: "12%" }}>类别</th>
            <th style={{ width: "13%" }}>委托方</th>
            <th style={{ width: "11%" }}>收案时间</th>
            <th style={{ width: "12%" }}>标的额</th>
            <th style={{ width: "22%" }}>冲突核查</th>
            <th style={{ width: "10%" }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const statusLabel = kind === "revision" ? "待补正" : intakeStatusLabel[it.status] ?? it.status;
            const hitSeverities = it.conflictChecks.flatMap((c) => c.hits.map((h) => h.severity));
            const hasBlocking = hitSeverities.includes("BLOCKING");
            const pendingConclusion = it.conflictChecks.some((c) => c.conclusion === "PENDING");
            const spine = hasBlocking ? "#B42318" : kind === "revision" ? "#B45309" : "#96650B";
            return (
              <tr key={it.id} className="transition-colors hover:bg-muted/50">
                <td className="relative px-4 py-3 pl-[18px]">
                  <span aria-hidden className="absolute left-0 top-[10px] bottom-[10px] w-[3px] rounded-r-[2px]" style={{ background: spine }} />
                  <a href={`/intakes/${it.id}`} className="block min-w-0 no-underline">
                    <span className="block truncate text-[13px] font-semibold leading-5 text-foreground">{it.title}</span>
                    {it.parties.length > 0 ? (
                      <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                        当事人：{it.parties.map((p) => p.name).join("、")}
                      </span>
                    ) : null}
                    {it.matter ? (
                      <span className="mt-0.5 block font-mono text-[11px] leading-4 text-muted-foreground/70 tabular">
                        已转案件 {it.matter.internalCode}
                      </span>
                    ) : null}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <span className="badge b-white">{matterCategoryShort[it.category as keyof typeof matterCategoryShort]}</span>
                </td>
                <td className="max-w-[9rem] truncate px-4 py-3 text-[12.5px] text-foreground/85">
                  {it.client?.name ?? it.parties[0]?.name ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground tabular">
                  {new Date(it.receivedAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="td-num money px-4 py-3">
                  {it.claimAmount != null ? it.claimAmount.toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "—"}
                </td>
                <td className="px-4 py-3">
                  {it.conflictChecks.length === 0 ? (
                    <span className="text-[12px] text-muted-foreground/55">未发起</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {hasBlocking ? (
                        <span className="badge b-outline-red">冲突 BLOCKING</span>
                      ) : hitSeverities.length > 0 ? (
                        <span className="badge b-amber">命中 {hitSeverities.length}</span>
                      ) : (
                        <span className="badge b-white">未命中</span>
                      )}
                      {pendingConclusion ? (
                        <span className="badge b-amber"><span className="bdot" />结论待出</span>
                      ) : (
                        <span className="badge b-green"><span className="bdot" />已出结论</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${hasBlocking ? "b-red" : kind === "revision" ? "b-orange" : "b-amber"}`}>
                    <span className="bdot" />
                    {statusLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
