"use client";

/**
 * 冲突检索页（墨案 06 效果图 · 从零重写，替代旧 conflicts-view 的渲染路径）。
 * 布局 = 效果图：页头红线说明 / 检索主体实体卡 / 四格风险卡 / 命中卡（命中依据块）/
 * 未命中主体 + 免责声明。契约不变：runCheckAndSave。
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Search, Plus, Trash2, ShieldAlert, Loader2, ChevronRight } from "lucide-react";
import type { ConflictSeverity, MatterCategory, MatterStatus, PartyRole, LitigationStanding } from "@prisma/client";
import { runCheckAndSave } from "@/server/conflicts/actions";
import { matterHref } from "@/lib/matters/route";
import { cn } from "@/lib/utils";

type QueryRole = "CLIENT_PARTY" | "OPPOSING_PARTY" | "THIRD_PARTY";
type QueryRow = { role: QueryRole; name: string; idNumber: string };

type HitResult = {
  id: string;
  matchedName: string;
  matchedField: string;
  matchedValue: string;
  severity: ConflictSeverity;
  reason: string;
  matterInfo: {
    matterId: string | null;
    canViewMatter: boolean;
    internalCode: string;
    title: string;
    category: MatterCategory;
    status: MatterStatus;
    intakeDate: string | null;
    causeText: string | null;
    ownerName: string | null;
    partyRole: PartyRole;
    partyStanding: LitigationStanding | null;
  } | null;
};

const ROLE_OPTS: { value: QueryRole; label: string }[] = [
  { value: "CLIENT_PARTY", label: "拟委托方" },
  { value: "OPPOSING_PARTY", label: "相对方" },
  { value: "THIRD_PARTY", label: "第三人" }
];

const SEV: Record<ConflictSeverity, { color: string; bg: string; label: string }> = {
  BLOCKING: { color: "#B42318", bg: "#FBECE9", label: "阻塞 BLOCKING" },
  HIGH: { color: "#96650B", bg: "#FAF0DB", label: "高风险" },
  MEDIUM: { color: "#96650B", bg: "#FAF0DB", label: "中风险" },
  LOW: { color: "#1A7F45", bg: "#E7F3EA", label: "低风险" }
};

const PARTY_ROLE: Record<string, string> = {
  CLIENT_PARTY: "历史委托方", OPPOSING_PARTY: "历史相对方", THIRD_PARTY: "历史第三人",
  CO_LITIGANT: "共同诉讼人", AGENT: "代理人", WITNESS: "证人", OTHER: "其他"
};

const inputCls = "h-[36px] w-full rounded-lg border border-[#CFD7D3] bg-card px-3 text-[13px] text-foreground shadow-[inset_0_1px_2px_rgba(12,25,39,0.05)] outline-none transition-colors placeholder:text-[#98A3AD] focus:border-[#007B7F] focus:shadow-[0_0_0_3px_rgba(0,123,127,0.12)]";

export function ConflictsViewV4() {
  const [queries, setQueries] = useState<QueryRow[]>([{ role: "CLIENT_PARTY", name: "", idNumber: "" }]);
  const [results, setResults] = useState<HitResult[] | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [pending, startTransition] = useTransition();

  const counts = { BLOCKING: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<ConflictSeverity, number>;
  (results ?? []).forEach(r => { counts[r.severity]++; });

  function update(i: number, patch: Partial<QueryRow>) {
    setQueries(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  }

  function run() {
    const valid = queries.filter(q => q.name.trim() || q.idNumber.trim());
    if (valid.length === 0) { toast.warning("请至少填写一个主体的名称或证件号"); return; }
    startTransition(async () => {
      try {
        const res = await runCheckAndSave({
          queries: valid.map(q => ({ role: q.role, name: q.name.trim(), idNumber: q.idNumber.trim() || undefined }))
        } as never);
        setResults((res?.hits ?? []) as HitResult[]);
        setHasRun(true);
        toast.success(`检索完成，命中 ${(res?.hits ?? []).length} 条`);
      } catch (err) {
        toast.error("检索失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  const searchedNames = new Set(queries.filter(q => q.name.trim()).map(q => q.name.trim()));
  const hitNames = new Set((results ?? []).map(r => r.matchedName));
  const noHitSubjects = [...searchedNames].filter(n => !hitNames.has(n));

  return (
    <div className="space-y-3.5 pb-8">
      {/* 页头（效果图 06：标题 + 红线说明） */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">利益冲突检索</h1>
          <p className="mt-1 max-w-[640px] text-[12.5px] leading-relaxed text-muted-foreground">
            检索结果按最小披露展示（编号、名称、主办、角色）。{" "}
            <span className="font-medium text-[#B42318]">红色阻塞未得出人工结论前，对应收案不能提交审批。</span>
          </p>
        </div>
        <button type="button" onClick={run} disabled={pending} className="btn btn-primary btn-sm">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {hasRun ? "重新检索全部主体" : "开始检索"}
        </button>
      </div>

      {/* 检索主体：实体卡（效果图 06 subject 卡） */}
      <section className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05)]">
        <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <h2 className="text-[13px] font-semibold">检索主体<span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{queries.length}</span></h2>
          <span className="ml-auto text-[11px] text-muted-foreground">匹配范围：全部历史案件当事人 · 客户档案 · 收案线索</span>
        </div>
        <div className="space-y-2.5 px-4 pb-4">
          {queries.map((q, i) => (
            <div key={i} className="rounded-xl border border-[#E8ECEA] bg-card px-4 py-3 shadow-[0_1px_2px_rgba(12,25,39,0.04)]">
              <div className="mb-2.5 flex items-center gap-2.5">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[#10233A] text-[13px] font-bold text-white">{(q.name || "？").charAt(0)}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{q.name || "待填写主体"}</span>
                <span className="badge b-white">{ROLE_OPTS.find(o => o.value === q.role)?.label}</span>
                {queries.length > 1 && (
                  <button type="button" onClick={() => setQueries(qs => qs.filter((_, idx) => idx !== i))} aria-label="移除该主体" className="rounded-md p-1 text-muted-foreground hover:bg-[#FBECE9] hover:text-[#B42318]"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-foreground/75">主体身份</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_OPTS.map(o => {
                      const on = q.role === o.value;
                      return (
                        <button key={o.value} type="button" aria-pressed={on} onClick={() => update(i, { role: o.value })}
                          className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors", on ? "border-[#B7D8D6] bg-[#E4F1F0] font-semibold text-[#005054]" : "border-[#CFD7D3] bg-card text-muted-foreground hover:border-input hover:bg-muted")}>
                          {on && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-foreground/75">姓名 / 名称</label>
                  <input value={q.name} onChange={e => update(i, { name: e.target.value })} placeholder="如：华东置业集团有限公司" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-foreground/75">身份证 / 统一社会信用代码</label>
                  <input value={q.idNumber} onChange={e => update(i, { idNumber: e.target.value })} placeholder="参与精确匹配；默认不外发" className={cn(inputCls, "font-mono")} />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setQueries(qs => [...qs, { role: "OPPOSING_PARTY", name: "", idNumber: "" }])} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#CFD7D3] text-[12.5px] text-muted-foreground hover:border-input hover:bg-muted/50">
            <Plus className="h-3.5 w-3.5" />添加检索主体（自然人 / 机构）
          </button>
        </div>
      </section>

      {hasRun && (
        <>
          {/* 风险四格卡（效果图 06） */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {(Object.keys(counts) as ConflictSeverity[]).map(k => {
              const active = counts[k] > 0;
              const c = SEV[k];
              return (
                <div key={k} className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: active ? undefined : "#E8ECEA", background: active ? c.bg : "#fff", boxShadow: "0 1px 2px rgba(12,25,39,0.05)" }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: active ? "#fff" : c.bg, color: c.color }}><ShieldAlert className="h-4 w-4" strokeWidth={1.9} /></span>
                  <div>
                    <div className="font-mono text-[22px] font-semibold leading-none tabular" style={{ color: active ? c.color : "#98A3AD" }}>{counts[k]}</div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">{c.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 命中卡（效果图 06：命中依据块 + 最小披露 meta） */}
          {(results ?? []).map(h => {
            const c = SEV[h.severity];
            const m = h.matterInfo;
            const href = m?.canViewMatter && m.matterId ? matterHref({ id: m.matterId, internalCode: m.internalCode }) : null;
            return (
              <section key={h.id} className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05)]" style={{ borderColor: h.severity === "BLOCKING" ? "#F0C6BF" : h.severity === "LOW" ? "#E8ECEA" : "#EBD8AB" }}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="badge" style={{ color: c.color, background: c.bg, borderColor: `${c.color}44` }}><span className="bdot" />{c.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{m ? m.title : h.matchedName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                      {m && <><span className="font-mono">{m.internalCode}</span><span>主办 {m.ownerName ?? "—"}</span><span>{m.intakeDate ?? "—"} 收案</span><span>{PARTY_ROLE[m.partyRole] ?? m.partyRole}</span></>}
                    </div>
                  </div>
                  {href && <Link href={href} className="btn btn-secondary btn-sm">查看案件<ChevronRight className="h-3.5 w-3.5" /></Link>}
                </div>
                <div className="flex gap-2.5 border-t border-[#E8ECEA] bg-[#FBFDFC] px-4 py-2.5 text-[12.5px] leading-relaxed">
                  <span className="shrink-0 font-semibold text-muted-foreground">命中依据</span>
                  <span className="text-foreground/90">{h.reason}<span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{h.matchedField}：{h.matchedValue}</span></span>
                </div>
              </section>
            );
          })}

          {/* 未命中主体 + 免责声明（效果图 06） */}
          <section className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05)]">
            <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
              <span className="h-3.5 w-[3px] rounded-full bg-[#B4BFB9]" />
              <h2 className="text-[13px] font-semibold">未命中主体<span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{noHitSubjects.length}</span></h2>
            </div>
            {noHitSubjects.length === 0 ? (
              <p className="px-4 pb-3 text-[12px] text-muted-foreground">全部主体在检索范围内有命中记录。</p>
            ) : (
              <ul className="px-4 pb-2">
                {noHitSubjects.map(n => (
                  <li key={n} className="flex items-center gap-2 border-b border-[#E8ECEA] py-2 last:border-b-0">
                    <span className="dot dot-slate" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{n}</span>
                    <span className="badge b-white">未命中</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-[#E8ECEA] bg-muted/40 px-4 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              未命中仅表示系统检索范围内无匹配记录，<b>不构成人工确认无冲突</b>。最终结论以人工判断为准，并随审计留痕。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
