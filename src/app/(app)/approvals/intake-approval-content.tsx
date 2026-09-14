"use client";

import { useState } from "react";
import { AlertTriangle, FileText, Scale, Users, Wallet, Building2, BriefcaseBusiness, ChevronRight } from "lucide-react";
import styles from "./intake-approval.module.css";
import { Badge } from "@/components/ui/badge";
import { conflictMatchKind, conflictMatchKinds, conflictMatchedFieldLabel, conflictPartyRoleLabel, conflictSeverityLabel, type IntakeReviewField } from "@/lib/approvals/intake-detail";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";
import { formatDateTime } from "@/lib/utils";

type Detail = NonNullable<Awaited<ReturnType<typeof getApprovalDetail>>["intakeDetail"]>;
const dateText = (date: Date | string | null) => date ? formatDateTime(date) : "未记录";
const roleText = (role: string) => conflictPartyRoleLabel[role as keyof typeof conflictPartyRoleLabel] ?? null;

export function IntakeReviewValue({ label, value, sensitive }: IntakeReviewField) {
  const [revealed, setRevealed] = useState(false);
  const masked = sensitive && value !== "未填写" && value !== "未记录" && value !== "";
  return <span className="whitespace-pre-wrap break-words">
    {masked && !revealed ? "••••••" : value}
    {masked && <button type="button" className="ml-1.5 text-[11.5px] font-[550] text-[var(--teal-deep)]" aria-label={`${revealed ? "隐藏" : "显示"}${label}`} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "隐藏" : "明文"}</button>}
  </span>;
}

const keyFields = new Set(["案件名称", "案件类别", "案由", "主办律师", "首个程序 / 审级", "委托方诉讼地位", "办理机构", "管辖地", "标的金额（元）", "委托方", "姓名 / 名称", "本案角色", "诉讼地位", "收费方式", "收费金额（元）", "基础办案费（元）"]);

export function IntakeApprovalContent({ detail, view = "all", onOpenConflicts }: { detail: Detail; view?: "all" | "overview" | "conflicts"; onOpenConflicts?: () => void }) {
  const latest = detail.checks[0];
  return <div>
    {view !== "conflicts" && detail.sections.map((section) => {
      const empty = section.fields.filter(f => f.value === "未填写" && !keyFields.has(f.label));
      const visible = section.fields.filter(f => !empty.includes(f));
      const party = section.title.startsWith("当事人 ");
      const Icon = party ? Users : section.title.includes("收费") ? Wallet : section.title.includes("程序") ? Scale : section.title.includes("委托方") ? Building2 : section.title.includes("顾问") ? BriefcaseBusiness : FileText;
      const rows = (items: IntakeReviewField[]) => items.map(f => <div key={f.label} className="arow"><span className="k">{f.label}</span><span className={`v min-w-0 break-words ${f.value === "未填写" ? "t-faint" : ""}`}><IntakeReviewValue {...f} /></span></div>);
      return <section key={section.title} className="rv-section">
        <div className="rv-sec-head"><Icon className="h-[14px] w-[14px] text-[var(--teal)]" />{section.title}{party && <span className="badge b-white" style={{ fontSize: 10 }}>{section.fields.find(f => f.label === "本案角色")?.value}</span>}</div>
        {section.note && <div className="arow"><span className="v t-xs t-mute">{section.note}</span></div>}
        {rows(visible)}
        {!!empty.length && <details className={styles.emptyFields}><summary className="arow fold"><span className="k">未填写项</span><span className="v">查看未填写项 {empty.length}</span></summary>{rows(empty)}</details>}
      </section>;
    })}
    {view === "overview" && <section className="rv-section">
      <div className="rv-sec-head"><AlertTriangle className="h-[14px] w-[14px] text-[var(--red)]" />冲突核查摘要{onOpenConflicts && <button type="button" onClick={onOpenConflicts} className="ml-auto text-[11px] font-[550] text-[var(--teal-deep)]">查看完整检索记录 →</button>}</div>
      <div className="conf-sum">
        <div className="cs-ic" style={!latest || latest.hits.length ? undefined : { background: "var(--green-bg)", color: "var(--green)" }}><AlertTriangle /></div>
        <div style={{ flex: 1 }}>
          <div className="cs-t">{!latest ? "尚未进行冲突检索" : latest.hits.length ? conflictMatchKinds.map(k => ({ k, n: latest.hits.filter(h => conflictMatchKind(h) === k.key).length })).filter(x => x.n).map(x => `${x.k.label} × ${x.n}`).join(" · ") : "系统检索未命中"}</div>
          <div className="cs-d">{!latest ? "当前没有可供核查的检索记录，请退回补正或要求重新检索。" : `最近一次检索 ${dateText(latest.checkedAt)} · 当前结论「${latest.conclusion}」${latest.coversCurrentParties ? "" : " · 检索资料不完整，请重新检索"}。未命中不等于人工确认无冲突。`}</div>
        </div>
        {onOpenConflicts && <ChevronRight className="h-4 w-4 text-[var(--t-faint)]" />}
      </div>
    </section>}
    {view !== "overview" && <section className="rv-section">
      <div className="rv-sec-head"><AlertTriangle className="h-[14px] w-[14px] text-[var(--red)]" />利益冲突核查详情<span className="t-xs t-mute ml-auto font-normal">系统提示不能代替审批判断</span></div>
      <div className="panel-body space-y-4">
      {!detail.checks.length && <p className="rounded-lg border border-[var(--amber-line)] bg-[var(--amber-bg)] p-3 text-sm">尚未运行利益冲突检索，当前没有可供核查的检索记录。</p>}
      {detail.checks.map((check, index) => <details key={check.id} open={index === 0} className={styles.check}>
        <summary className="cursor-pointer text-sm font-medium">{index === 0 ? "最近一次检索" : "历史检索"} · {dateText(check.checkedAt)} · 检索结果 {check.hits.length} 条</summary>
        <div className="mt-4 space-y-4">
          <ConflictResults hits={check.hits} />
          {!check.coversCurrentParties && <p className="rounded-md bg-[var(--amber-bg)] p-3 text-sm text-[var(--amber)]">检索资料不完整或当事人已变更，请重新检索后提交审批。</p>}
          <div className={styles.checkConclusion}><div><span>当前保存结论</span><strong>{check.conclusion}</strong></div><div><span>结论来源</span><strong>{check.source}</strong></div>{check.decidedBy && <p>结论记录人：{check.decidedBy} · {dateText(check.decidedAt)}</p>}<p>说明：{check.note || "未记录"}</p></div>
          <div className="space-y-2"><h4 className="text-sm font-medium">本案核查对象</h4>
            <div className={styles.queries}>{detail.currentParties.map((q, i) => <div key={i}><Badge variant="outline">{roleText(q.role)}</Badge><strong>{q.name || "未填写名称"}</strong><p>证件条件：<IntakeReviewValue label={`本案当事人 ${i + 1} 的证件条件`} value={q.idNumber || "未填写"} /></p></div>)}</div>
          </div>
          <details className={styles.emptyFields}><summary>查看本次检索条件</summary>
            {!check.queries.length && <p className="mt-2 text-sm text-muted-foreground">检索条件不完整，请重新检索。</p>}
            <div className={styles.queries}>{check.queries.map((q, i) => <div key={i}>{roleText(q.role) && <Badge variant="outline">{roleText(q.role)}</Badge>}<strong>{q.name || "未填写名称"}</strong><p>证件条件：<IntakeReviewValue label={`检索对象 ${i + 1} 的证件条件`} value={q.idNumber || "未填写"} /></p></div>)}</div>
          </details>
          {!!check.sameNameClients.length && <div className="text-sm"><h4 className="font-medium">历史客户库同名提示（不等同利益冲突）</h4>{check.sameNameClients.map((c, i) => <p key={i}>{c.name || "姓名未记录"}</p>)}</div>}
          {!!check.idMatchedClients.length && <div className="text-sm"><h4 className="font-medium">历史客户库证件匹配提示（需核对主体身份）</h4>{check.idMatchedClients.map((c, i) => <p key={i}>{c.name} · <IntakeReviewValue label="客户库匹配证件" value={c.idNumber || "未记录"} /></p>)}</div>}
        </div>
      </details>)}
      </div>
    </section>}
  </div>;
}

function ConflictResults({ hits }: { hits: Detail["checks"][number]["hits"] }) {
  const groups = conflictMatchKinds.map(kind => ({ ...kind, hits: hits.filter(hit => conflictMatchKind(hit) === kind.key) }));
  return <section className="space-y-4" aria-label="具体检索结果">
    <div className={styles.resultCounts}>{groups.filter(group => group.key !== "other" || group.hits.length).map(group => <div key={group.key}><span>{group.label}</span><strong>{group.hits.length}<small> 条</small></strong></div>)}</div>
    <p className="text-xs leading-relaxed text-muted-foreground">以下为当次保存的匹配记录，数量不等于主体数或已确认的冲突数；关联案件摘要为当前档案信息。</p>
    {!hits.length && <p className={styles.noMatches}>本次未命中历史案件；仍需人工核对名称别名、主体身份及尚未录入的代理关系。</p>}
    {groups.filter(group => group.hits.length).map(group => <section key={group.key} className="space-y-3" aria-label={`${group.label}结果`}>
      <h4 className={styles.resultHeading}>{group.label}<Badge variant="secondary">{group.hits.length} 条</Badge></h4>
      {group.hits.map(hit => <article key={hit.id} className={styles.hit}>
        <div className={styles.matchComparison}>
          <div><span>检索条件 · {conflictMatchedFieldLabel[hit.matchedField] ?? "历史匹配字段"}</span><strong><IntakeReviewValue label="命中值" value={hit.matchedValue || "未记录"} sensitive={hit.matchedField !== "name"} /></strong></div>
          <div><span>检索命中名称</span><strong>{hit.matchedName || "名称未记录"}</strong></div>
        </div>
        {hit.matter ? <div className={styles.matchedMatter}><span>关联案件 · 当前档案</span><strong>{hit.matter.code} · {hit.matter.title}</strong><div><p>主办律师：{hit.matter.ownerName}</p><p>命中主体在该案的角色：{hit.matter.roles}</p></div></div> : <p className="text-muted-foreground">关联档案无法核实，请根据原命中理由联系经办人员核查。</p>}
        <div className={styles.matchReason}><span>当次检索依据</span><p className="whitespace-pre-wrap break-words">{hit.reason || "历史记录未保存命中理由"}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={hit.severity === "BLOCKING" || hit.severity === "HIGH" ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]"}>系统提示 · {conflictSeverityLabel[hit.severity]}</Badge>
          {group.key === "similar" && hit.matchedRatio != null && <span className="text-muted-foreground">名称匹配比例 {(hit.matchedRatio * 100).toFixed(0)}% · 不代表同一主体概率</span>}
        </div>
      </article>)}
    </section>)}
  </section>;
}
