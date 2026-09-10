import { getSession } from "@/lib/auth/session";
import {
  listAllFeeEntries,
  getMonthlyRevenue,
  getPersonalRevenue
} from "@/server/finance/actions";
import { listInvoiceRequests, getInvoiceStats } from "@/server/invoices/actions";
import { FinanceView } from "./_components/finance-view";

export default async function FinancePage() {
  const session = await getSession();
  const userId = session!.user.id;

  const [entries, monthly, personal, invoiceRequests, invoiceStats] = await Promise.all([
    listAllFeeEntries({ limit: 200 }),
    getMonthlyRevenue(6),
    getPersonalRevenue(userId),
    listInvoiceRequests(),
    getInvoiceStats()
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(monthStart.getFullYear(), 0, 1);

  const monthlyReceived = entries
    .filter((e) => e.type === "RECEIVED" && new Date(e.occurredAt) >= monthStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const monthlyReceivable = entries
    .filter((e) => e.type === "RECEIVABLE" && new Date(e.occurredAt) >= monthStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);
  const yearlyReceived = entries
    .filter((e) => e.type === "RECEIVED" && new Date(e.occurredAt) >= yearStart)
    .reduce((acc, e) => acc + Number(e.amount), 0);

  return (
    <FinanceView
      entries={entries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount)
      }))}
      monthly={monthly}
      stats={{
        monthlyReceived,
        monthlyReceivable,
        yearlyReceived,
        personalMonthly: personal.monthlyCommission,
        personalYearly: personal.yearlyCommission,
        monthlyIssued: invoiceStats.monthlyIssued,
        pendingInvoiceCount: invoiceStats.pendingCount
      }}
      invoiceRequests={invoiceRequests}
      canApproveInvoice={
        session!.user.role === "FINANCE" ||
        session!.user.role === "ADMIN" ||
        session!.user.role === "PRINCIPAL_LAWYER"
      }
    />
  );
}
