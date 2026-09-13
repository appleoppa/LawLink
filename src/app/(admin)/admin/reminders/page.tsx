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
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">提醒维护</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          系统每天 09:00 自动扫描法定期限 / 开庭，对临近项推送站内通知（开庭提前 3 天 / 1 天 / 当天早上）。
          自动扫描仅在生产环境运行，本地开发不触发——可在此手动立即扫一遍用于验证。
        </p>
      </header>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">立即扫描提醒</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">扫描临近的开庭与到期项并对接收人补推通知（期限按各自提醒配置，开庭提前 3 天 / 1 天 / 当天；当日已推过的不重复）。</div>
          </div>
          <ReminderScanButton />
        </div>
      </div>
      <LastScanResultCard result={lastResult} />
      <DeadlineRulesCard rules={rules.map(r => ({
        id: r.id, code: r.code, name: r.name, description: r.description,
        triggerLabel: r.triggerLabel, periodValue: r.periodValue, periodUnit: r.periodUnit,
        category: r.category, legalBasis: r.legalBasis, legalBasisUrl: r.legalBasisUrl,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        remindDays: r.remindDays, enabled: r.enabled, isBuiltIn: r.isBuiltIn
      }))} />
      {deadJobs.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-card p-4">
          <div className="text-sm font-medium text-destructive">队列死信（重试超上限，需人工处置）</div>
          <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
            {deadJobs.map(j => (
              <div key={j.id} className="truncate">
                <span className="font-mono">{new Date(j.updatedAt).toLocaleString("zh-CN")}</span>
                {" · "}{j.type}{j.dedupeKey ? ` · ${j.dedupeKey}` : ""} · 尝试 {j.attempts} 次 · {j.lastError ?? "未知错误"}
              </div>
            ))}
          </div>
        </div>
      )}
      <WebhookSettingsCard initialEnabled={webhook.enabled} initialUrl={webhook.url} />
    </div>
  );
}
