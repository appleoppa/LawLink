import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace, isSystemAdmin } from "@/lib/auth/system-role";
import { prisma } from "@/lib/prisma";
import { getWebhookSettings } from "@/server/settings/webhook";
import { getWebhookLastResult } from "@/server/settings/webhook-last-result";
import { getEmailLastResult } from "@/server/settings/email-last-result";
import { isEmailConfigured } from "@/lib/notifications/email";
import { listDeadlineRulesAdmin } from "@/server/deadline-rules/admin-actions";
import { listDeadJobs } from "@/server/cron/queue";
import { shDayKey } from "@/lib/ui/sh-time";
import { LastScanResultCard } from "./_components/last-scan-result-card";
import { DeadlineRulesCard } from "./_components/deadline-rules-card";
import { ReminderScanButton } from "./_components/reminder-scan-button";
import { WebhookSettingsCard } from "./_components/webhook-settings-card";
import { EmailChannelCard } from "./_components/email-channel-card";
import { DeliveryLedgerCard } from "./_components/delivery-ledger-card";
import { HolidayCard } from "./_components/holiday-card";
import { listHolidays } from "@/server/calendar/holiday-actions";

export default async function RemindersSettingsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");
  const since = new Date(Date.now() - 30 * 86_400_000);
  // 台账近 7 天（含今日，上海日界）
  const ledgerSince = shDayKey(new Date(Date.now() - 6 * 86_400_000));
  const [webhook, lastResult, emailLast, rules, deadJobs, grouped, ledgerRows, ledgerPending, ledgerFailures, holiday] = await Promise.all([
    getWebhookSettings(),
    getWebhookLastResult(),
    getEmailLastResult(),
    listDeadlineRulesAdmin(),
    listDeadJobs(5),
    prisma.jobQueue.groupBy({ by: ["status"], where: { type: "webhook-digest", createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.reminderDelivery.groupBy({ by: ["dayKey", "channel", "status"], where: { dayKey: { gte: ledgerSince } }, _count: { _all: true } }),
    prisma.reminderDelivery.count({ where: { status: "PENDING", registeredAt: { lt: new Date(Date.now() - 10 * 60_000) } } }),
    prisma.reminderDelivery.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, objectType: true, objectId: true, channel: true, lastError: true, updatedAt: true } }),
    listHolidays().catch(() => ({ year: new Date().getFullYear(), rows: [] as never[] })) // 表未建（迁移未批）时降级为空
  ]);
  const countOf = (...s: string[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);

  return (
    <div className="space-y-4">
      <DeadlineRulesCard
        headerActions={<ReminderScanButton />}
        rules={rules.map((r) => ({
          id: r.id, code: r.code, name: r.name, description: r.description,
          triggerLabel: r.triggerLabel, periodValue: r.periodValue, periodUnit: r.periodUnit,
          category: r.category, legalBasis: r.legalBasis, legalBasisUrl: r.legalBasisUrl,
          verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
          remindDays: r.remindDays, enabled: r.enabled, isBuiltIn: r.isBuiltIn,
          applicableProcedures: r.applicableProcedures
        }))}
        rail={
          <LastScanResultCard
            result={lastResult}
            stats={{ delivered: countOf("SUCCESS"), failed: countOf("DEAD"), inFlight: countOf("PENDING", "RUNNING", "FAILED") }}
            deadJobs={deadJobs}
          />
        }
      />
      <WebhookSettingsCard initialEnabled={webhook.enabled} initialUrl={webhook.url} />
      <EmailChannelCard
        configured={isEmailConfigured()}
        mailFrom={process.env.MAIL_FROM || null}
        last={emailLast}
      />
      <DeliveryLedgerCard
        rows={ledgerRows.map((r) => ({ dayKey: r.dayKey, channel: r.channel, status: r.status, count: r._count._all }))}
        pendingBacklog={ledgerPending}
        failures={ledgerFailures}
      />
      <HolidayCard year={holiday.year} rows={holiday.rows} canEdit={isSystemAdmin(session.user)} />
    </div>
  );
}
