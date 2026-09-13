import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { getWebhookSettings } from "@/server/settings/webhook";
import { ReminderScanButton } from "./_components/reminder-scan-button";
import { WebhookSettingsCard } from "./_components/webhook-settings-card";

export default async function RemindersSettingsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");
  const webhook = await getWebhookSettings();
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
            <div className="mt-0.5 text-[12px] text-muted-foreground">扫描 T-3 / T-1 / T 的开庭与到期项，对接收人补推通知（当日已推过的不重复）。</div>
          </div>
          <ReminderScanButton />
        </div>
      </div>
      <WebhookSettingsCard initialEnabled={webhook.enabled} initialUrl={webhook.url} />
    </div>
  );
}
