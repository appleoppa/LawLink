"use client";

/**
 * 利益冲突检索（墨案 06 效果图）：
 * 检索主体（可自收案自动携带）→ 命中分级四格 → 命中卡（命中依据 + 判断辅助）→
 * 未命中主体与「未命中≠人工确认无冲突」声明 → 人工结论留痕；右栏为本次检索进度、既往记录与最小披露说明。
 * 契约不变：runCheckAndSave / setConflictConclusion；逐条「标记」只辅助撰写判断说明，不单独落库。
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, CircleMinus, Info, Loader2, Plus, Search, ShieldAlert, ShieldCheck, SquareCheck, TriangleAlert, X } from "lucide-react";
import type { ConflictSeverity, MatterCategory, MatterStatus, PartyRole, LitigationStanding } from "@prisma/client";
import { runCheckAndSave, setConflictConclusion, type listMyRecentConflictChecks } from "@/server/conflicts/actions";
import { matterHref } from "@/lib/matters/route";
import { litigationStandingLabel } from "@/lib/enums";
import { PageHeader } from "@/components/patterns/moan";
import { cn } from "@/lib/utils";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { shMonthDayTime } from "@/lib/ui/sh-time";

type QueryRole = PartyRole;
type QueryRow = { key: string; role: QueryRole; name: string; idNumber: string; fromIntake: boolean; editing: boolean };
type Recent = Awaited<ReturnType<typeof listMyRecentConflictChecks>>;
type Conclusion = "PENDING" | "SAME_SUBJECT" | "DIFFERENT" | "NEED_INFO";

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

const ROLE_OPTS: { value: QueryRole; label: string; badge: string; logo: string }[] = [
  { value: "CLIENT_PARTY", label: "委托方", badge: "b-teal", logo: "var(--navy)" },
  { value: "OPPOSING_PARTY", label: "诉讼对方", badge: "b-slate", logo: "var(--slate)" },
  { value: "THIRD_PARTY", label: "第三人", badge: "b-slate", logo: "#33989B" },
  { value: "CO_LITIGANT", label: "共同诉讼人", badge: "b-slate", logo: "#33989B" },
  { value: "OTHER", label: "关联主体", badge: "b-slate", logo: "#33989B" }
];
const roleMeta = (role: QueryRole) => ROLE_OPTS.find((o) => o.value === role) ?? ROLE_OPTS[ROLE_OPTS.length - 1];

const HIT_ROLE: Record<string, string> = {
  CLIENT_PARTY: "委托方", OPPOSING_PARTY: "对方当事人", THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人", AGENT: "代理人", WITNESS: "证人", OTHER: "其他"
};

const CONCLUSIONS: { value: Exclude<Conclusion, "PENDING">; title: string; desc: string }[] = [
  { value: "SAME_SUBJECT", title: "存在利益冲突，不承办", desc: "收案将终止，检索记录与结论归档留存" },
  { value: "DIFFERENT", title: "不存在利益冲突，可以承办", desc: "需逐项说明对命中记录的判断理由" },
  { value: "NEED_INFO", title: "需补充资料后再判断", desc: "列明缺项，由收案发起人补充后重新检索" }
];
const CONCLUSION_LABEL: Record<Conclusion, string> = { PENDING: "未出结论", SAME_SUBJECT: "存在冲突", DIFFERENT: "可承办", NEED_INFO: "需补充" };

const mask = (v: string) => (v.length <= 8 ? v.replace(/.(?=.{2})/g, "*") : `${v.slice(0, 4)}${"*".repeat(Math.max(4, v.length - 8))}${v.slice(-4)}`);
const mmddhhmm = (iso: string | Date) => shMonthDayTime(iso);
let seq = 0;
const newKey = () => `q${++seq}`;

export function ConflictsViewV4({
  intake,
  initialQueries,
  recent,
  prefillName = ""
}: {
  intake: { id: string; title: string; receivedAt: string } | null;
  initialQueries: { role: QueryRole; name: string; idNumber: string }[];
  recent: Recent;
  /** 客户档案「冲突检索」入口带入的主体名称 */
  prefillName?: string;
}) {
  const router = useRouter();
  const [queries, setQueries] = useState<QueryRow[]>(() =>
    initialQueries.length
      ? initialQueries.map((q) => ({ key: newKey(), ...q, fromIntake: true, editing: false }))
      : [{ key: newKey(), role: "CLIENT_PARTY", name: prefillName, idNumber: "", fromIntake: false, editing: true }]
  );
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<HitResult[] | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [searchedQueries, setSearchedQueries] = useState<QueryRow[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [conclusion, setConclusion] = useState<Conclusion>("PENDING");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<Conclusion | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  const hits = useMemo(() => results ?? [], [results]);
  const blocking = hits.filter((h) => h.severity === "BLOCKING");
  const review = hits.filter((h) => h.severity !== "BLOCKING");
  const hitNames = new Set(hits.map((h) => h.matchedName.trim()));
  const hitValues = new Set(hits.map((h) => h.matchedValue.trim()));
  const noHitSubjects = searchedQueries.filter((q) => !hitNames.has(q.name.trim()) && !(q.idNumber && hitValues.has(q.idNumber.trim())));
  const markedCount = Object.keys(marks).length;

  function update(key: string, patch: Partial<QueryRow>) {
    setQueries((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  function reset() {
    setQueries([{ key: newKey(), role: "CLIENT_PARTY", name: "", idNumber: "", fromIntake: false, editing: true }]);
    setResults(null);
    setCheckId(null);
    setMarks({});
    setConclusion("PENDING");
    setNote("");
    setSubmitted(null);
    if (intake) router.replace("/conflicts");
  }
  useTopbarAction({ label: "新建检索", onClick: () => reset() }, [intake]);

  function run() {
    const valid = queries.filter((q) => q.name.trim() || q.idNumber.trim());
    if (valid.length === 0) {
      toast.warning("请至少填写一个主体的名称或证件号");
      return;
    }
    startTransition(async () => {
      try {
        const res = await runCheckAndSave({
          ...(intake ? { intakeId: intake.id } : {}),
          queries: valid.map((q) => ({ role: q.role, name: q.name.trim(), idNumber: q.idNumber.trim() || undefined }))
        } as never);
        const list = (res?.hits ?? []) as HitResult[];
        setResults(list);
        setCheckId(res?.checkId ?? null);
        setCheckedAt(new Date());
        setSearchedQueries(valid);
        setQueries((qs) => qs.map((q) => ({ ...q, editing: false })));
        setMarks({});
        setSubmitted(list.length === 0 ? "DIFFERENT" : null);
        setConclusion(list.length === 0 ? "DIFFERENT" : "PENDING");
        setNote("");
        toast.success(list.length ? `检索完成，命中 ${list.length} 条，请逐条判断` : "检索完成，系统未命中；未命中不等于人工确认无冲突");
        router.refresh();
      } catch (err) {
        toast.error("检索失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function mark(hit: HitResult, text: string) {
    const code = hit.matterInfo?.internalCode ?? hit.matchedName;
    setMarks((m) => ({ ...m, [hit.id]: text }));
    setNote((n) => {
      const line = `${code}：${text}`;
      const lines = n.split("\n").filter((l) => l.trim() && !l.startsWith(`${code}：`));
      return [...lines, line].join("\n");
    });
    if (text === "同一主体") setConclusion("SAME_SUBJECT");
  }

  function save(final: boolean) {
    if (!checkId) return;
    if (final && conclusion === "PENDING") {
      toast.warning("请选择检索结论");
      return;
    }
    if (final && hits.length > 0 && !note.trim()) {
      toast.warning("存在命中记录时，请填写判断说明");
      return;
    }
    startSaving(async () => {
      try {
        await setConflictConclusion({ checkId, conclusion: final ? conclusion : "PENDING", note: note.trim() });
        setSubmitted(final ? conclusion : null);
        toast.success(final ? "检索结论已提交并写入审计" : "草稿已保存");
        router.refresh();
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  const hasRun = results !== null;
  const stepState = (i: number) => {
    const reached = [queries.some((q) => q.name.trim() || q.idNumber.trim()), hasRun, hasRun, Boolean(submitted)];
    const current = reached.findIndex((r) => !r);
    if (reached[i] && !(i === 2 && !submitted)) return "done";
    return i === (current === -1 ? 3 : current) || (i === 2 && hasRun && !submitted) ? "current" : "";
  };

  return (
    <div className="mo-conflict">
      <PageHeader
        title="利益冲突检索"
        sub={
          <>
            检索结果将跨越案件可见性展示最小信息（系统编号、名称、主办、角色）。<b style={{ fontFamily: "inherit", color: "var(--t-primary)" }}>红色阻塞未得出人工结论前，对应收案不能提交审批。</b>
          </>
        }
        actions={
          <>
            <a href="#recent-checks" className="btn btn-secondary btn-sm">检索记录</a>
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
          {intake ? (
            <span className="id-chip">
              <ArrowDownToLine className="h-3 w-3" />
              自动携带自收案「{intake.title}」· {mmddhhmm(intake.receivedAt)}
            </span>
          ) : null}
        </div>

        {queries.map((q) => {
          const meta = roleMeta(q.role);
          const shown = revealed.has(q.key);
          return (
            <div key={q.key} className="subject">
              <div className="sub-logo" style={{ background: meta.logo }}>{(q.name || "?").trim().charAt(0) || "?"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {q.editing ? (
                  <div className="grid gap-2.5 md:grid-cols-[auto_1fr_1fr]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ROLE_OPTS.slice(0, 3).map((o) => (
                        <button key={o.value} type="button" aria-pressed={q.role === o.value} onClick={() => update(q.key, { role: o.value })} className={cn("badge cursor-pointer", q.role === o.value ? o.badge : "b-white")} style={{ height: 26, padding: "0 10px" }}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <input autoFocus={!q.name} value={q.name} onChange={(e) => update(q.key, { name: e.target.value })} placeholder="姓名 / 名称，如：华东置业集团有限公司" aria-label="主体名称" className="input" style={{ height: 32 }} />
                    <input value={q.idNumber} onChange={(e) => update(q.key, { idNumber: e.target.value })} placeholder="身份证 / 统一社会信用代码（精确匹配）" aria-label="证件号码" className="input font-mono" style={{ height: 32 }} />
                  </div>
                ) : (
                  <>
                    <div className="sub-name">
                      {q.name || <span className="t-faint">未填写名称</span>}
                      <span className={cn("badge", meta.badge)}>{meta.label}</span>
                      {q.fromIntake ? <span className="id-chip">收案自动带入</span> : null}
                    </div>
                    <div className="sub-fields">
                      <div className="sub-field">
                        <span className="k">{q.role === "CLIENT_PARTY" || q.name.includes("公司") ? "证件 / 信用代码" : "证件号码"}</span>
                        {q.idNumber ? (
                          <>
                            <span className={cn("v", !shown && "mask")}>{shown ? q.idNumber : mask(q.idNumber)}</span>
                            <button type="button" className="t-xs" style={{ color: "var(--teal-deep)" }} onClick={() => setRevealed((s) => { const n = new Set(s); if (n.has(q.key)) n.delete(q.key); else n.add(q.key); return n; })}>
                              {shown ? "打码" : "明文"}
                            </button>
                          </>
                        ) : (
                          <span className="t-xs t-faint">未登记 · 仅按名称检索，建议补全证件以精确比对</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(q.key, { editing: !q.editing })}>
                  {q.editing ? "完成" : "编辑身份"}
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
          <button type="button" className="btn btn-ghost btn-sm" style={{ border: "1px dashed var(--bd-default)", width: "100%", justifyContent: "center", height: 38 }} onClick={() => setQueries((qs) => [...qs, { key: newKey(), role: "OPPOSING_PARTY", name: "", idNumber: "", fromIntake: false, editing: true }])}>
            <Plus />
            添加检索主体（自然人 / 机构）
          </button>
        </div>

        <div className="run-bar" style={{ padding: "0 16px 16px" }}>
          <button type="button" className="btn btn-primary" onClick={run} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Search />}
            {hasRun ? "重新检索全部主体" : "检索全部主体"}
          </button>
          <span className="run-note">
            <Info className="h-3.5 w-3.5" />
            匹配范围：全部历史案件当事人 · 客户档案 · 收案线索
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {!hasRun ? (
            <div className="card">
              <div className="empty">
                <div className="empty-ic"><ShieldCheck /></div>
                <div className="mo-empty-title">填写检索主体后发起检索</div>
                <div className="mo-empty-desc">系统按名称与证件号码匹配全部历史案件当事人、客户档案与收案线索；命中结果按阻塞、需人工判断、未命中分级展示。</div>
              </div>
            </div>
          ) : (
            <>
              <div className="risk-strip" style={{ marginTop: 0 }}>
                <div className="card risk-cell" style={blocking.length ? { borderColor: "var(--red-line)" } : undefined}>
                  <div className="risk-ic" style={{ background: "var(--red-bg)", color: "var(--red)" }}><TriangleAlert /></div>
                  <div><div className="rn" style={{ color: blocking.length ? "var(--red)" : "var(--t-faint)" }}>{blocking.length}</div><div className="rl">阻塞 BLOCKING</div></div>
                </div>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><Info /></div>
                  <div><div className="rn" style={{ color: review.length ? "var(--amber)" : "var(--t-faint)" }}>{review.length}</div><div className="rl">需人工判断</div></div>
                </div>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--slate-bg)", color: "var(--slate)" }}><CircleMinus /></div>
                  <div><div className="rn" style={{ color: "var(--slate)" }}>{noHitSubjects.length}</div><div className="rl">未命中</div></div>
                </div>
                <div className="card risk-cell">
                  <div className="risk-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)" }}><SquareCheck /></div>
                  <div><div className="rn">{markedCount}</div><div className="rl">已逐条判断</div></div>
                </div>
              </div>

              {[...blocking, ...review].map((h) => {
                const m = h.matterInfo;
                const isBlocking = h.severity === "BLOCKING";
                const href = m?.canViewMatter && m.matterId ? matterHref({ id: m.matterId, internalCode: m.internalCode }) : null;
                const roleText = m ? (m.partyStanding ? litigationStandingLabel[m.partyStanding] : HIT_ROLE[m.partyRole] ?? "当事人") : null;
                return (
                  <div key={h.id} className={cn("card hit-card", isBlocking ? "blocking" : "medium")}>
                    <div className="hit-head">
                      <span className={cn("badge shrink-0", isBlocking ? "b-red" : h.severity === "LOW" ? "b-slate" : "b-amber")}>
                        <span className="bdot" />
                        {isBlocking ? "阻塞 BLOCKING" : h.severity === "LOW" ? "低风险提示" : "需人工判断"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="hit-title truncate">{m ? `${m.internalCode} · ${m.title}` : h.matchedName}</div>
                        <div className="hit-meta flex-wrap">
                          {m ? (
                            <>
                              历史案件 · 主办 {m.ownerName ?? "—"}
                              {m.intakeDate ? ` · 收案 ${m.intakeDate.slice(0, 10)}` : ""} · 命中主体「{h.matchedName}」在该案为<b style={{ color: "var(--t-secondary)" }}>{roleText}</b>
                            </>
                          ) : (
                            "关联档案无法核实，请根据命中理由联系经办人员"
                          )}
                        </div>
                      </div>
                      {marks[h.id] ? <span className="badge b-teal shrink-0">已判断：{marks[h.id]}</span> : null}
                    </div>
                    <div className="hit-match">
                      <span className="m-label">命中依据</span>
                      <span className="m-body">
                        {h.reason}
                        <span className="ml-2 rounded-[4px] bg-[var(--bg-sunken)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--t-muted)]">
                          {h.matchedField === "idNumber" ? "证件" : "名称"}：{h.matchedField === "idNumber" ? mask(h.matchedValue) : h.matchedValue}
                        </span>
                      </span>
                    </div>
                    <div className="hit-foot flex-wrap">
                      {isBlocking ? (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => mark(h, "同一主体")}>标记为同一主体</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => mark(h, "不同主体")}>标记为不同主体</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(h, "需要更多信息")}>需要更多信息</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => mark(h, "需补充证件后重新比对")}>补充证件后重新比对</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark(h, "不同主体")}>标记为不同主体</button>
                        </>
                      )}
                      {href ? (
                        <Link href={href} className="btn btn-ghost btn-sm">查看案件</Link>
                      ) : (
                        <span className="hint">
                          <Info className="h-3 w-3" />
                          冲突检索不开放案件正文，请联系主办核实
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="card">
                <div className="panel-head">
                  <div className="panel-title" style={{ fontSize: 13 }}>
                    未命中主体 <span className="t-xs t-mute" style={{ fontWeight: 500 }}>{noHitSubjects.length}</span>
                  </div>
                </div>
                {noHitSubjects.length === 0 ? (
                  <div className="nomatch-row t-xs t-mute">全部检索主体在检索范围内均有命中记录。</div>
                ) : (
                  noHitSubjects.map((q) => (
                    <div key={q.key} className="nomatch-row">
                      <span className="dot dot-slate" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {q.name || mask(q.idNumber)}（{roleMeta(q.role).label}）
                        </div>
                        <div className="t-xs t-mute" style={{ marginTop: 1 }}>全部历史案件及客户档案未命中</div>
                      </div>
                      <span className="badge b-white">未命中</span>
                    </div>
                  ))
                )}
                <div className="disclaimer">
                  <Info className="h-3.5 w-3.5 shrink-0" style={{ marginTop: 2 }} />
                  <span>未命中仅表示系统检索范围内无匹配记录，<b>不构成人工确认无冲突</b>。最终结论以人工判断为准，并随审计留痕。</span>
                </div>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <div className="panel-head">
                  <div className="panel-title">
                    <SquareCheck className="ic" />
                    检索结论 <span className="t-xs t-mute" style={{ fontWeight: 500, marginLeft: 4 }}>提交后与审计同事务留痕</span>
                  </div>
                  {submitted ? (
                    <span className="badge b-teal">已提交 · {CONCLUSION_LABEL[submitted]}{hits.length === 0 && submitted === "DIFFERENT" && !note ? "（系统未命中）" : ""}</span>
                  ) : (
                    <span className="badge b-amber">待结论{intake ? ` · 收案「${intake.title}」暂停送审` : ""}</span>
                  )}
                </div>
                <div className="panel-body">
                  {CONCLUSIONS.map((c, i) => (
                    <button key={c.value} type="button" role="radio" aria-checked={conclusion === c.value} onClick={() => setConclusion(c.value)} className={cn("concl-opt w-full bg-transparent text-left font-[inherit]", conclusion === c.value && "sel")} style={i === CONCLUSIONS.length - 1 ? { marginBottom: 12 } : undefined}>
                      <span className="radio" />
                      <div>
                        <div className="t">{c.title}</div>
                        <div className="d">{c.desc}</div>
                      </div>
                    </button>
                  ))}
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={4}
                    aria-label="判断说明"
                    placeholder={hits.length ? "判断说明：逐条说明对命中记录的判断理由（点击上方命中卡的标记按钮可自动写入）" : "判断说明（可选）：系统未命中时仍建议记录人工核对的范围，如别名、关联公司"}
                    className="input mb-3.5 block w-full resize-y py-2.5 leading-[1.7]"
                    style={{ height: "auto" }}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => save(false)} disabled={saving || !checkId}>保存草稿</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => save(true)} disabled={saving || !checkId}>
                      {saving ? <Loader2 className="animate-spin" /> : null}
                      提交检索结论
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="card">
            <div className="panel-head">
              <div className="panel-title" style={{ fontSize: 13 }}>本次检索</div>
              {checkedAt ? <span className="badge b-teal" style={{ fontSize: 10 }}>{mmddhhmm(checkedAt)}</span> : <span className="badge b-white" style={{ fontSize: 10 }}>未开始</span>}
            </div>
            <div className="panel-body" style={{ paddingTop: 10 }}>
              <div className="timeline">
                {[
                  { t: "主体身份核对", d: `${queries.filter((q) => q.name || q.idNumber).length} 个主体 · 证件已登记 ${queries.filter((q) => q.idNumber).length} 个` },
                  { t: "系统检索完成", d: hasRun ? `命中 ${hits.length} 项` : "尚未检索" },
                  { t: "等待人工结论", d: hasRun ? (submitted ? "已给出结论" : `已逐条判断 ${markedCount} / ${hits.length}`) : "—" },
                  { t: "结论提交 · 送审", d: submitted ? CONCLUSION_LABEL[submitted] : "" }
                ].map((s, i) => {
                  const st = stepState(i);
                  return (
                    <div key={s.t} className={cn("tl-item", st)}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: st ? undefined : "var(--t-faint)" }}>{s.t}</div>
                      {s.d ? <div className="t-xs t-mute" style={{ marginTop: 2 }}>{s.d}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card" id="recent-checks">
            <div className="panel-head">
              <div className="panel-title" style={{ fontSize: 13 }}>既往检索记录</div>
              <span className="t-xs t-faint">仅本人发起</span>
            </div>
            <div className="panel-body" style={{ paddingTop: 8 }}>
              {recent.length === 0 ? (
                <div className="t-xs t-mute py-2">暂无检索记录</div>
              ) : (
                recent.map((r, i) => (
                  <div key={r.id} style={{ display: "flex", gap: 9, padding: "7px 0", borderBottom: i === recent.length - 1 ? undefined : "1px solid var(--bd-hair)" }}>
                    <span className={cn("dot", r.conclusion === "SAME_SUBJECT" ? "dot-red" : r.conclusion === "DIFFERENT" ? "dot-green" : r.conclusion === "NEED_INFO" ? "dot-amber" : r.hitCount ? "dot-red" : "dot-slate")} style={{ marginTop: 5 }} />
                    <div className="min-w-0">
                      <div className="truncate" style={{ fontSize: 12, fontWeight: 550 }}>
                        {mmddhhmm(r.checkedAt)} · {r.intake ? (
                          <Link href={`/intakes/${r.intake.id}`} className="hover:underline">收案「{r.intake.title}」</Link>
                        ) : (
                          r.subjectSummary || "独立检索"
                        )}
                      </div>
                      <div className="t-xs t-mute">
                        {r.runnerName} · {r.hitCount ? `命中 ${r.hitCount}` : "未命中"} · {CONCLUSION_LABEL[r.conclusion as Conclusion] ?? r.conclusion}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="side-note">
            <ShieldAlert />
            <span>
              检索最小披露：<b>编号、名称、主办律师、当事人角色</b>。案件正文与材料不因冲突检索开放。每次检索与结论均写入审计日志。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
