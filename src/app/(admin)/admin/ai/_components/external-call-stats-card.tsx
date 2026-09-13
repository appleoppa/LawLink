/**
 * 外部调用台账卡片（服务端组件）：近 30 天调用量 / 失败率 / 平均耗时 + 最近失败。
 */
import { AlertTriangle } from "lucide-react";
import type { ExternalCallStats } from "@/server/settings/external-call-stats";

const SERVICE_CN: Record<string, string> = {
  "ai-chat": "AI 对话（审查/草拟/解析/案由）",
  "ai-vision": "AI 视觉识别",
  yuandian: "元典开放平台",
  "sms-ai": "短信 AI 解析"
};

export function ExternalCallStatsCard({ stats }: { stats: ExternalCallStats }) {
  const failureRate = stats.totalCalls > 0 ? ((stats.totalFailures / stats.totalCalls) * 100).toFixed(1) : "0";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-medium">外部调用台账（近 30 天）</div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        AI 与元典每次调用的成败与耗时汇总（不记录请求正文）。按次计费服务的消耗可据此估算。
      </p>

      {stats.totalCalls === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">暂无调用记录——使用 AI 审查、识别或元典检索后这里会出现统计。</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/40 p-2">
              <div className="font-mono text-lg tabular">{stats.totalCalls}</div>
              <div className="text-[11px] text-muted-foreground">总调用</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <div className={`font-mono text-lg tabular ${stats.totalFailures > 0 ? "text-destructive" : ""}`}>{stats.totalFailures}</div>
              <div className="text-[11px] text-muted-foreground">失败（{failureRate}%）</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-2">
              <div className="font-mono text-lg tabular">{stats.services.length}</div>
              <div className="text-[11px] text-muted-foreground">服务数</div>
            </div>
          </div>

          <table className="mt-3 w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="py-1 font-normal">服务</th>
                <th className="py-1 text-right font-normal">调用</th>
                <th className="py-1 text-right font-normal">失败</th>
                <th className="py-1 text-right font-normal">平均耗时</th>
              </tr>
            </thead>
            <tbody>
              {stats.services.map(s => (
                <tr key={s.service} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5">{SERVICE_CN[s.service] ?? s.service}</td>
                  <td className="py-1.5 text-right font-mono tabular">{s.calls}</td>
                  <td className={`py-1.5 text-right font-mono tabular ${s.failures > 0 ? "text-destructive" : "text-muted-foreground"}`}>{s.failures}</td>
                  <td className="py-1.5 text-right font-mono tabular text-muted-foreground">{(s.avgDurationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>

          {stats.recentFailures.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-destructive" />
                最近失败
              </div>
              {stats.recentFailures.map(f => (
                <div key={f.id} className="truncate text-[11.5px] text-muted-foreground">
                  <span className="font-mono">{new Date(f.createdAt).toLocaleString("zh-CN")}</span>
                  {" · "}{SERVICE_CN[f.service] ?? f.service}{f.action ? ` · ${f.action}` : ""} · {f.error?.slice(0, 80) ?? "未知错误"}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
