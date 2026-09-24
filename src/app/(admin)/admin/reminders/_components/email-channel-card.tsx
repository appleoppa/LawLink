/**
 * 邮件通道状态卡（第六轮体检 P1-4）：展示 SMTP 配置状态与最近一次个人邮件
 * 摘要（email-digest）投递结果。只读——SMTP 经环境变量配置（.env），不在
 * 界面修改；未配置时给出持续可见的缺口警示与配置指引。
 */
import { Mail } from "lucide-react";
import type { ReminderEmailLastResult } from "@/server/settings/email-last-result";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).replace("/", "-");
}

export function EmailChannelCard({
  configured,
  mailFrom,
  last
}: {
  configured: boolean;
  mailFrom: string | null;
  last: ReminderEmailLastResult | null;
}) {
  const lastText = !last
    ? "暂无记录（生产环境每日 09:00 产生提醒后投递，本地开发不触发）"
    : last.skipped
      ? `已跳过：${last.skipReason ?? "未指定原因"}`
      : last.error
        ? `发送失败：${last.error}`
        : `发出 ${last.sentCount} 封（${last.userCount} 位接收人）`;

  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <Mail className="ic" strokeWidth={1.8} />
          邮件通道（个人摘要）
        </div>
        <span className="t-xs t-mute">
          {configured ? "SMTP 已配置" : "未配置"}
        </span>
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {configured ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "var(--green-bg)", border: "1px solid var(--green-line)" }}>
            <span className="dot dot-green" />
            <span className="t-sm" style={{ flex: 1 }}>期限、开庭与保全提醒在站内通知之外，另按人发送邮件摘要</span>
            {mailFrom ? <span className="t-xs t-mute font-mono">{mailFrom}</span> : null}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "var(--amber-bg)", border: "1px solid var(--amber-line)" }}>
            <span className="dot dot-amber" />
            <span className="t-sm" style={{ flex: 1 }}>
              SMTP 未配置：提醒仅站内可见，律师不登录收不到邮件。在服务器 <code className="font-mono">.env</code> 配置{" "}
              <code className="font-mono">SMTP_HOST</code> 与 <code className="font-mono">MAIL_FROM</code>（可选 SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS）后重启生效。
            </span>
          </div>
        )}
        <div className="t-xs t-mute" style={{ marginTop: 8 }}>
          最近一次摘要（{last ? formatTime(last.at) : "—"}）：{lastText}
        </div>
      </div>
    </div>
  );
}
