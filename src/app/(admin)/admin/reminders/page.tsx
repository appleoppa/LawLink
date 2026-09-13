import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { getWebhookSettings } from "@/server/settings/webhook";
import { getWebhookLastResult } from "@/server/settings/webhook-last-result";
import { listDeadlineRulesAdmin } from "@/server/deadline-rules/admin-actions";
import { listDeadJobs } from "@/server/cron/queue";
import { LastScanResultCard } from "./_components/last-scan-result-card";
import { DeadlineRulesCard } from "./_components/deadline-rules-card";
import { ReminderScanButton } from "./_components/reminder-scan-button";
import { WebhookSettingsCard } from "./_components/webhook-settings-card";

export default async function RemindersSettingsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");
  const webhook = await getWebhookSettings();
  const lastResult = await getWebhookLastResult();
  const rules = await listDeadlineRulesAdmin();
  const deadJobs = await listDeadJobs(5);
  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h2 className="ll-page-title">提醒维护</h2>
          <p className="ll-page-sub">
            系统每天 09:00 自动扫描法定期限 / 开庭，对临近项推送站内通知（开庭提前 3 天 / 1 天 / 当天早上）。
            自动扫描仅在生产环境运行，本地开发不触发——可在此手动立即扫一遍用于验证。
          </p>
        </div>
      </header>

      <section className="ll-surface">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title">扫描流水线</h3>
          <ReminderScanButton />
        </header>
        <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { t: "① 起算事件发生", d: "判决书送达、立案受理等由程序环节与期限规则记录" },
            { t: "② 规则推算期限", d: "按规则库期限生成到期日，人工修正后锁定并标注来源" },
            { t: "③ 阶梯预警推送", d: "T-3 / T-1 / T-0 / T+1 四档提醒，逾期另发团队负责人" }
          ].map(step => (
            <div key={step.t} className="px-4 py-3">
              <div className="text-[12.75px] font-semibold">{step.t}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{step.d}</div>
            </div>
          ))}
        </div>
      </section>

      <LastScanResultCard result={lastResult} />
      <DeadlineRulesCard rules={rules.map(r => ({
        id: r.id, code: r.code, name: r.name, description: r.description,
        triggerLabel: r.triggerLabel, periodValue: r.periodValue, periodUnit: r.periodUnit,
        category: r.category, legalBasis: r.legalBasis, legalBasisUrl: r.legalBasisUrl,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        remindDays: r.remindDays, enabled: r.enabled, isBuiltIn: r.isBuiltIn
      }))} />
      {deadJobs.length > 0 && (
        <section className="rounded-lg border border-[#B42318]/30 bg-card">
          <header className="flex items-center gap-2 border-b border-[#B42318]/20 px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#B42318]" aria-hidden />
            <span className="text-[13px] font-semibold text-[#B42318]">队列死信</span>
            <span className="text-[11px] text-muted-foreground">重试超上限，需人工处置（不自动清理）</span>
          </header>
          <div className="divide-y divide-border/60">
            {deadJobs.map(j => (
              <div key={j.id} className="px-4 py-2.5 text-[12px] text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tabular">{new Date(j.updatedAt).toLocaleString("zh-CN")}</span>
                  <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px]">{j.type}</span>
                  {j.dedupeKey && <span className="truncate font-mono text-[10px] text-muted-foreground/70">{j.dedupeKey}</span>}
                  <span className="font-mono tabular">尝试 {j.attempts} 次</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#B42318]/85" title={j.lastError ?? ""}>{j.lastError ?? "未知错误"}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      <WebhookSettingsCard initialEnabled={webhook.enabled} initialUrl={webhook.url} />
    </div>
  );
}
