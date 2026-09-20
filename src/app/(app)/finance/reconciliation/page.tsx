import Link from "next/link";
import { canConfirmReceipt } from "@/lib/permissions";
import { requireSession } from "@/lib/auth/session";
import { canExecuteFinance, hasCustomPermission } from "@/lib/roles/catalog";
import { getFinanceLedger } from "@/server/finance/ledger-actions";
import { PageHeader } from "@/components/patterns/moan";
import { LedgerWorkspace } from "./_components/ledger-workspace";

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ matterId?: string }> }) {
  const session = await requireSession("finance.read");
  const { matterId } = await searchParams;
  const data = await getFinanceLedger(matterId);
  return <div className="space-y-5">
    <PageHeader title="应收与收款分配" sub="将已确认收款分配到应收或发票，分别计算余额。" actions={<Link className="btn btn-secondary btn-sm" href="/finance">返回财务</Link>} />
    <LedgerWorkspace data={data} canConfirm={canConfirmReceipt(session.user)} canCorrect={canExecuteFinance(session.user,"finance.correct")} canSettle={canExecuteFinance(session.user,"finance.settle")} canWrite={hasCustomPermission(session.user,"finance.write")} selectedMatterId={matterId} />
  </div>;
}
