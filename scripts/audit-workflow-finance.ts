/** 只读核对：只输出数量和金额，不输出案件、客户、号码或凭据，不修改数据。 */
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: [] });
async function main() {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [counts, anomalies, ledger] = await Promise.all([
      tx.$queryRaw<Array<Record<string, bigint>>>`SELECT
        (SELECT count(*) FROM "Billing") AS billings,
        (SELECT count(*) FROM "Receivable") AS receivables,
        (SELECT count(*) FROM "Payment") AS payments,
        (SELECT count(*) FROM "Allocation") AS allocations,
        (SELECT count(*) FROM "FinanceCorrection") AS corrections,
        (SELECT count(*) FROM "InvoiceRequest" WHERE status = 'ISSUED') AS issued_invoices,
        (SELECT count(*) FROM "FeeEntry" WHERE type = 'RECEIVED' AND "confirmState" = 'CONFIRMED') AS confirmed_receipts,
        (SELECT count(*) FROM "Receivable" WHERE "dueDate" IS NULL) AS receivables_without_due_date`,
      tx.$queryRaw<Array<Record<string, bigint>>>`SELECT
        (SELECT count(*) FROM (SELECT "feeEntryId" FROM "Payment" WHERE "feeEntryId" IS NOT NULL GROUP BY "feeEntryId" HAVING count(*) > 1) t) AS duplicate_payment_sources,
        (SELECT count(*) FROM "Payment" p LEFT JOIN "FeeEntry" f ON p."feeEntryId" = f.id WHERE p."feeEntryId" IS NOT NULL AND (f.id IS NULL OR f."matterId" <> p."matterId")) AS invalid_payment_sources,
        (SELECT count(*) FROM "Receivable" r LEFT JOIN "Billing" b ON r."billingId" = b.id WHERE r."billingId" IS NOT NULL AND (b.id IS NULL OR b."matterId" <> r."matterId")) AS invalid_receivable_sources,
        (SELECT count(*) FROM "FeeEntry" f WHERE f.type = 'RECEIVED' AND f."confirmState" = 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."feeEntryId" = f.id)) AS receipts_without_payment,
        (SELECT count(*) FROM "Payment" p JOIN "FeeEntry" f ON p."feeEntryId" = f.id WHERE f.type <> 'RECEIVED' OR f."confirmState" <> 'CONFIRMED' OR f.amount <> p.amount) AS inconsistent_payment_sources,
        (SELECT count(*) FROM "Allocation" a JOIN "Payment" p ON p.id = a."paymentId" JOIN "Receivable" r ON r.id = a."receivableId" WHERE p."matterId" <> r."matterId") AS cross_matter_allocations,
        (SELECT count(*) FROM "Receivable" r WHERE r."settledAmount" <> COALESCE((SELECT sum(a.amount) FROM "Allocation" a WHERE a."receivableId" = r.id), 0)) AS receivable_allocation_mismatches,
        (SELECT count(*) FROM "Payment" p WHERE p."allocatedAmount" <> COALESCE((SELECT sum(a.amount) FROM "Allocation" a WHERE a."paymentId" = p.id), 0)) AS payment_allocation_mismatches,
        (SELECT count(*) FROM (SELECT "matterId", trim("invoiceNo") FROM "InvoiceRequest" WHERE status = 'ISSUED' AND "invoiceNo" IS NOT NULL GROUP BY "matterId", trim("invoiceNo") HAVING count(*) > 1) t) AS duplicate_invoice_numbers`,
      tx.feeEntry.groupBy({ by: ["type", "confirmState"], _count: { _all: true }, _sum: { amount: true } })
    ]);
    return { mode: "READ_ONLY", at: new Date().toISOString(), counts: counts[0], anomalies: anomalies[0], ledger };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  console.log(JSON.stringify(result, (_, value) => typeof value === "bigint" ? Number(value) : value, 2));
}
main().catch(() => { console.error("只读核对失败；未执行任何数据变更，请检查数据库连接和表结构。"); process.exitCode = 1; }).finally(() => db.$disconnect());
