-- 全新系统财务结构草案；仅在空财务表上执行，不转换或保留旧账。
-- 执行前须按已授权范围清理本地模拟业务数据；不得用于生产数据清理。
-- 基线 schema SHA256: a8e4a028f6d9a6d334aa7473352f5adb9942752fcfcb7750a1ce1e98f28330b1
-- 候选 schema SHA256: 66d3ec9ed568b883bbb8df9acf981b5fd73bdd7a9e5a27c19b6afd10ef70d55e
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "MoneyKind" AS ENUM ('LAWYER_FEE', 'CLIENT_FUNDS', 'EXPENSE_RECOVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingAmendmentType" AS ENUM ('ORIGINAL', 'ADDITION', 'REDUCTION', 'REPLACEMENT', 'SCOPE_ONLY', 'TERMINATION');

-- CreateEnum
CREATE TYPE "ReceivableDueState" AS ENUM ('UNKNOWN', 'DATE_SET', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "FinanceCorrectionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinanceEffectKind" AS ENUM ('EXPENSE_REVERSAL', 'PAYMENT_REFUND', 'RECEIVABLE_ADJUSTMENT', 'ALLOCATION_REVERSAL', 'INVOICE_ALLOCATION_REVERSAL', 'COMMISSION_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BillingScopeState" AS ENUM ('COVERED', 'SUPPLEMENT_REQUIRED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "CommissionSettlementKind" AS ENUM ('PAID', 'RECOVERED');

-- CreateEnum
CREATE TYPE "WorkItemState" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HandoverState" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Intake" ADD COLUMN     "workflowRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ConflictCheck" ADD COLUMN     "matterId" TEXT,
ADD COLUMN     "subjectFingerprint" TEXT;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "adjustmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "conditionConfirmedById" TEXT,
ADD COLUMN     "conditionSatisfiedAt" TIMESTAMP(3),
ADD COLUMN     "dueCondition" TEXT,
ADD COLUMN     "dueState" "ReceivableDueState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "moneyKind" "MoneyKind" NOT NULL,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceKey" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "moneyKind" "MoneyKind" NOT NULL,
ADD COLUMN     "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "feeEntryId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Allocation" ADD COLUMN     "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FinanceCorrection" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "feeEntryId" TEXT,
ADD COLUMN     "matterId" TEXT NOT NULL,
ADD COLUMN     "occurredAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "receivableId" TEXT,
ADD COLUMN     "requestPayload" JSONB NOT NULL,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceBillingId" TEXT,
ADD COLUMN     "status" "FinanceCorrectionStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "amendmentType" "BillingAmendmentType",
ADD COLUMN     "completedWork" TEXT,
ADD COLUMN     "draftTerms" JSONB,
ADD COLUMN     "effectiveAt" TIMESTAMP(3),
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "handoverWork" TEXT,
ADD COLUMN     "moneyKind" "MoneyKind" NOT NULL,
ADD COLUMN     "previousAmount" DECIMAL(14,2),
ADD COLUMN     "resultingAmount" DECIMAL(14,2),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceBillingId" TEXT,
ADD COLUMN     "terminationReason" TEXT;

-- AlterTable
ALTER TABLE "FeeEntry" ADD COLUMN     "commissionBaseSnapshot" DECIMAL(14,2),
ADD COLUMN     "commissionRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "moneyKind" "MoneyKind" NOT NULL,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ArchiveRecord" ADD COLUMN     "frozenManifest" JSONB,
ADD COLUMN     "supplementOfId" TEXT,
ADD COLUMN     "workflowSnapshot" JSONB;

-- CreateTable
CREATE TABLE "ArchiveClosurePlan" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "financeOwnerId" TEXT,
    "serviceCompletedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveClosurePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProcedureScope" (
    "billingId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "state" "BillingScopeState" NOT NULL DEFAULT 'PENDING_REVIEW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingProcedureScope_pkey" PRIMARY KEY ("billingId","procedureId")
);

-- CreateTable
CREATE TABLE "BillingAttachment" (
    "billingId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAttachment_pkey" PRIMARY KEY ("billingId","documentId")
);

-- CreateTable
CREATE TABLE "InvoicePaymentAllocation" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoicePaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceCorrectionEffect" (
    "expenseEntryId" TEXT,
    "id" TEXT NOT NULL,
    "correctionId" TEXT NOT NULL,
    "effectKind" "FinanceEffectKind" NOT NULL,
    "delta" DECIMAL(14,2) NOT NULL,
    "paymentId" TEXT,
    "receivableId" TEXT,
    "allocationId" TEXT,
    "invoiceAllocationId" TEXT,
    "commissionEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCorrectionEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSettlement" (
    "id" TEXT NOT NULL,
    "commissionEntryId" TEXT NOT NULL,
    "kind" "CommissionSettlementKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "voucherReference" TEXT NOT NULL,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeRevision" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkResponsibility" (
    "proposedAssigneeId" TEXT,
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "deadlineId" TEXT,
    "hearingId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "state" "WorkItemState" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "closedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkResponsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeUrgentItem" (
    "proposedAssigneeId" TEXT,
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "matterId" TEXT,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "state" "WorkItemState" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "closedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeUrgentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterHandover" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "HandoverState" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionTermination" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "sealId" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "reason" TEXT NOT NULL,
    "decisionNote" TEXT,
    "status" "FinanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionTermination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeHandover" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "HandoverState" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAdjustment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "replacementInvoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveClosurePlan_matterId_key" ON "ArchiveClosurePlan"("matterId");

-- CreateIndex
CREATE INDEX "BillingProcedureScope_procedureId_idx" ON "BillingProcedureScope"("procedureId");

-- CreateIndex
CREATE INDEX "BillingAttachment_documentId_idx" ON "BillingAttachment"("documentId");

-- CreateIndex
CREATE INDEX "InvoicePaymentAllocation_paymentId_idx" ON "InvoicePaymentAllocation"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePaymentAllocation_invoiceId_paymentId_key" ON "InvoicePaymentAllocation"("invoiceId", "paymentId");

-- CreateIndex
CREATE INDEX "FinanceCorrectionEffect_paymentId_idx" ON "FinanceCorrectionEffect"("paymentId");

-- CreateIndex
CREATE INDEX "FinanceCorrectionEffect_receivableId_idx" ON "FinanceCorrectionEffect"("receivableId");

-- CreateIndex
CREATE INDEX "FinanceCorrectionEffect_allocationId_idx" ON "FinanceCorrectionEffect"("allocationId");

-- CreateIndex
CREATE INDEX "FinanceCorrectionEffect_invoiceAllocationId_idx" ON "FinanceCorrectionEffect"("invoiceAllocationId");

-- CreateIndex
CREATE INDEX "FinanceCorrectionEffect_commissionEntryId_idx" ON "FinanceCorrectionEffect"("commissionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_expenseEntryId_key" ON "FinanceCorrectionEffect"("correctionId", "expenseEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_paymentId_key" ON "FinanceCorrectionEffect"("correctionId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_receivableId_key" ON "FinanceCorrectionEffect"("correctionId", "receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_allocationId_key" ON "FinanceCorrectionEffect"("correctionId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_invoiceAllocationId_key" ON "FinanceCorrectionEffect"("correctionId", "invoiceAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrectionEffect_correctionId_commissionEntryId_key" ON "FinanceCorrectionEffect"("correctionId", "commissionEntryId");

-- CreateIndex
CREATE INDEX "CommissionSettlement_commissionEntryId_idx" ON "CommissionSettlement"("commissionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRevision_intakeId_round_key" ON "IntakeRevision"("intakeId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "WorkResponsibility_taskId_key" ON "WorkResponsibility"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkResponsibility_deadlineId_key" ON "WorkResponsibility"("deadlineId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkResponsibility_hearingId_key" ON "WorkResponsibility"("hearingId");

-- CreateIndex
CREATE INDEX "WorkResponsibility_assigneeId_state_idx" ON "WorkResponsibility"("assigneeId", "state");

-- CreateIndex
CREATE INDEX "IntakeUrgentItem_assigneeId_state_dueAt_idx" ON "IntakeUrgentItem"("assigneeId", "state", "dueAt");

-- CreateIndex
CREATE INDEX "IntakeUrgentItem_intakeId_idx" ON "IntakeUrgentItem"("intakeId");

-- CreateIndex
CREATE INDEX "IntakeUrgentItem_matterId_idx" ON "IntakeUrgentItem"("matterId");

-- CreateIndex
CREATE INDEX "MatterHandover_matterId_status_idx" ON "MatterHandover"("matterId", "status");

-- CreateIndex
CREATE INDEX "MatterHandover_toUserId_status_idx" ON "MatterHandover"("toUserId", "status");

-- CreateIndex
CREATE INDEX "ExecutionTermination_invoiceId_idx" ON "ExecutionTermination"("invoiceId");

-- CreateIndex
CREATE INDEX "ExecutionTermination_sealId_idx" ON "ExecutionTermination"("sealId");

-- CreateIndex
CREATE INDEX "IntakeHandover_intakeId_idx" ON "IntakeHandover"("intakeId");

-- CreateIndex
CREATE INDEX "InvoiceAdjustment_replacementInvoiceId_idx" ON "InvoiceAdjustment"("replacementInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceAdjustment_invoiceId_reference_key" ON "InvoiceAdjustment"("invoiceId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_id_matterId_key" ON "InvoiceRequest"("id", "matterId");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_sourceKey_key" ON "Receivable"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_feeEntryId_key" ON "Payment"("feeEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_matterId_key" ON "Payment"("id", "matterId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrection_sourceBillingId_key" ON "FinanceCorrection"("sourceBillingId");

-- CreateIndex
CREATE INDEX "FinanceCorrection_matterId_status_idx" ON "FinanceCorrection"("matterId", "status");

-- AddForeignKey
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_conditionConfirmedById_fkey" FOREIGN KEY ("conditionConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_feeEntryId_fkey" FOREIGN KEY ("feeEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_feeEntryId_fkey" FOREIGN KEY ("feeEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_sourceBillingId_fkey" FOREIGN KEY ("sourceBillingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_sourceBillingId_fkey" FOREIGN KEY ("sourceBillingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_financeOwnerId_fkey" FOREIGN KEY ("financeOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_supplementOfId_fkey" FOREIGN KEY ("supplementOfId") REFERENCES "ArchiveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProcedureScope" ADD CONSTRAINT "BillingProcedureScope_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProcedureScope" ADD CONSTRAINT "BillingProcedureScope_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttachment" ADD CONSTRAINT "BillingAttachment_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAttachment" ADD CONSTRAINT "BillingAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_invoiceId_matterId_fkey" FOREIGN KEY ("invoiceId", "matterId") REFERENCES "InvoiceRequest"("id", "matterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_paymentId_matterId_fkey" FOREIGN KEY ("paymentId", "matterId") REFERENCES "Payment"("id", "matterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_expenseEntryId_fkey" FOREIGN KEY ("expenseEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "FinanceCorrection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_invoiceAllocationId_fkey" FOREIGN KEY ("invoiceAllocationId") REFERENCES "InvoicePaymentAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_commissionEntryId_fkey" FOREIGN KEY ("commissionEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_commissionEntryId_fkey" FOREIGN KEY ("commissionEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRevision" ADD CONSTRAINT "IntakeRevision_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRevision" ADD CONSTRAINT "IntakeRevision_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ConflictCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRevision" ADD CONSTRAINT "IntakeRevision_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_proposedAssigneeId_fkey" FOREIGN KEY ("proposedAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "Deadline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "Hearing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_proposedAssigneeId_fkey" FOREIGN KEY ("proposedAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_sealId_fkey" FOREIGN KEY ("sealId") REFERENCES "SealRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_replacementInvoiceId_fkey" FOREIGN KEY ("replacementInvoiceId") REFERENCES "InvoiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 账务不变量（Prisma schema 不表达 CHECK，必须随迁移保留）。
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_amendment_source_check" CHECK (
  "sourceBillingId" IS NULL OR "sourceBillingId" <> id
);
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_balance_check" CHECK (
  amount >= 0 AND amount + "adjustmentAmount" >= 0 AND "settledAmount" >= 0
  AND "settledAmount" <= amount + "adjustmentAmount"
);
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_due_state_check" CHECK (
  ("dueState" <> 'DATE_SET' OR "dueDate" IS NOT NULL)
  AND ("dueState" <> 'CONDITIONAL' OR ("dueCondition" IS NOT NULL AND length(trim("dueCondition")) > 0))
  AND ("conditionSatisfiedAt" IS NULL OR "conditionConfirmedById" IS NOT NULL)
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_balance_check" CHECK (
  amount >= 0 AND "refundedAmount" >= 0 AND "refundedAmount" <= amount
  AND "allocatedAmount" >= 0 AND "allocatedAmount" <= amount - "refundedAmount"
);
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_balance_check" CHECK (
  amount > 0 AND "reversedAmount" >= 0 AND "reversedAmount" <= amount
);
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_balance_check" CHECK (
  amount > 0 AND "reversedAmount" >= 0 AND "reversedAmount" <= amount
);
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_subject_check" CHECK (
  (
    "matterId" IS NOT NULL AND amount > 0
    AND num_nonnulls("paymentId", "receivableId", "feeEntryId") = 1
    AND (("targetType" = 'Payment' AND "targetId" = "paymentId")
      OR ("targetType" = 'Receivable' AND "targetId" = "receivableId")
      OR ("targetType" = 'FeeEntry' AND "targetId" = "feeEntryId")) IS TRUE
  )
);
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_confirmation_check" CHECK (
  status <> 'CONFIRMED' OR ("confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL)
);
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_target_check" CHECK (
  delta <> 0 AND num_nonnulls("paymentId", "receivableId", "allocationId", "invoiceAllocationId", "commissionEntryId", "expenseEntryId") = 1
  AND (("effectKind" = 'PAYMENT_REFUND' AND "paymentId" IS NOT NULL AND delta > 0)
    OR ("effectKind" = 'RECEIVABLE_ADJUSTMENT' AND "receivableId" IS NOT NULL)
    OR ("effectKind" = 'ALLOCATION_REVERSAL' AND "allocationId" IS NOT NULL AND delta > 0)
    OR ("effectKind" = 'INVOICE_ALLOCATION_REVERSAL' AND "invoiceAllocationId" IS NOT NULL AND delta > 0)
    OR ("effectKind" = 'EXPENSE_REVERSAL' AND "expenseEntryId" IS NOT NULL AND delta > 0)
    OR ("effectKind" = 'COMMISSION_ADJUSTMENT' AND "commissionEntryId" IS NOT NULL))
);
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_record_check" CHECK (
  amount > 0 AND length(trim("voucherReference")) > 0
  AND ("voidedAt" IS NULL OR ("voidReason" IS NOT NULL AND length(trim("voidReason")) > 0))
);


CREATE UNIQUE INDEX "Billing_active_successor_unique" ON "Billing" ("sourceBillingId") WHERE status='ACTIVE' AND "sourceBillingId" IS NOT NULL;

ALTER TABLE "IntakeRevision" ADD CONSTRAINT "IntakeRevision_round_check" CHECK (round > 0 AND length(fingerprint)=64);
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_subject_check" CHECK (num_nonnulls("intakeId","matterId") <= 1);
-- 事项新建即确定责任，覆盖导入、规则生成和普通表单；不回填旧事项。
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_target_check" CHECK (num_nonnulls("taskId","deadlineId","hearingId")=1 AND revision>=0 AND (state='OPEN' OR ("closedAt" IS NOT NULL AND reason IS NOT NULL AND length(trim(reason))>0)));
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_state_check" CHECK (kind IN ('TASK','DEADLINE','HEARING') AND revision>=0 AND (state='OPEN' OR ("closedAt" IS NOT NULL AND reason IS NOT NULL AND length(trim(reason))>0)));
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_people_check" CHECK ("fromUserId"<>"toUserId" AND reason IS NOT NULL AND length(trim(reason))>0 AND length(fingerprint)=64);
CREATE UNIQUE INDEX "MatterHandover_pending_unique" ON "MatterHandover" ("matterId") WHERE status='PENDING';
CREATE FUNCTION lawlink_assign_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE responsible text; work_id text; is_done boolean; case_id text;
BEGIN
 IF TG_TABLE_NAME='Task' THEN
  SELECT COALESCE(NEW."assigneeId",m."ownerId") INTO responsible FROM "Matter" m WHERE m.id=NEW."matterId";
 ELSE
  SELECT CASE WHEN NOT p."isExternalLead" AND u.active AND (u.role<>'CUSTOM' OR rd.active) THEN p."leadLawyerId" ELSE m."ownerId" END INTO responsible
   FROM "MatterProcedure" p JOIN "Matter" m ON m.id=p."matterId" LEFT JOIN "User" u ON u.id=p."leadLawyerId" LEFT JOIN "RoleDefinition" rd ON rd.id=u."roleDefinitionId" WHERE p.id=NEW."procedureId";
 END IF;
 IF responsible IS NULL OR NOT EXISTS (SELECT 1 FROM "User" u LEFT JOIN "RoleDefinition" r ON r.id=u."roleDefinitionId" WHERE u.id=responsible AND u.active AND (u.role<>'CUSTOM' OR (r.active AND EXISTS(SELECT 1 FROM "RolePermission" rp WHERE rp."roleId"=r.id AND rp."permissionKey"='matters.write')))) THEN
  RAISE EXCEPTION '事项须有有效责任人，请先完成责任交接';
 END IF;
 work_id := 'work_' || md5(NEW.id || TG_TABLE_NAME);
 is_done := COALESCE((to_jsonb(NEW)->>'completed')::boolean,false);
 INSERT INTO "WorkResponsibility" (id,"taskId","deadlineId","hearingId","assigneeId",state,"closedAt",reason) VALUES(work_id,CASE WHEN TG_TABLE_NAME='Task' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='Deadline' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='Hearing' THEN NEW.id END,responsible,CASE WHEN is_done THEN 'DONE'::"WorkItemState" ELSE 'OPEN'::"WorkItemState" END,CASE WHEN is_done THEN NOW() END,CASE WHEN is_done THEN '登记时已完成' END);
 IF NOT is_done THEN
  IF TG_TABLE_NAME='Task' THEN case_id:=NEW."matterId"; ELSE SELECT "matterId" INTO case_id FROM "MatterProcedure" WHERE id=NEW."procedureId"; END IF;
  INSERT INTO "Notification" (id,"userId",type,priority,title,content,href,"refType","refId") VALUES('assignment_'||work_id,responsible,'SYSTEM','HIGH','新事项待承接','请核对事项内容和日期，确认承接责任。','/matters/'||case_id,'WorkResponsibility',work_id);
 END IF;
 IF TG_TABLE_NAME='Task' THEN
  IF NEW."assigneeId" IS NULL THEN UPDATE "Task" SET "assigneeId"=responsible WHERE id=NEW.id; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_responsibility_create" AFTER INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();
CREATE TRIGGER "Deadline_responsibility_create" AFTER INSERT ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();
CREATE TRIGGER "Hearing_responsibility_create" AFTER INSERT ON "Hearing" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();
CREATE FUNCTION lawlink_complete_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.completed IS DISTINCT FROM OLD.completed THEN
  IF NEW.completed THEN UPDATE "WorkResponsibility" SET state='DONE',"closedAt"=NOW(),reason='标记完成',revision=revision+1 WHERE ("taskId"=NEW.id OR "deadlineId"=NEW.id) AND state='OPEN';
  ELSE UPDATE "WorkResponsibility" SET state='OPEN',"closedAt"=NULL,reason='重新办理',revision=revision+1 WHERE ("taskId"=NEW.id OR "deadlineId"=NEW.id) AND state='DONE';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_responsibility_complete" AFTER UPDATE OF completed ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_complete_work();
CREATE TRIGGER "Deadline_responsibility_complete" AFTER UPDATE OF completed ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_complete_work();

CREATE FUNCTION lawlink_change_work_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_date timestamp; next_date timestamp;
BEGIN
 IF TG_TABLE_NAME='Hearing' THEN prior_date=OLD."startsAt";next_date=NEW."startsAt";ELSE prior_date=OLD."dueAt";next_date=NEW."dueAt";END IF;
 IF prior_date IS DISTINCT FROM next_date THEN
  UPDATE "WorkResponsibility" SET "acceptedAt"=NULL,revision=revision+1 WHERE "taskId"=NEW.id OR "deadlineId"=NEW.id OR "hearingId"=NEW.id;
  UPDATE "Notification" SET read=true,"readAt"=NOW(),content='原日期已调整，请核对当前事项' WHERE "refId"=NEW.id AND "refType" LIKE 'DueReminder:%';
  INSERT INTO "AuditLog" (id,action,"targetType","targetId",detail) VALUES ('workdate_'||md5(random()::text||clock_timestamp()::text),'WORK_ITEM_DATE_CHANGED',TG_TABLE_NAME,NEW.id,jsonb_build_object('previousDate',prior_date,'newDate',next_date));
 END IF;RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_date_change" AFTER UPDATE OF "dueAt" ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
CREATE TRIGGER "Deadline_date_change" AFTER UPDATE OF "dueAt" ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
CREATE TRIGGER "Hearing_date_change" AFTER UPDATE OF "startsAt" ON "Hearing" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
CREATE FUNCTION lawlink_guard_task_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "WorkResponsibility" WHERE "taskId"=NEW.id AND "assigneeId" IS DISTINCT FROM NEW."assigneeId") THEN RAISE EXCEPTION '责任变更须经接收人确认';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_owner_guard" BEFORE UPDATE OF "assigneeId" ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_guard_task_owner();


-- 归档及执行终止只追加，终止不会覆盖原批准事实。
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_basis_check" CHECK (length(trim(reason))>0 AND length(fingerprint)=64 AND revision>=0);
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_supplement_check" CHECK ("supplementOfId" IS NULL OR "supplementOfId"<>id);
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_target_check" CHECK (num_nonnulls("invoiceId","sealId")=1 AND length(trim(reason))>0 AND revision>=0);
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_decision_check" CHECK ((status='PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL) OR (status<>'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decisionNote" IS NOT NULL AND length(trim("decisionNote"))>0));
CREATE UNIQUE INDEX "ExecutionTermination_invoice_open_unique" ON "ExecutionTermination" ("invoiceId") WHERE status IN ('PENDING','CONFIRMED');
CREATE UNIQUE INDEX "ExecutionTermination_seal_open_unique" ON "ExecutionTermination" ("sealId") WHERE status IN ('PENDING','CONFIRMED');


ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_basis_check" CHECK ("fromUserId"<>"toUserId" AND length(trim(reason))>0 AND length(fingerprint)=64 AND revision>=0);
CREATE UNIQUE INDEX "IntakeHandover_pending_unique" ON "IntakeHandover" ("intakeId") WHERE status='PENDING';
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_basis_check" CHECK (amount>0 AND kind IN ('RED','VOID','REPLACE') AND length(trim(reference))>0 AND length(trim(reason))>0 AND ((kind='REPLACE' AND "replacementInvoiceId" IS NOT NULL AND "replacementInvoiceId"<>"invoiceId") OR (kind<>'REPLACE' AND "replacementInvoiceId" IS NULL)));
CREATE UNIQUE INDEX "InvoiceAdjustment_replacement_unique" ON "InvoiceAdjustment" ("replacementInvoiceId") WHERE "replacementInvoiceId" IS NOT NULL;

COMMIT;
