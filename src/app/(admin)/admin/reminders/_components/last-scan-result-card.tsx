/**
 * 最近一次到期提醒扫描与群机器人推送状态（服务端组件）。
 * 数据由 scan-due-reminders 每次扫描后写入 SystemSetting，此处只读展示。
 */
import { Activity, AlertTriangle, CheckCircle2, CircleSlash } from "lucide-react";
import type { ReminderWebhookLastResult } from "@/server/settings/webhook-last-result";

function formatScanTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function LastScanResultCard({
  result
}: {
  result: ReminderWebhookLastResult | null;
}) {
  return (
    <section className="ll-surface">
      <header className="ll-panel-head">
        <h3 className="ll-panel-title">
          <Activity className="h-4 w-4 text-primary" strokeWidth={1.8} />
          最近扫描与推送状态
        </h3>
      </header>
      <div className="px-4 pb-4">
      {!result ? (
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
          尚无扫描记录。自动扫描在生产环境每天 09:00 运行（本地开发不触发），
          也可点击上方「立即扫描」手动跑一遍后查看。
        </p>
      ) : (
        <div className="mt-2 space-y-1.5 text-[12.5px] leading-5">
          <div>
            上次扫描：<span className="font-mono tabular">{formatScanTime(result.at)}</span>
            <span className="mx-1.5 text-border">|</span>
            新提醒 {result.reminderCount} 条
            （期限 {result.deadlineNotified} · 开庭 {result.hearingNotified} · 保全 {result.preservationNotified}）
            <span className="mx-1.5 text-border">|</span>
            去重跳过 {result.suppressed} 条
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0">群机器人推送：</span>
            {result.queued ? (
              <>
                <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">已排队，等待队列投递（失败自动重试）</span>
              </>
            ) : result.skipped ? (
              <>
                <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  已跳过（{result.skipReason ?? "未启用推送"}）
                </span>
              </>
            ) : result.ok ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--green)]" />
                <span className="text-[var(--green)]">发送成功，请到群里确认</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--red)]" />
                <span className="text-[var(--red)]">发送失败：{result.error ?? "未知错误"}</span>
              </>
            )}
          </div>
          <div className="text-muted-foreground">
            扫描概况：期限 {result.deadlineScanned} · 开庭 {result.hearingScanned} · 保全{" "}
            {result.preservationScanned} 条；保全过期自动标记 {result.preservationExpired} 条
          </div>
        </div>
      )}
    </div>
    </section>
  );
}
