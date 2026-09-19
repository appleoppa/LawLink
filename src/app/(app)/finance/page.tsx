import { getSession } from "@/lib/auth/session";
import {
  listAllFeeEntries,
  getMonthlyRevenue,
  getPersonalRevenue
} from "@/server/finance/actions";
import { listInvoiceRequests, getInvoiceStats } from "@/server/invoices/actions";
import { getReceivablesAging } from "@/server/finance/aging";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { canConfirmReceipt } from "@/lib/permissions";
import { FinanceViewV4 } from "./_components/finance-view-v4";

export default async function FinancePage() {
  const session = await getSession();
  const userId = session!.user.id;

  const [entries, monthly, personal, invoiceRequests, invoiceStats, aging] = await Promise.all([
    listAllFeeEntries({ limit: 500 }),
    getMonthlyRevenue(12),
    getPersonalRevenue(userId),
    listInvoiceRequests(),
    getInvoiceStats(),
    getReceivablesAging()
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(monthStart.getFullYear(), 0, 1);

  const monthlyReceived = entries
    .filter((e) => e.type === "RECEIVED" && e.confirmState === "CONFIRMED" && new Date(e.occurredAt) >= monthStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const monthlyReceivable = entries
    .filter((e) => e.type === "RECEIVABLE" && new Date(e.occurredAt) >= monthStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const lastMonthReceived = entries
    .filter((e) => e.type === "RECEIVED" && e.confirmState === "CONFIRMED" && new Date(e.occurredAt) >= lastMonthStart && new Date(e.occurredAt) < monthStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const yearlyReceivable = entries
    .filter((e) => e.type === "RECEIVABLE" && new Date(e.occurredAt) >= yearStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const yearlyReceived = entries
    .filter((e) => e.type === "RECEIVED" && e.confirmState === "CONFIRMED" && new Date(e.occurredAt) >= yearStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);

  return (
    <FinanceViewV4
      entries={entries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        confirmed: Boolean(entry.billing?.signedAt || entry.invoiceNo)
      }))}
      monthly={monthly.slice(-6)}
      aging={aging}
      canExport={hasCustomPermission(session!.user, "reports.export")}
      canWrite={hasCustomPermission(session!.user, "finance.write")}
      canConfirmReceipt={canConfirmReceipt(session!.user)}
      stats={{
        monthlyReceived,
        monthlyReceivable,
        yearlyReceived,
        yearlyReceivable,
        lastMonthReceived,
        personalMonthly: personal.monthlyCommission,
        personalYearly: personal.yearlyCommission,
        monthlyIssued: invoiceStats.monthlyIssued,
        pendingInvoiceCount: invoiceStats.pendingCount
      }}
      invoiceRequests={invoiceRequests}
      canApproveInvoice={
        session!.user.role === "FINANCE" ||
        session!.user.role === "PRINCIPAL_LAWYER"
      }
    />
  );
}
