"use client";

/** 墨案 02「待我处理」：审批 / 任务 / 提醒 分段（提醒=保全到期与法院短信，原工作台告警不丢失） */
import { useState } from "react";
import Link from "next/link";
import type { ApprovalAction } from "@prisma/client";
import { AlertTriangle, ListChecks, SquareCheck, Stamp } from "lucide-react";
import { ACTION_LABELS } from "@/lib/approvals/rules";
import { approvalHref } from "@/lib/approvals/workspace";
import { matterHref } from "@/lib/matters/route";
import { cn } from "@/lib/utils";
import type { WorkQueue } from "@/server/dashboard/actions";
import type { AlertItem } from "./alerts-list";
import { shParts } from "@/lib/ui/sh-time";

type Seg = "approvals" | "tasks" | "alerts";

export function WorkQueueCard({ queue, alerts }: { queue: WorkQueue; alerts: AlertItem[] }) {
  const reminders = alerts.filter((a) => a.source !== "approval");
  const [seg, setSeg] = useState<Seg>(queue.approvalTotal > 0 || (queue.taskTotal === 0 && reminders.length === 0) ? "approvals" : queue.taskTotal > 0 ? "tasks" : "alerts");
  const items: [Seg, string, number][] = [
    ["approvals", "审批", queue.approvalTotal],
    ["tasks", "任务", queue.taskTotal],
    ["alerts", "提醒", reminders.length]
  ];
  const fmt = (d: Date | null) => (d ? `${shParts(d).m}月${shParts(d).d}日` : "");

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="panel-head">
        <div className="panel-title">
          <SquareCheck className="ic" strokeWidth={1.8} />
          待我处理
        </div>
        <div className="segmented" style={{ padding: 2 }} role="tablist">
          {items.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={seg === k} className={cn("seg", seg === k && "active")} style={{ padding: "4px 11px", fontSize: 11.5 }} onClick={() => setSeg(k)}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {seg === "approvals" ? (
          queue.approvals.length === 0 ? (
            <div className="empty mo-empty-compact"><div className="empty-ic"><SquareCheck /></div><div className="mo-empty-title">暂无待你审批的申请</div></div>
          ) : (
            queue.approvals.map((a) => {
              const urgent = a.waitDays >= 2;
              return (
                <Link key={a.action + a.id} href={approvalHref(a.action as ApprovalAction, a.id)} className="todo-item">
                  <span className={cn("type-ic", urgent ? "t-red" : "t-bronze")} aria-hidden>
                    <Stamp strokeWidth={2} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="todo-title truncate">{ACTION_LABELS[a.action as ApprovalAction]} · {a.title}</div>
                    <div className="todo-meta">
                      <span>申请人 {a.requester}</span>
                      {a.matter ? (<><span className="todo-sep" /><span className="truncate">{a.matter}</span></>) : null}
                      <span className="todo-sep" />
                      <span>{a.task === "issue" ? "待开票" : a.task === "stamp" ? "待盖章回填" : "待审批"}</span>
                    </div>
                  </div>
                  <span className={cn("due-pill", urgent && "d-red")}>{a.waitDays > 0 ? `等待 ${a.waitDays} 天` : "今日"}</span>
                </Link>
              );
            })
          )
        ) : null}

        {seg === "tasks" ? (
          queue.tasks.length === 0 ? (
            <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无指派给你的未完成任务</div></div>
          ) : (
            queue.tasks.map((t) => (
              <Link key={t.id} href={matterHref({ id: t.matterId, internalCode: t.matterCode })} className="todo-item">
                <span className={cn("type-ic", t.overdue ? "t-red" : "t-teal")} aria-hidden>
                  <ListChecks strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="todo-title truncate">{t.title}</div>
                  <div className="todo-meta">
                    <span className="code">{t.matterCode}</span>
                    <span className="todo-sep" />
                    <span className="truncate">{t.matterTitle}</span>
                    {t.dueAt ? (<><span className="todo-sep" /><span>{fmt(t.dueAt)} 截止</span></>) : null}
                    {t.priority >= 2 ? (<><span className="todo-sep" /><span>紧急</span></>) : null}
                  </div>
                </div>
                <span className={cn("due-pill", t.overdue ? "d-red" : t.priority >= 2 ? "d-amber" : undefined)}>{t.overdue ? "已逾期" : t.dueAt ? fmt(t.dueAt) : "无期限"}</span>
              </Link>
            ))
          )
        ) : null}

        {seg === "alerts" ? (
          reminders.length === 0 ? (
            <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无保全到期与法院短信提醒</div></div>
          ) : (
            reminders.map((a) => (
              <Link key={a.id} href={a.href} className="todo-item">
                <span className={cn("type-ic", a.tone === "danger" ? "t-red" : a.tone === "warn" ? "t-amber" : "t-slate")} aria-hidden>
                  <AlertTriangle strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="todo-title truncate">{a.title}</div>
                  <div className="todo-meta"><span className="truncate">{a.detail}</span></div>
                </div>
                <span className={cn("due-pill", a.tone === "danger" ? "d-red" : a.tone === "warn" ? "d-amber" : undefined)}>{a.source === "sms" ? "法院短信" : "保全"}</span>
              </Link>
            ))
          )
        ) : null}
      </div>

      <div className="panel-foot" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="t-xs t-mute">
          {seg === "approvals" ? `共 ${queue.approvalTotal} 件审批 · ${queue.taskTotal} 项任务` : seg === "tasks" ? `共 ${queue.taskTotal} 项任务，逾期任务优先` : "保全到期 · 法院短信"}
        </span>
        <Link href={seg === "approvals" ? "/approvals" : seg === "tasks" ? "/schedule?view=list" : "/inbox"} className="t-sm" style={{ color: "var(--teal-deep)", fontWeight: 550 }}>
          {seg === "approvals" ? "进入审批工作台 →" : seg === "tasks" ? "查看日程 →" : "进入法院短信 →"}
        </Link>
      </div>
    </div>
  );
}
