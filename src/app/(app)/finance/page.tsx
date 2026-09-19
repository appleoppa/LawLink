import { getSession } from "@/lib/auth/session";
import {
  listAllFeeEntries,
  listPendingReceipts,
  getFinanceKpis,
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

  const [entries, pending, kpis, monthly, personal, invoiceRequests, invoiceStats, aging] = await Promise.all([
    listAllFeeEntries({ limit: 500 }),
    listPendingReceipts(),
    getFinanceKpis(),
    getMonthlyRevenue(12),
    getPersonalRevenue(userId),
    listInvoiceRequests(),
    getInvoiceStats(),
    getReceivablesAging()
  ]);

  const { monthlyReceived, monthlyReceivable, lastMonthReceived, yearlyReceived, yearlyReceivable } = kpis;

  return (
    <FinanceViewV4
      entries={entries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        confirmed: Boolean(entry.billing?.signedAt || entry.invoiceNo)
      }))}
      pendingEntries={pending.map((entry) => ({
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
