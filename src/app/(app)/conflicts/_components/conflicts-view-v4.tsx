"use client";

/**
 * 工作区「冲突预检」（2026-09-14 用户确认）：
 * 律师在收案前自行检索本所系统中是否有相关记录，只为了解情况——不经审批、不出检索结论，
 * 也不能被收案引用。正式冲突检索在收案时自动进行，由收案详情出结论、收案审批核查。
 *
 * 页面职责是「全面展示」：按检索主体分组，逐个列出命中的历史案件与在办收案、命中方式
 * （名称相同 / 名称相似 / 证件一致）、对方在该案中的角色与风险提示；未命中主体单列并声明不等于无冲突。
 * 最小披露：案件只显示编号、名称、主办、状态、角色；在办收案只显示名称、登记人、状态、角色。
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Briefcase, FileClock, Info, Loader2, Plus, Search, ShieldAlert, ShieldCheck, TriangleAlert, Users, X } from "lucide-react";
import type { ConflictSeverity, MatterCategory, MatterStatus, PartyRole, LitigationStanding } from "@prisma/client";
import { runCheckAndSave } from "@/server/conflicts/actions";
import { matterHref } from "@/lib/matters/route";
import { intakeStatusLabel, litigationStandingLabel, matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import { PageHeader } from "@/components/patterns/moan";
import { cn, formatDate } from "@/lib/utils";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { shMonthDayTime } from "@/lib/ui/sh-time";

type QueryRole = PartyRole;
type QueryRow = { key: string; role: QueryRole; name: string; idNumber: string; editing: boolean };

type HitResult = {
  id: string;
  hitType: string;
  targetType: string;
  targetId: string;
  matchedName: string;
  matchedField: string;
  matchedValue: string;
  matchedRatio: number | null;
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
  intakeInfo: {
    title: string;
    status: keyof typeof intakeStatusLabel;
    receivedAt: string;
    registrantName: string | null;
    partyRole: PartyRole;
    partyStanding: LitigationStanding | null;
  } | null;
};

const ROLE_OPTS: { value: QueryRole; label: string; badge: string; logo: string }[] = [
  { value: "CLIENT_PARTY", label: "拟委托方", badge: "b-teal", logo: "var(--navy)" },
  { value: "OPPOSING_PARTY", label: "对方", badge: "b-slate", logo: "var(--slate)" },
  { value: "THIRD_PARTY", label: "第三人", badge: "b-slate", logo: "#33989B" }
];
const roleMeta = (role: QueryRole) => ROLE_OPTS.find((o) => o.value === role) ?? ROLE_OPTS[1];

const HIT_ROLE: Record<string, string> = {
  CLIENT_PARTY: "委托方", OPPOSING_PARTY: "对方当事人", THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人", AGENT: "代理人", WITNESS: "证人", OTHER: "其他"
};

/** 风险提示用业务语言表达，只是系统按角色组合给出的关注程度，不是结论 */
const SEVERITY_META: Record<ConflictSeverity, { label: string; badge: string; rank: number }> = {
  BLOCKING: { label: "重点关注", badge: "b-red", rank: 3 },
  HIGH: { label: "高风险提示", badge: "b-red", rank: 2 },
  MEDIUM: { label: "需核实", badge: "b-amber", rank: 1 },
  LOW: { label: "一般提示", badge: "b-slate", rank: 0 }
};

const matchKind = (h: HitResult) => (h.matchedField === "idNumber" ? "证件一致" : h.matchedRatio !== null && h.matchedRatio < 1 ? "名称相似" : "名称相同");
let seq = 0;
const newKey = () => `q${++seq}`;
const emptyRow = (role: QueryRole, name = ""): QueryRow => ({ key: newKey(), role, name, idNumber: "", editing: true });

type TargetGroup = { key: string; hits: HitResult[]; top: HitResult };
type SubjectResult = { query: QueryRow; targets: TargetGroup[] };

/** 命中不记录来自哪条检索条件：名称命中以 matchedValue=检索名称、证件命中以 matchedValue=检索证件 反推所属主体 */
function groupBySubject(queries: QueryRow[], hits: HitResult[]): SubjectResult[] {
  return queries.map((q) => {
    const own = hits.filter((h) => (h.matchedField === "idNumber" ? Boolean(q.idNumber.trim()) && h.matchedValue === q.idNumber.trim() : h.matchedValue === q.name.trim()));
    const byTarget = new Map<string, HitResult[]>();
    for (const h of own) {
      const key = `${h.targetType}:${h.matterInfo?.internalCode ?? h.intakeInfo?.title ?? h.reason}:${h.matchedName}`;
      byTarget.set(key, [...(byTarget.get(key) ?? []), h]);
    }
    const targets = [...byTarget.entries()]
      .map(([key, list]) => ({ key, hits: list, top: [...list].sort((a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank)[0] }))
      .sort((a, b) => SEVERITY_META[b.top.severity].rank - SEVERITY_META[a.top.severity].rank);
    return { query: q, targets };
  });
}

export function ConflictsViewV4({ prefillName = "" }: { prefillName?: string }) {
  const router = useRouter();
  const [queries, setQueries] = useState<QueryRow[]>(() => [emptyRow("CLIENT_PARTY", prefillName)]);
  const [results, setResults] = useState<HitResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [searchedQueries, setSearchedQueries] = useState<QueryRow[]>([]);
  const [pending, startTransition] = useTransition();

  const hits = useMemo(() => results ?? [], [results]);
  const subjects = useMemo(() => groupBySubject(searchedQueries, hits), [searchedQueries, hits]);
  const hitSubjects = subjects.filter((s) => s.targets.length > 0);
  const noHitSubjects = subjects.filter((s) => s.targets.length === 0);
  const matterCount = new Set(hits.filter((h) => h.targetType === "Matter").map((h) => h.matterInfo?.internalCode)).size;
  const intakeCount = new Set(hits.filter((h) => h.targetType === "Intake").map((h) => h.intakeInfo?.title)).size;
  const attention = hits.filter((h) => h.severity === "BLOCKING" || h.severity === "HIGH").length;

  function update(key: string, patch: Partial<QueryRow>) {
    setQueries((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  function reset() {
    setQueries([emptyRow("CLIENT_PARTY")]);
    setResults(null);
    setSearchedQueries([]);
    setCheckedAt(null);
  }
  useTopbarAction({ label: "新建预检", onClick: () => reset() }, []);

  function run() {
    const valid = queries.filter((q) => q.name.trim() || q.idNumber.trim());
    if (valid.length === 0) {
      toast.warning("请至少填写一个主体的名称或证件号");
      return;
    }
    startTransition(async () => {
      try {
        const res = await runCheckAndSave({
          queries: valid.map((q) => ({ role: q.role, name: q.name.trim(), idNumber: q.idNumber.trim() || undefined }))
        });
        const list = (res?.hits ?? []) as unknown as HitResult[];
        setResults(list);
        setCheckedAt(new Date());
        setSearchedQueries(valid.map((q) => ({ ...q, editing: false })));
        setQueries((qs) => qs.map((q) => ({ ...q, editing: false })));
        toast.success(list.length ? `预检完成，共 ${list.length} 条相关记录` : "预检完成，系统中未发现相关记录");
        router.refresh();
      } catch (err) {
        toast.error("检索失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  const hasRun = results !== null;

  return (
    <div className="mo-conflict">
      <PageHeader
        title="冲突预检"
        sub={
          <>
            收案前先查一查本所系统里有没有相关记录，仅供自己了解情况：<b style={{ fontFamily: "inherit", color: "var(--t-primary)" }}>不需要审批，也不出检索结论。</b>
            正式的利益冲突检索在登记收案时自动进行，并随收案审批核查。
          </>
        }
      />

      {/* 检索主体 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div className="panel-title">
            <Search className="ic" />
            检索主体 <span className="badge b-white" style={{ marginLeft: 2 }}>{queries.length}</span>
          </div>
        </div>

        {queries.map((q) => {
          const meta = roleMeta(q.role);
          return (
            <div key={q.key} className="subject">
              <div className="sub-logo" style={{ background: meta.logo }}>{(q.name || "?").trim().charAt(0) || "?"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {q.editing ? (
                  <div className="grid gap-2.5 md:grid-cols-[auto_1fr_1fr]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ROLE_OPTS.map((o) => (
                        <button key={o.value} type="button" aria-pressed={q.role === o.value} onClick={() => update(q.key, { role: o.value })} className={cn("badge cursor-pointer", q.role === o.value ? o.badge : "b-white")} style={{ height: 26, padding: "0 10px" }}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <input autoFocus={!q.name} value={q.name} onChange={(e) => update(q.key, { name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") run(); }} placeholder="姓名 / 名称，如：华东置业集团有限公司" aria-label="主体名称" className="input" style={{ height: 32 }} />
                    <input value={q.idNumber} onChange={(e) => update(q.key, { idNumber: e.target.value.toUpperCase().replace(/\s+/g, "") })} onKeyDown={(e) => { if (e.key === "Enter") run(); }} placeholder="身份证 / 统一社会信用代码（选填，精确匹配）" aria-label="证件号码" className="input font-mono" style={{ height: 32 }} />
                  </div>
                ) : (
                  <>
                    <div className="sub-name">
                      {q.name || <span className="t-faint">未填写名称</span>}
                      <span className={cn("badge", meta.badge)}>{meta.label}</span>
                    </div>
                    <div className="sub-fields">
                      <div className="sub-field">
                        <span className="k">证件 / 信用代码</span>
                        {q.idNumber ? (
                          <span className="v">{q.idNumber}</span>
                        ) : (
                          <span className="t-xs t-faint">未填写 · 仅按名称检索，补充证件可精确比对</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(q.key, { editing: !q.editing })}>
                  {q.editing ? "完成" : "修改"}
                </button>
                {queries.length > 1 ? (
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="移除该主体" onClick={() => setQueries((qs) => qs.filter((x) => x.key !== q.key))}>
                    <X />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        <div className="subject" style={{ borderTop: "1px dashed var(--bd-subtle)" }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ border: "1px dashed var(--bd-default)", width: "100%", justifyContent: "center", height: 38 }} onClick={() => setQueries((qs) => [...qs, emptyRow("OPPOSING_PARTY")])}>
            <Plus />
            添加检索主体（自然人 / 机构）
          </button>
        </div>

        <div className="run-bar" style={{ padding: "0 16px 16px" }}>
          <button type="button" className="btn btn-primary" onClick={run} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Search />}
            {hasRun ? "重新预检" : "开始预检"}
          </button>
          <span className="run-note">
            <Info className="h-3.5 w-3.5" />
            检索范围：历史案件当事人 · 客户档案关联案件 · 尚未转为案件的在办收案
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {!hasRun ? (
            <div className="card">
              <div className="empty">
                <div className="empty-ic"><ShieldCheck /></div>
                <div className="mo-empty-title">填写主体后开始预检</div>
                <div className="mo-empty-desc">按名称与证件号码比对本所的历史案件、客户档案和在办收案，按主体逐个列出相关记录，方便在收案前掌握情况。</div>
              </div>
            </div>
          ) : (
            <>
              <div className="risk-strip" style={{ marginTop: 0 }}>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)" }}><Users /></div>
                  <div><div className="rn">{hitSubjects.length}<span className="t-xs t-mute" style={{ fontFamily: "inherit", fontWeight: 500 }}> / {subjects.length}</span></div><div className="rl">有相关记录的主体</div></div>
                </div>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--slate-bg)", color: "var(--slate)" }}><Briefcase /></div>
                  <div><div className="rn" style={{ color: matterCount ? undefined : "var(--t-faint)" }}>{matterCount}</div><div className="rl">涉及历史案件</div></div>
                </div>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><FileClock /></div>
                  <div><div className="rn" style={{ color: intakeCount ? "var(--amber)" : "var(--t-faint)" }}>{intakeCount}</div><div className="rl">涉及在办收案</div></div>
                </div>
                <div className="card risk-cell" style={attention ? { borderColor: "var(--red-line)" } : undefined}>
                  <div className="risk-ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><TriangleAlert /></div>
                  <div><div className="rn" style={{ color: attention ? "var(--red)" : "var(--t-faint)" }}>{attention}</div><div className="rl">重点关注 / 高风险</div></div>
                </div>
              </div>

              {hitSubjects.map((s) => (
                <SubjectCard key={s.query.key} subject={s} />
              ))}

              <div className="card">
                <div className="panel-head">
                  <div className="panel-title" style={{ fontSize: 13 }}>
                    未发现相关记录的主体 <span className="t-xs t-mute" style={{ fontWeight: 500 }}>{noHitSubjects.length}</span>
                  </div>
                </div>
                {noHitSubjects.length === 0 ? (
                  <div className="nomatch-row t-xs t-mute">每个检索主体都有相关记录，详见上方。</div>
                ) : (
                  noHitSubjects.map(({ query: q }) => (
                    <div key={q.key} className="nomatch-row">
                      <span className="dot dot-slate" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {q.name || q.idNumber}（{roleMeta(q.role).label}）
                        </div>
                        <div className="t-xs t-mute" style={{ marginTop: 1 }}>历史案件、客户档案与在办收案中均未发现</div>
                      </div>
                      <span className="badge b-white">未发现</span>
                    </div>
                  ))
                )}
                <div className="disclaimer">
                  <Info className="h-3.5 w-3.5 shrink-0" style={{ marginTop: 2 }} />
                  <span>未发现仅表示系统登记的记录里没有匹配，<b>不等于确认无冲突</b>：别名、关联公司、未录入系统的代理关系仍需自行核实。正式收案时系统会重新检索，并由审批人核查。</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="card">
            <div className="panel-head">
              <div className="panel-title" style={{ fontSize: 13 }}>本次预检</div>
              {checkedAt ? <span className="badge b-teal" style={{ fontSize: 10 }}>{shMonthDayTime(checkedAt)}</span> : <span className="badge b-white" style={{ fontSize: 10 }}>未开始</span>}
            </div>
            <div className="panel-body space-y-1.5 text-[12px]" style={{ paddingTop: 10 }}>
              <div className="flex justify-between"><span className="t-mute">检索主体</span><span>{hasRun ? searchedQueries.length : queries.filter((q) => q.name.trim() || q.idNumber.trim()).length} 个</span></div>
              <div className="flex justify-between"><span className="t-mute">填写证件</span><span>{(hasRun ? searchedQueries : queries).filter((q) => q.idNumber.trim()).length} 个</span></div>
              <div className="flex justify-between"><span className="t-mute">相关记录</span><span>{hasRun ? `${hits.length} 条` : "—"}</span></div>
            </div>
          </div>

          <div className="side-note">
            <ShieldAlert />
            <span>
              预检最小披露：案件只显示<b>编号、名称、主办、状态、角色</b>；在办收案只显示<b>名称、登记人、状态、角色</b>。案件正文与材料不因预检开放。每次预检写入审计日志。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubjectCard({ subject }: { subject: SubjectResult }) {
  const { query: q, targets } = subject;
  const meta = roleMeta(q.role);
  const worst = targets[0]?.top.severity;
  return (
    <div className={cn("card hit-card", worst === "BLOCKING" || worst === "HIGH" ? "blocking" : worst === "MEDIUM" ? "medium" : undefined)}>
      <div className="hit-head">
        <div className="sub-logo" style={{ background: meta.logo, width: 30, height: 30, fontSize: 13 }}>{q.name.trim().charAt(0) || "?"}</div>
        <div className="min-w-0 flex-1">
          <div className="hit-title flex flex-wrap items-center gap-2">
            <span className="truncate">{q.name || q.idNumber}</span>
            <span className={cn("badge", meta.badge)}>{meta.label}</span>
          </div>
          <div className="hit-meta">相关记录 {targets.length} 处 · {[...new Set(targets.flatMap((t) => t.hits.map(matchKind)))].join(" / ")}</div>
        </div>
      </div>
      {targets.map((t) => (
        <TargetRow key={t.key} target={t} />
      ))}
    </div>
  );
}

function TargetRow({ target }: { target: TargetGroup }) {
  const { top, hits } = target;
  const sev = SEVERITY_META[top.severity];
  const m = top.matterInfo;
  const it = top.intakeInfo;
  const role = m ?? it;
  const roleText = role ? (role.partyStanding ? `${HIT_ROLE[role.partyRole] ?? "当事人"} · ${litigationStandingLabel[role.partyStanding]}` : HIT_ROLE[role.partyRole] ?? "当事人") : null;
  const href = m?.canViewMatter && m.matterId ? matterHref({ id: m.matterId, internalCode: m.internalCode }) : null;
  const idHit = hits.find((h) => h.matchedField === "idNumber");
  return (
    <div className="hit-match" style={{ borderBottom: "none", display: "block" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("badge shrink-0", m ? "b-white" : "b-amber")}>{m ? "历史案件" : "在办收案"}</span>
        <span className="min-w-0 truncate text-[13px] font-semibold">{m ? `${m.internalCode} · ${m.title}` : it?.title ?? top.matchedName}</span>
        <span className={cn("badge ml-auto shrink-0", sev.badge)}><span className="bdot" />{sev.label}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        <div><span className="t-mute">命中方式　</span>{[...new Set(hits.map(matchKind))].join("、")}{idHit ? <span className="ml-1 font-mono text-[11px] t-mute">{idHit.matchedValue}</span> : null}</div>
        <div><span className="t-mute">命中主体　</span>「{top.matchedName}」在该{m ? "案" : "收案"}中为 <b>{roleText}</b></div>
        {m ? (
          <>
            <div><span className="t-mute">主办律师　</span>{m.ownerName ?? "—"}</div>
            <div><span className="t-mute">案件状态　</span>{matterStatusLabel[m.status]}{m.intakeDate ? ` · 收案 ${formatDate(m.intakeDate)}` : ""}</div>
            <div className="sm:col-span-2"><span className="t-mute">案由 / 类别　</span>{m.causeText ?? matterCategoryLabel[m.category]}</div>
          </>
        ) : it ? (
          <>
            <div><span className="t-mute">登记人　　</span>{it.registrantName ?? "—"}</div>
            <div><span className="t-mute">收案状态　</span>{intakeStatusLabel[it.status]} · 登记 {formatDate(it.receivedAt)}</div>
          </>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] t-faint">
        {href ? (
          <Link href={href} className="btn btn-ghost btn-sm">查看案件</Link>
        ) : (
          <span className="inline-flex items-center gap-1"><Info className="h-3 w-3" />{m ? "你不是该案成员，如需了解请联系主办律师" : "收案内容不因预检开放，如需了解请联系登记人"}</span>
        )}
      </div>
    </div>
  );
}

