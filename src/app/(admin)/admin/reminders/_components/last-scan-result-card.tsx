/**
 * 提醒投递记录（墨案 12 右栏）：最近一次扫描概况 + 群机器人投递队列近 30 天状态。
 * 数据来自 scan-due-reminders 写入的 SystemSetting 与 JobQueue，只读展示；
 * 死信需人工处置（不自动清理、不在此提供补发按钮——队列无单条补发能力）。
 */
import { Send } from "lucide-react";
import type { ReminderWebhookLastResult } from "@/server/settings/webhook-last-result";

export type DeliveryStats = { delivered: number; failed: number; inFlight: number };
export type DeadJob = { id: string; type: string; attempts: number; lastError: string | null; updatedAt: Date };

function formatScanTime(iso: string | Date) {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).replace("/", "-");
}

function Row({ tone, label, right }: { tone: "green" | "red" | "slate"; label: string; right: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: `var(--${tone}-bg)`, border: `1px solid var(--${tone}-line)` }}>
      <span className={`dot dot-${tone}`} />
      <span className="t-sm" style={{ flex: 1 }}>{label}</span>
      {right}
    </div>
  );
}

export function LastScanResultCard({ result, stats, deadJobs }: { result: ReminderWebhookLastResult | null; stats: DeliveryStats; deadJobs: DeadJob[] }) {
  const push = !result
    ? null
    : result.queued ? "已排队，等待队列投递（失败自动重试）"
    : result.skipped ? `已跳过（${result.skipReason ?? "未启用推送"}）`
    : result.ok ? "发送成功，请到群里确认"
    : `发送失败：${result.error ?? "未知错误"}`;

  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <Send className="ic" strokeWidth={1.8} />
          提醒投递记录
        </div>
        <span className="t-xs t-mute">最近一次扫描</span>
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {!result ? (
          <p className="t-xs t-mute" style={{ lineHeight: 1.7, marginBottom: 10 }}>
            尚无扫描记录。自动扫描在生产环境每天 09:00 运行（本地开发不触发），可点击右上角「立即扫描」手动跑一遍。
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
              <span className="num-md">{formatScanTime(result.at)}</span>
              <span className="t-xs t-mute">新提醒 {result.reminderCount} 条 · 去重跳过 {result.suppressed}</span>
            </div>
            <div className="t-xs t-mute" style={{ marginBottom: 4 }}>
              期限 {result.deadlineNotified}/{result.deadlineScanned} · 开庭 {result.hearingNotified}/{result.hearingScanned} · 保全 {result.preservationNotified}/{result.preservationScanned}
              {result.escalationSent ? ` · 逾期升级 ${result.escalationSent}` : ""}
            </div>
            <div className="t-xs" style={{ marginBottom: 10, color: result.ok || result.queued ? "var(--t-secondary)" : result.skipped ? "var(--t-muted)" : "var(--red)" }}>
              群机器人：{push}
            </div>
          </>
        )}
        <div className="t-xs t-faint" style={{ marginBottom: 6 }}>群机器人投递队列 · 近 30 天</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Row tone="green" label={`发送成功 · ${stats.delivered} 条`} right={<span className="t-xs" style={{ color: "var(--green)" }}>群机器人</span>} />
          <Row tone="red" label={`重试失败 · ${stats.failed} 条`} right={<span className="t-xs" style={{ color: "var(--red)" }}>{stats.failed ? "需人工处置" : "无"}</span>} />
          <Row tone="slate" label={`投递中 / 待重试 · ${stats.inFlight} 条`} right={<span className="t-xs t-mute">接口成功 ≠ 已阅读</span>} />
        </div>
        {deadJobs.length > 0 ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {deadJobs.map((j) => (
              <div key={j.id} className="t-xs" style={{ padding: "6px 8px", borderRadius: 7, background: "var(--bg-sunken)" }}>
                <div className="flex flex-wrap items-center gap-1.5 t-mute">
                  <span className="font-mono">{formatScanTime(j.updatedAt)}</span>
                  <span className="offset-chip">{j.type === "webhook-digest" ? "群机器人摘要" : j.type === "email-digest" ? "邮件摘要" : j.type}</span>
                  <span>尝试 {j.attempts} 次</span>
                </div>
                <div className="truncate" style={{ color: "var(--red)", marginTop: 2 }} title={j.lastError ?? ""}>{j.lastError ?? "未知错误"}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
