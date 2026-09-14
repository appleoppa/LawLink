import Link from "next/link";
import { CalendarClock, ChevronLeft, Eye, FileText, Users } from "lucide-react";
import type { getMatterById } from "@/server/matters/actions";
import { listNotes } from "@/server/notes/actions";
import { matterStatusLabel, matterCategoryLabel, procedureTypeLabel, litigationStandingLabel } from "@/lib/enums";
import { matterStatusTone } from "@/lib/ui/moan-tones";
import { FieldGrid, FieldItem, Panel, ProcedureChain, type ChainNode } from "@/components/patterns/moan";
import { formatDate, formatDateTime } from "@/lib/utils";

type Matter = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
const date = (value: Date | null) => (value ? formatDate(new Date(value)) : "—");

/**
 * 团队只读视图（墨案 04 结构的只读版）：上下文头 + 信息 + 程序链与期限 + 记录。
 * 刻意不加载财务与私有附件，业务操作按案件经办权限开放。
 */
export async function TeamMatterOverview({ matter }: { matter: Matter }) {
  const notes = await listNotes(matter.id);
  const roleText = (role: string) => (role === "LEAD" ? "主办" : role === "CO_LEAD" ? "协办" : "助理");

  return (
    <div className="mo-matter space-y-3.5">
      <div className="card ctx-head">
        <Link href="/matters" className="ctx-back">
          <ChevronLeft className="h-3.5 w-3.5" />
          返回案件列表
        </Link>
        <h1 className="ctx-title">{matter.title}</h1>
        <div className="ctx-code">{[matter.internalCode, matter.firmCaseNo ? `所内编号 ${matter.firmCaseNo}` : null].filter(Boolean).join(" · ")}</div>
        <div className="ctx-badges">
          <span className="badge b-white">{matterCategoryLabel[matter.category]}</span>
          <span className={`badge b-${matterStatusTone(matter.status)}`}>
            <span className="bdot" />
            {matterStatusLabel[matter.status]}
          </span>
          <span className="badge b-slate">
            <Eye className="h-3 w-3" />
            团队只读
          </span>
        </div>
        <div className="ctx-meta">
          {[
            ["委托方", matter.primaryClient?.name],
            ["主办", matter.owner.name],
            ["收案", date(matter.intakeDate)],
            ["案由", matter.cause?.name ?? matter.causeFreeText],
            ["标的额", matter.claimAmount == null ? null : `¥${Number(matter.claimAmount).toLocaleString("zh-CN")}`]
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="m">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3.5">
          {matter.procedures.length === 0 ? (
            <Panel title="程序、开庭与期限" icon={CalendarClock}>
              <p className="t-xs t-mute">尚未创建程序</p>
            </Panel>
          ) : (
            matter.procedures.map((proc) => {
              const doneIdx = proc.stages.filter((s) => s.completedAt).length;
              const nodes: ChainNode[] = proc.stages.map((s, i) => ({
                key: s.id,
                label: s.name,
                date: s.startedAt ? formatDate(s.startedAt).slice(5) : null,
                state: s.completedAt ? "done" : i === doneIdx && proc.status !== "CONCLUDED" ? "current" : "todo"
              }));
              const upcoming = [
                ...proc.hearings.map((h) => ({ id: h.id, at: h.startsAt, text: `开庭 · ${h.title}`, done: false })),
                ...proc.deadlines.map((d) => ({ id: d.id, at: d.dueAt, text: d.title, done: d.completed }))
              ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
              return (
                <Panel
                  key={proc.id}
                  title={
                    <>
                      {proc.customLabel ?? procedureTypeLabel[proc.type]}
                      {proc.caseNumber ? <span className="ml-2 font-mono text-[11.5px] font-normal text-[var(--t-muted)]">{proc.caseNumber}</span> : null}
                    </>
                  }
                  icon={CalendarClock}
                  extra={proc.handlingAgency ? <span className="t-xs t-mute">{proc.handlingAgency}</span> : null}
                >
                  {nodes.length > 0 ? <ProcedureChain nodes={nodes} /> : null}
                  <div className="mt-3 space-y-1.5">
                    {upcoming.length === 0 ? (
                      <p className="t-xs t-mute">暂无开庭与期限</p>
                    ) : (
                      upcoming.map((u) => (
                        <div key={u.id} className="flex items-center gap-3 text-[12.5px]">
                          <span className="w-[120px] shrink-0 font-mono text-[12px] text-[var(--t-secondary)]">{formatDateTime(u.at)}</span>
                          <span className={u.done ? "t-mute line-through" : ""}>{u.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              );
            })
          )}

          <Panel title="沟通与办案记录" icon={FileText} count={notes.length}>
            {notes.length === 0 ? (
              <p className="t-xs t-mute">暂无记录</p>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="border-b border-[var(--bd-hair)] pb-3 last:border-0 last:pb-0">
                    <div className="t-xs t-mute">
                      {note.author.name} · {formatDateTime(note.occurredAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="案件进展">
            {matter.timelineEvents.length === 0 ? (
              <p className="t-xs t-mute">暂无进展</p>
            ) : (
              <div className="timeline">
                {matter.timelineEvents.map((event) => (
                  <div key={event.id} className="tl-item">
                    <div className="text-[12.5px] font-medium">{event.title}</div>
                    <div className="t-xs t-mute">{date(event.occurredAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-3.5">
          <Panel title="团队" icon={Users}>
            <FieldGrid cols={1}>
              <FieldItem label="原始立案人">{matter.registeredBy?.name ?? "历史记录未确认"}</FieldItem>
              {matter.members.map((m) => (
                <FieldItem key={m.userId} label={roleText(m.role)}>{m.user.name}</FieldItem>
              ))}
            </FieldGrid>
          </Panel>
          <Panel title="当事人" count={matter.parties.length}>
            {matter.parties.length === 0 ? (
              <p className="t-xs t-mute">暂无当事人</p>
            ) : (
              <div className="space-y-2">
                {matter.parties.map((party) => (
                  <div key={party.id}>
                    <div className="t-xs t-mute">{party.standing ? litigationStandingLabel[party.standing] : party.role === "CLIENT_PARTY" ? "委托方" : party.role === "OPPOSING_PARTY" ? "相对方" : "其他当事人"}</div>
                    <div className="text-[13px] font-semibold">{party.name}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <p className="t-xs t-mute px-1">团队只读视图：财务、材料下载和业务操作按案件经办权限开放。</p>
        </div>
      </div>
    </div>
  );
}
