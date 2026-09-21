-- CreateEnum
CREATE TYPE "ClientIdType" AS ENUM ('ID_CARD', 'USCC', 'PASSPORT', 'OTHER', 'HK_MACAO_MAINLAND_PERMIT', 'TAIWAN_MAINLAND_PERMIT', 'FOREIGN_PERMANENT_ID');

-- CreateEnum
CREATE TYPE "MatterServiceStatus" AS ENUM ('SERVICE_ACTIVE', 'SERVICE_COMPLETED');

-- CreateEnum
CREATE TYPE "DocumentSourceOrigin" AS ENUM ('CLIENT_PROVIDED', 'COURT_SERVED', 'AI_EXTRACTED', 'SELF_COLLECTED', 'TEAM_PRODUCED');

-- CreateEnum
CREATE TYPE "DocumentTextSource" AS ENUM ('DOCX', 'PDF_TEXT', 'OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentOcrStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'SKIP');

-- CreateEnum
CREATE TYPE "FeeConfirmState" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DeadlineConfirmStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "MatterLinkRelation" AS ENUM ('RELATED_CASE', 'REMAND', 'DERIVED_ENFORCEMENT', 'RELATED_CONTRACT', 'REFERENCE_ONLY');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNALLOCATED', 'PARTIAL', 'FULLY_ALLOCATED');

-- CreateEnum
CREATE TYPE "FinanceCorrectionType" AS ENUM ('REFUND', 'DISCOUNT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('FACT', 'CLAIM', 'ANALYSIS', 'ISSUE', 'TODO_VERIFY');

-- CreateEnum
CREATE TYPE "SmsProcessingState" AS ENUM ('PROCESSING', 'NEEDS_MANUAL_FETCH', 'NEEDS_MATCH', 'PARTIAL', 'READY_FOR_REVIEW', 'ORGANIZED', 'NO_ACTION_NEEDED');

-- CreateEnum
CREATE TYPE "SmsFileState" AS ENUM ('PENDING_REVIEW', 'FILED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SmsFileSource" AS ENUM ('LINK_FETCH', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "SmsAnalysisState" AS ENUM ('PENDING', 'ANALYZING', 'ANALYZED', 'NEEDS_OCR', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsSuggestionKind" AS ENUM ('FIELD_CHANGE', 'HEARING', 'DEADLINE', 'MATTER_MATCH', 'DOC_TYPE');

-- CreateEnum
CREATE TYPE "SmsSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ReminderDeliveryObjectType" AS ENUM ('DEADLINE', 'HEARING', 'PRESERVATION_PROPERTY', 'ARCHIVE_BORROW', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryKind" AS ENUM ('OFFSET', 'EXPIRED', 'ESCALATION', 'RECIPIENT_MISSING', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryChannel" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'SUPERSEDED', 'CANCELLED');

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

-- AlterEnum
ALTER TYPE "IntakeStatus" ADD VALUE 'VOID';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'INDEPENDENT_LAWYER';

-- DropForeignKey
ALTER TABLE "Billing" DROP CONSTRAINT "Billing_matterId_fkey";

-- DropForeignKey
ALTER TABLE "FeeEntry" DROP CONSTRAINT "FeeEntry_matterId_fkey";

-- DropIndex
DROP INDEX "Client_idNumber_idx";

-- AlterTable
ALTER TABLE "ArchiveRecord" ADD COLUMN     "frozenManifest" JSONB,
ADD COLUMN     "supplementOfId" TEXT,
ADD COLUMN     "workflowSnapshot" JSONB;

-- AlterTable（moneyKind 为必填新增列：回填 v1.3.2 存量合同后置 NOT NULL；
-- v1.3.2 的 Billing 均为律师费收费约定，统一回填 LAWYER_FEE。）
ALTER TABLE "Billing" ADD COLUMN     "amendmentType" "BillingAmendmentType",
ADD COLUMN     "completedWork" TEXT,
ADD COLUMN     "draftTerms" JSONB,
ADD COLUMN     "effectiveAt" TIMESTAMP(3),
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "engagementId" TEXT,
ADD COLUMN     "handoverWork" TEXT,
ADD COLUMN     "moneyKind" "MoneyKind",
ADD COLUMN     "previousAmount" DECIMAL(14,2),
ADD COLUMN     "resultingAmount" DECIMAL(14,2),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceBillingId" TEXT,
ADD COLUMN     "terminationReason" TEXT;
UPDATE "Billing" SET "moneyKind" = 'LAWYER_FEE'::"MoneyKind" WHERE "moneyKind" IS NULL;
ALTER TABLE "Billing" ALTER COLUMN "moneyKind" SET NOT NULL;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "idNumberBlind" TEXT,
ADD COLUMN     "idType" "ClientIdType";

-- AlterTable
ALTER TABLE "ConflictCheck" ADD COLUMN     "matterId" TEXT,
ADD COLUMN     "subjectFingerprint" TEXT;

-- AlterTable
ALTER TABLE "Deadline" ADD COLUMN     "adjustedAt" TIMESTAMP(3),
ADD COLUMN     "adjustedById" TEXT,
ADD COLUMN     "confirmStatus" "DeadlineConfirmStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "sourceDocumentId" TEXT,
ADD COLUMN     "sourceRuleId" TEXT,
ADD COLUMN     "startFact" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "ocrStatus" "DocumentOcrStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "sourceOrigin" "DocumentSourceOrigin",
ADD COLUMN     "textContent" TEXT,
ADD COLUMN     "textSource" "DocumentTextSource";

-- AlterTable（moneyKind 为必填新增列：先加可空列、回填 v1.3.2 存量、再置 NOT NULL。
-- 回填规则：v1.3.2 的 FeeEntry 只有律师费与办案支出两类语义——
--   type='COST'（办案支出）→ EXPENSE_RECOVERY；其余（RECEIVABLE/RECEIVED/REFUND/COMMISSION）→ LAWYER_FEE。
-- 如所内实际不同，可在执行前修改下述 UPDATE 的映射。）
ALTER TABLE "FeeEntry" ADD COLUMN     "commissionBaseSnapshot" DECIMAL(14,2),
ADD COLUMN     "commissionRateSnapshot" DECIMAL(5,2),
ADD COLUMN     "confirmState" "FeeConfirmState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "moneyKind" "MoneyKind",
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;
UPDATE "FeeEntry" SET "moneyKind" = CASE WHEN type = 'COST' THEN 'EXPENSE_RECOVERY'::"MoneyKind" ELSE 'LAWYER_FEE'::"MoneyKind" END WHERE "moneyKind" IS NULL;
ALTER TABLE "FeeEntry" ALTER COLUMN "moneyKind" SET NOT NULL;

-- AlterTable
ALTER TABLE "Intake" ADD COLUMN     "workflowRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "serviceStatus" "MatterServiceStatus" NOT NULL DEFAULT 'SERVICE_ACTIVE',
ADD COLUMN     "teamAccessRestricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MatterLink" ADD COLUMN     "notedById" TEXT,
ADD COLUMN     "relation" "MatterLinkRelation" NOT NULL DEFAULT 'RELATED_CASE';

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "idType" "ClientIdType";

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "processingNote" TEXT,
ADD COLUMN     "processingState" "SmsProcessingState" NOT NULL DEFAULT 'READY_FOR_REVIEW',
ADD COLUMN     "rawTextHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "managerAuthorized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpEnforced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "Receivable" (
    "sourceKey" TEXT,
    "installmentNumber" INTEGER,
    "dueState" "ReceivableDueState" NOT NULL DEFAULT 'UNKNOWN',
    "dueCondition" TEXT,
    "conditionSatisfiedAt" TIMESTAMP(3),
    "conditionConfirmedById" TEXT,
    "adjustmentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "moneyKind" "MoneyKind" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "billingId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "moneyKind" "MoneyKind" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "feeEntryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocatedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNALLOCATED',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "reversedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceCorrection" (
    "requestPayload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "FinanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "matterId" TEXT NOT NULL,
    "paymentId" TEXT,
    "receivableId" TEXT,
    "feeEntryId" TEXT,
    "sourceBillingId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" "FinanceCorrectionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "relatedDocNo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeText" TEXT,
    "feeNote" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "terminatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementMatter" (
    "engagementId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementMatter_pkey" PRIMARY KEY ("engagementId","matterId")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "SmsInboundFile" (
    "id" TEXT NOT NULL,
    "smsId" TEXT NOT NULL,
    "matterId" TEXT,
    "documentId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "displayName" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedById" TEXT NOT NULL,
    "uploadSource" "SmsFileSource" NOT NULL DEFAULT 'LINK_FETCH',
    "state" "SmsFileState" NOT NULL DEFAULT 'PENDING_REVIEW',
    "analysisState" "SmsAnalysisState" NOT NULL DEFAULT 'PENDING',
    "analysisError" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "docType" TEXT,
    "extractedPages" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsInboundFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsSuggestion" (
    "id" TEXT NOT NULL,
    "smsId" TEXT NOT NULL,
    "fileId" TEXT,
    "kind" "SmsSuggestionKind" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "fieldKey" TEXT,
    "currentValue" TEXT,
    "suggestedValue" TEXT,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT,
    "payload" JSONB,
    "status" "SmsSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobQueue" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCallLog" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "action" TEXT,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_borrow_request" (
    "id" TEXT NOT NULL,
    "archiveRecordId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'WHOLE_VOLUME',
    "documentIds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "accessUntil" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_borrow_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HOLIDAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_delivery" (
    "id" TEXT NOT NULL,
    "objectType" "ReminderDeliveryObjectType" NOT NULL,
    "objectId" TEXT NOT NULL,
    "kind" "ReminderDeliveryKind" NOT NULL,
    "offset" INTEGER NOT NULL,
    "channel" "ReminderDeliveryChannel" NOT NULL,
    "dayKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_delivery_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "Receivable_sourceKey_key" ON "Receivable"("sourceKey");

-- CreateIndex
CREATE INDEX "Receivable_matterId_status_idx" ON "Receivable"("matterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_feeEntryId_key" ON "Payment"("feeEntryId");

-- CreateIndex
CREATE INDEX "Payment_matterId_status_idx" ON "Payment"("matterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_matterId_key" ON "Payment"("id", "matterId");

-- CreateIndex
CREATE INDEX "Allocation_receivableId_idx" ON "Allocation"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_paymentId_receivableId_key" ON "Allocation"("paymentId", "receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceCorrection_sourceBillingId_key" ON "FinanceCorrection"("sourceBillingId");

-- CreateIndex
CREATE INDEX "FinanceCorrection_matterId_status_idx" ON "FinanceCorrection"("matterId", "status");

-- CreateIndex
CREATE INDEX "FinanceCorrection_targetType_targetId_idx" ON "FinanceCorrection"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Engagement_clientId_idx" ON "Engagement"("clientId");

-- CreateIndex
CREATE INDEX "EngagementMatter_matterId_idx" ON "EngagementMatter"("matterId");

-- CreateIndex
CREATE INDEX "EvidenceItem_matterId_kind_idx" ON "EvidenceItem"("matterId", "kind");

-- CreateIndex
CREATE INDEX "EvidenceItem_sourceDocumentId_idx" ON "EvidenceItem"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveClosurePlan_matterId_key" ON "ArchiveClosurePlan"("matterId");

-- CreateIndex
CREATE INDEX "SmsInboundFile_matterId_state_idx" ON "SmsInboundFile"("matterId", "state");

-- CreateIndex
CREATE INDEX "SmsInboundFile_downloadedById_state_idx" ON "SmsInboundFile"("downloadedById", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SmsInboundFile_smsId_sha256_key" ON "SmsInboundFile"("smsId", "sha256");

-- CreateIndex
CREATE INDEX "SmsSuggestion_smsId_status_idx" ON "SmsSuggestion"("smsId", "status");

-- CreateIndex
CREATE INDEX "SmsSuggestion_fileId_idx" ON "SmsSuggestion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "JobQueue_dedupeKey_key" ON "JobQueue"("dedupeKey");

-- CreateIndex
CREATE INDEX "JobQueue_status_runAt_idx" ON "JobQueue"("status", "runAt");

-- CreateIndex
CREATE INDEX "ExternalCallLog_createdAt_idx" ON "ExternalCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalCallLog_service_createdAt_idx" ON "ExternalCallLog"("service", "createdAt");

-- CreateIndex
CREATE INDEX "archive_borrow_request_status_accessUntil_idx" ON "archive_borrow_request"("status", "accessUntil");

-- CreateIndex
CREATE INDEX "archive_borrow_request_applicantId_createdAt_idx" ON "archive_borrow_request"("applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_key" ON "holiday"("date");

-- CreateIndex
CREATE INDEX "holiday_date_idx" ON "holiday"("date");

-- CreateIndex
CREATE INDEX "reminder_delivery_day_channel_status" ON "reminder_delivery"("dayKey", "channel", "status");

-- CreateIndex
CREATE INDEX "reminder_delivery_status_registeredAt_idx" ON "reminder_delivery"("status", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_delivery_dedupe" ON "reminder_delivery"("objectType", "objectId", "kind", "offset", "channel", "dayKey", "userId");

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
CREATE INDEX "Client_idType_idNumberBlind_idx" ON "Client"("idType", "idNumberBlind");

-- CreateIndex
CREATE INDEX "FeeEntry_confirmState_occurredAt_idx" ON "FeeEntry"("confirmState", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_id_matterId_key" ON "InvoiceRequest"("id", "matterId");

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_rawTextHash_idx" ON "SmsMessage"("receivedById", "rawTextHash");

-- AddForeignKey
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_conditionConfirmedById_fkey" FOREIGN KEY ("conditionConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_feeEntryId_fkey" FOREIGN KEY ("feeEntryId") REFERENCES "FeeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementMatter" ADD CONSTRAINT "EngagementMatter_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementMatter" ADD CONSTRAINT "EngagementMatter_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_sourceBillingId_fkey" FOREIGN KEY ("sourceBillingId") REFERENCES "Billing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_financeOwnerId_fkey" FOREIGN KEY ("financeOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_supplementOfId_fkey" FOREIGN KEY ("supplementOfId") REFERENCES "ArchiveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "SmsMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_downloadedById_fkey" FOREIGN KEY ("downloadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "SmsMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "SmsInboundFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

