/**
 * 提醒送达台账卡（F-1 阶段三）：近 7 天各通道投递结果、积压警示与最近失败。
 * 数据来自 reminder_delivery 台账（只读聚合）——登记、送达、作废、失败在这里
 * 对账：应发几条、实发几条、作废几条一目了然（此前只有"发了多少"）。
 */
import { BellRing } from "lucide-react";
import type { ReminderDeliveryChannel, ReminderDeliveryStatus } from "@prisma/client";

export type LedgerAggregate = { dayKey: string; channel: ReminderDeliveryChannel; status: ReminderDeliveryStatus; count: number };
export type LedgerFailure = { id: string; objectType: string; objectId: string; channel: ReminderDeliveryChannel; lastError: string | null; updatedAt: Date };

const CHANNEL_CN: Record<ReminderDeliveryChannel, string> = { IN_APP: "站内", EMAIL: "邮件", WEBHOOK: "群机器人" };
const STATUS_CN: Record<ReminderDeliveryStatus, string> = {
  PENDING: "待投递", SENT: "已送达", SKIPPED: "跳过", FAILED: "失败",
  SUPERSEDED: "作废·变更", CANCELLED: "作废·消亡"
};

function formatTime(iso: string | Date) {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).replace("/", "-");
}

const STATUS_ORDER: ReminderDeliveryStatus[] = ["SENT", "PENDING", "SKIPPED", "SUPERSEDED", "CANCELLED", "FAILED"];

export function DeliveryLedgerCard({
  rows, pendingBacklog, failures
}: {
  rows: LedgerAggregate[];
  /** 注册超过 10 分钟仍 PENDING 的行数——正常应被 2 分钟投递器清零，>0 即投递链路异常 */
  pendingBacklog: number;
  failures: LedgerFailure[];
}) {
  const channels = ["IN_APP", "EMAIL", "WEBHOOK"] as const;
  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <BellRing className="ic" strokeWidth={1.8} />
          提醒送达台账 · 近 7 天
        </div>
        <span className="t-xs t-mute">登记 / 送达 / 作废对账</span>
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {pendingBacklog > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid var(--red-line)", marginBottom: 8 }}>
            <span className="dot dot-red" />
            <span className="t-sm" style={{ flex: 1 }}>{pendingBacklog} 条登记超过 10 分钟未投递——投递器可能未运行（生产经 next start 注册，每 2 分钟一轮）</span>
          </div>
        ) : null}
        <table className="t-xs" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr className="t-mute">
              <th style={{ textAlign: "left", fontWeight: 400, padding: "3px 0" }}>通道</th>
              {STATUS_ORDER.map((s) => (
                <th key={s} style={{ textAlign: "right", fontWeight: 400, padding: "3px 0" }}>{STATUS_CN[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const total = rows.filter((r) => r.channel === ch).reduce((n, r) => n + r.count, 0);
              return (
                <tr key={ch}>
                  <td style={{ padding: "3px 0" }}>{CHANNEL_CN[ch]}</td>
                  {STATUS_ORDER.map((s) => {
                    const n = rows.find((r) => r.channel === ch && r.status === s)?.count ?? 0;
                    return (
                      <td key={s} style={{ textAlign: "right", padding: "3px 0", color: s === "FAILED" && n > 0 ? "var(--red)" : undefined }}>
                        {n || (total ? "-" : "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {failures.length > 0 ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="t-xs t-faint">最近失败</div>
            {failures.map((f) => (
              <div key={f.id} className="t-xs" style={{ padding: "6px 8px", borderRadius: 7, background: "var(--bg-sunken)" }}>
                <div className="flex flex-wrap items-center gap-1.5 t-mute">
                  <span className="font-mono">{formatTime(f.updatedAt)}</span>
                  <span className="offset-chip">{CHANNEL_CN[f.channel]}</span>
                  <span>{f.objectType}</span>
                </div>
                <div className="truncate" style={{ color: "var(--red)", marginTop: 2 }} title={f.lastError ?? ""}>{f.lastError ?? "未知错误"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="t-xs t-mute" style={{ marginTop: 8 }}>暂无失败记录。作废行（变更/消亡）是正常现象——那是改期或办结被正确拦截的痕迹。</div>
        )}
      </div>
    </div>
  );
}
