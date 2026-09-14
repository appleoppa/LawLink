import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import type { getMatterById } from "@/server/matters/actions";
import { listNotes } from "@/server/notes/actions";
import { matterStatusLabel, matterCategoryLabel, procedureTypeLabel, litigationStandingLabel } from "@/lib/enums";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

type Matter = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
function date(value: Date | null) { return value ? formatDate(new Date(value)) : "未填写"; }

/** Read-only team view deliberately fetches no finance or private attachment payloads. */
export async function TeamMatterOverview({ matter }: { matter: Matter }) {
  const notes = await listNotes(matter.id);
  return <div className="space-y-5">
    <Link href="/matters" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />返回案件列表</Link>
    <header className="ll-hero-surface space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{matterCategoryLabel[matter.category]}</span><span>{matter.internalCode}</span><Badge variant="secondary">{matterStatusLabel[matter.status]}</Badge></div>
      <h1 className="text-xl font-semibold tracking-tight">{matter.title}</h1>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Eye className="h-4 w-4" />团队查看 · 可查看案件信息和进展</p>
    </header>
    <section className="ll-surface space-y-4 p-5"><h2 className="font-semibold">案件信息</h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="主办律师" value={matter.owner.name} /><Field label="原始立案人" value={matter.registeredBy?.name ?? "历史记录未确认"} /><Field label="客户" value={matter.primaryClient?.name} />
        <Field label="收案日期" value={date(matter.intakeDate)} /><Field label="所内案号" value={matter.firmCaseNo} />
        <Field label="案由" value={matter.cause?.name ?? matter.causeFreeText} />
        <Field label="标的额" value={matter.claimAmount == null ? null : `${Number(matter.claimAmount).toLocaleString("zh-CN")} 元`} />
        <Field label="承办人员" value={matter.members.map((m) => `${m.user.name}（${m.role === "LEAD" ? "主办" : m.role === "CO_LEAD" ? "协办" : "助理"}）`).join("、")} />
      </dl>
    </section>
    <section className="ll-surface space-y-3 p-5"><h2 className="font-semibold">当事人</h2>
      {matter.parties.length === 0 ? <Empty /> : matter.parties.map((party) => <div key={party.id} className="flex flex-wrap gap-3 text-sm"><span className="font-medium">{party.name}</span><span className="text-muted-foreground">{party.standing ? litigationStandingLabel[party.standing] : party.role === "CLIENT_PARTY" ? "委托方" : party.role === "OPPOSING_PARTY" ? "相对方" : "其他当事人"}</span></div>)}
    </section>
    <section className="space-y-3"><h2 className="font-semibold">程序、开庭与期限</h2>
      {matter.procedures.length === 0 ? <Empty /> : matter.procedures.map((proc) => <article key={proc.id} className="ll-surface space-y-3 p-5">
        <h3 className="font-medium">{proc.customLabel ?? procedureTypeLabel[proc.type]} <span className="ml-2 text-sm font-normal text-muted-foreground">{proc.caseNumber}</span></h3>
        <p className="text-sm text-muted-foreground">{proc.handlingAgency ?? "未填写办理机构"}</p>
        {proc.hearings.map((h) => <p key={h.id} className="text-sm">开庭：{date(h.startsAt)} {new Date(h.startsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</p>)}
        {proc.deadlines.map((d) => <p key={d.id} className="text-sm">{d.completed ? "已完成" : "待办期限"}：{d.title} · {date(d.dueAt)}</p>)}
        {proc.stages.map((stage) => <div key={stage.id} className="border-t pt-3"><p className="text-sm font-medium">{stage.name}</p>{stage.tasks.map((task) => <p key={task.id} className="mt-1 text-sm text-muted-foreground">{task.completed ? "已完成" : "待办"}：{task.title}{task.dueAt ? ` · ${date(task.dueAt)}` : ""}</p>)}</div>)}
      </article>)}
    </section>
    <section className="ll-surface space-y-4 p-5"><h2 className="font-semibold">沟通与办案记录</h2>
      {notes.length === 0 ? <Empty /> : notes.map((note) => <article key={note.id} className="space-y-2 border-b pb-4 last:border-0 last:pb-0"><p className="text-xs text-muted-foreground">{note.author.name} · {date(note.occurredAt)}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{note.content}</p></article>)}
    </section>
    <section className="ll-surface space-y-3 p-5"><h2 className="font-semibold">案件进展</h2>{matter.timelineEvents.map((event) => <p key={event.id} className="text-sm"><span className="mr-3 text-muted-foreground">{date(event.occurredAt)}</span>{event.title}</p>)}</section>
    <p className="text-xs text-muted-foreground">财务、材料下载和业务操作按案件经办权限开放。</p>
  </div>;
}
function Field({ label, value }: { label: string; value?: string | null }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value || "未填写"}</dd></div>; }
function Empty() { return <p className="text-sm text-muted-foreground">暂无记录</p>; }
