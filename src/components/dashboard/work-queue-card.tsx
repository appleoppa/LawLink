"use client";

/** 墨案 02「待我处理」：审批 / 任务 / 提醒 分段（提醒=保全到期与法院短信，原工作台告警不丢失） */
import { useState } from "react";
import Link from "next/link";
import type { ApprovalAction } from "@prisma/client";
import { SquareCheck } from "lucide-react";
import { ACTION_LABELS } from "@/lib/approvals/rules";
import { approvalHref } from "@/lib/approvals/workspace";
import { matterHref } from "@/lib/matters/route";
import { approvalActionTone } from "@/lib/ui/moan-tones";
import { cn } from "@/lib/utils";
import type { WorkQueue } from "@/server/dashboard/actions";
import type { AlertItem } from "./alerts-list";

type Seg = "approvals" | "tasks" | "alerts";

export function WorkQueueCard({ queue, alerts }: { queue: WorkQueue; alerts: AlertItem[] }) {
  const reminders = alerts.filter((a) => a.source !== "approval");
  const [seg, setSeg] = useState<Seg>(queue.approvalTotal > 0 || (queue.taskTotal === 0 && reminders.length === 0) ? "approvals" : queue.taskTotal > 0 ? "tasks" : "alerts");
  const items: [Seg, string, number][] = [
    ["approvals", "审批", queue.approvalTotal],
    ["tasks", "任务", queue.taskTotal],
    ["alerts", "提醒", reminders.length]
  ];
  const fmt = (d: Date | null) => (d ? `${new Date(d).getMonth() + 1}月${new Date(d).getDate()}日` : "");

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
                  <div style={{ paddingTop: 4 }}><span className={cn("dot", urgent ? "dot-red dot-pulse-red" : a.task === "approve" ? "dot-amber dot-pulse-amber" : "dot-blue")} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="todo-title truncate">{ACTION_LABELS[a.action as ApprovalAction]} · {a.title}</div>
                    <div className="todo-meta">
                      <span>申请人 {a.requester}</span>
                      {a.matter ? (<><span className="todo-sep" /><span className="truncate">{a.matter}</span></>) : null}
                      <span className="todo-sep" />
                      <span className={urgent ? "t-red" : undefined}>{a.task === "issue" ? "待开票" : a.task === "stamp" ? "待盖章回填" : a.waitDays > 0 ? `已等待 ${a.waitDays} 天` : "今日提交"}</span>
                    </div>
                  </div>
                  <span className={`badge b-${approvalActionTone(a.action)} todo-type`}>{ACTION_LABELS[a.action as ApprovalAction].replace("审批", "").replace("申请", "")}</span>
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
                <div style={{ paddingTop: 4 }}><span className={cn("dot", t.overdue ? "dot-red dot-pulse-red" : t.priority >= 2 ? "dot-amber" : "dot-slate")} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="todo-title truncate">{t.title}</div>
                  <div className="todo-meta">
                    <span className="code">{t.matterCode}</span>
                    <span className="todo-sep" />
                    <span className="truncate">{t.matterTitle}</span>
                    {t.dueAt ? (<><span className="todo-sep" /><span className={t.overdue ? "t-red" : undefined}>{fmt(t.dueAt)} 截止{t.overdue ? " · 已逾期" : ""}</span></>) : null}
                  </div>
                </div>
                <span className={`badge ${t.overdue ? "b-red" : t.priority >= 2 ? "b-amber" : "b-slate"} todo-type`}>{t.overdue ? "逾期" : t.priority >= 2 ? "紧急" : t.priority === 1 ? "高" : "任务"}</span>
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
                <div style={{ paddingTop: 4 }}><span className={cn("dot", a.tone === "danger" ? "dot-red dot-pulse-red" : a.tone === "warn" ? "dot-amber" : "dot-slate")} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="todo-title truncate">{a.title}</div>
                  <div className="todo-meta"><span className="truncate">{a.detail}</span></div>
                </div>
                <span className={`badge ${a.tone === "danger" ? "b-red" : a.tone === "warn" ? "b-amber" : "b-slate"} todo-type`}>{a.source === "sms" ? "法院短信" : "保全"}</span>
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
