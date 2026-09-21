-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PRINCIPAL_LAWYER', 'LAWYER', 'ASSISTANT', 'FINANCE');

-- CreateEnum
CREATE TYPE "MatterCategory" AS ENUM ('CIVIL_COMMERCIAL', 'CRIMINAL', 'ADMINISTRATIVE', 'NON_LITIGATION', 'LEGAL_COUNSEL', 'SPECIAL_PROJECT');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('PENDING_ACCEPTANCE', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MatterMemberRole" AS ENUM ('LEAD', 'CO_LEAD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('INTAKE', 'PENDING_CONFIRMATION', 'CONVERTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "LitigationStanding" AS ENUM ('PLAINTIFF', 'DEFENDANT', 'THIRD_PARTY', 'CRIMINAL_DEFENDANT', 'CRIMINAL_VICTIM', 'PRIVATE_PROSECUTOR', 'CRIMINAL_INCIDENTAL_PLAINTIFF', 'ARBITRATION_CLAIMANT', 'ARBITRATION_RESPONDENT', 'NON_LITIGATION_PARTY');

-- CreateEnum
CREATE TYPE "ProcedureType" AS ENUM ('FIRST_INSTANCE', 'SECOND_INSTANCE', 'RETRIAL_REVIEW', 'RETRIAL', 'REMAND_FIRST', 'REMAND_SECOND', 'PROSECUTORIAL_SUPERVISION', 'COMMERCIAL_ARBITRATION', 'LABOR_ARBITRATION', 'ARBITRATION_SET_ASIDE', 'ARBITRATION_ENFORCEMENT_REVIEW', 'ENFORCEMENT', 'ENFORCEMENT_OBJECTION', 'INVESTIGATION', 'PROSECUTION_REVIEW', 'DEATH_PENALTY_REVIEW', 'CRIMINAL_ENFORCEMENT', 'COMMUTATION_PAROLE_REVIEW', 'ADMIN_RECONSIDERATION', 'ADMIN_NON_LITIGATION_ENFORCEMENT', 'NON_LITIGATION_PHASE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProcedureStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CONCLUDED');

-- CreateEnum
CREATE TYPE "ProcedureEngagement" AS ENUM ('ENGAGED', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "ProcedureOutcome" AS ENUM ('WON', 'PARTIAL_WON', 'LOST', 'MEDIATED', 'WITHDRAWN', 'DISMISSED', 'COMPLETED', 'TRANSFERRED', 'OTHER');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('CLIENT_PARTY', 'OPPOSING_PARTY', 'THIRD_PARTY', 'CO_LITIGANT', 'AGENT', 'WITNESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ConflictSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKING');

-- CreateEnum
CREATE TYPE "ConflictConclusion" AS ENUM ('PENDING', 'SAME_SUBJECT', 'DIFFERENT', 'NEED_INFO');

-- CreateEnum
CREATE TYPE "DeadlineCategory" AS ENUM ('LIMITATION', 'EVIDENCE', 'APPEAL', 'PERFORMANCE', 'RESPONSE', 'ENFORCEMENT', 'ARBITRATION_SET_ASIDE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NoteChannel" AS ENUM ('PHONE', 'WECHAT', 'EMAIL', 'MEETING', 'COURT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('EVIDENCE', 'PLEADING', 'PROCEDURE', 'JUDGMENT', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeeEntryType" AS ENUM ('RECEIVABLE', 'RECEIVED', 'REFUND', 'COST', 'COMMISSION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'LAWYER',
    "phone" TEXT,
    "avatar" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "idNumber" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "wechat" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CauseOfAction" (
    "id" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "level" INTEGER NOT NULL,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pinyin" TEXT,
    "keywords" TEXT[],
    "sourceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CauseOfAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL DEFAULT 'CIVIL_COMMERCIAL',
    "causeId" TEXT,
    "causeFreeText" TEXT,
    "description" TEXT,
    "source" TEXT,
    "status" "IntakeStatus" NOT NULL DEFAULT 'INTAKE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declinedReason" TEXT,
    "clientId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matter" (
    "id" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL DEFAULT 'CIVIL_COMMERCIAL',
    "status" "MatterStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "causeId" TEXT,
    "causeFreeText" TEXT,
    "claimAmount" DECIMAL(14,2),
    "ourStanding" "LitigationStanding",
    "counterclaimAsPlaintiff" BOOLEAN NOT NULL DEFAULT false,
    "counterclaimAsDefendant" BOOLEAN NOT NULL DEFAULT false,
    "intakeDate" TIMESTAMP(3),
    "primaryClientId" TEXT,
    "ownerId" TEXT NOT NULL,
    "intakeId" TEXT,
    "firstAcceptedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterMember" (
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MatterMemberRole" NOT NULL DEFAULT 'ASSISTANT',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterMember_pkey" PRIMARY KEY ("matterId","userId")
);

-- CreateTable
CREATE TABLE "MatterClient" (
    "matterId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterClient_pkey" PRIMARY KEY ("matterId","clientId")
);

-- CreateTable
CREATE TABLE "MatterProcedure" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "type" "ProcedureType" NOT NULL,
    "customLabel" TEXT,
    "engagement" "ProcedureEngagement" NOT NULL DEFAULT 'ENGAGED',
    "order" INTEGER NOT NULL,
    "caseNumber" TEXT,
    "handlingAgency" TEXT,
    "panel" TEXT,
    "handler" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),
    "status" "ProcedureStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" "ProcedureOutcome",
    "outcomeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatterProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterStage" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatterStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "stageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hearing" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "room" TEXT,
    "judge" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DeadlineCategory" NOT NULL DEFAULT 'CUSTOM',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "basis" TEXT,
    "remindDays" INTEGER NOT NULL DEFAULT 3,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT,
    "matterId" TEXT,
    "role" "PartyRole" NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "idNumber" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "legalRep" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedEntity" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelatedEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictCheck" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT,
    "queryPayload" JSONB NOT NULL,
    "conclusion" "ConflictConclusion" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictHit" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "hitType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "matchedName" TEXT NOT NULL,
    "matchedField" TEXT NOT NULL,
    "matchedValue" TEXT NOT NULL,
    "matchedRatio" DOUBLE PRECISION,
    "severity" "ConflictSeverity" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "ConflictHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "channel" "NoteChannel" NOT NULL DEFAULT 'OTHER',
    "withWhom" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "attachments" TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "procedureId" TEXT,
    "name" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "familyId" TEXT,
    "path" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "algorithm" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "tags" TEXT[],
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Billing" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contractAmount" DECIMAL(14,2) NOT NULL,
    "schedule" TEXT,
    "status" "BillingStatus" NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeEntry" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "billingId" TEXT,
    "type" "FeeEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceNo" TEXT,
    "invoiceFile" TEXT,
    "payerOrPayee" TEXT,
    "method" TEXT,
    "note" TEXT,
    "parentFeeEntryId" TEXT,
    "beneficiaryUserId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveRecord" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "archivedBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportPath" TEXT,
    "checksum" TEXT,

    CONSTRAINT "ArchiveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageTemplate" (
    "id" TEXT NOT NULL,
    "procedureType" "ProcedureType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_idNumber_idx" ON "Client"("idNumber");

-- CreateIndex
CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

-- CreateIndex
CREATE INDEX "CauseOfAction_category_level_idx" ON "CauseOfAction"("category", "level");

-- CreateIndex
CREATE INDEX "CauseOfAction_category_active_level_idx" ON "CauseOfAction"("category", "active", "level");

-- CreateIndex
CREATE INDEX "CauseOfAction_name_idx" ON "CauseOfAction"("name");

-- CreateIndex
CREATE INDEX "CauseOfAction_parentId_idx" ON "CauseOfAction"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CauseOfAction_category_code_key" ON "CauseOfAction"("category", "code");

-- CreateIndex
CREATE INDEX "Intake_status_receivedAt_idx" ON "Intake"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Intake_causeId_idx" ON "Intake"("causeId");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_internalCode_key" ON "Matter"("internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_intakeId_key" ON "Matter"("intakeId");

-- CreateIndex
CREATE INDEX "Matter_status_updatedAt_idx" ON "Matter"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Matter_ownerId_idx" ON "Matter"("ownerId");

-- CreateIndex
CREATE INDEX "Matter_primaryClientId_idx" ON "Matter"("primaryClientId");

-- CreateIndex
CREATE INDEX "Matter_category_status_idx" ON "Matter"("category", "status");

-- CreateIndex
CREATE INDEX "Matter_causeId_idx" ON "Matter"("causeId");

-- CreateIndex
CREATE INDEX "MatterMember_userId_idx" ON "MatterMember"("userId");

-- CreateIndex
CREATE INDEX "MatterClient_clientId_idx" ON "MatterClient"("clientId");

-- CreateIndex
CREATE INDEX "MatterProcedure_matterId_order_idx" ON "MatterProcedure"("matterId", "order");

-- CreateIndex
CREATE INDEX "MatterProcedure_status_idx" ON "MatterProcedure"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MatterProcedure_matterId_order_key" ON "MatterProcedure"("matterId", "order");

-- CreateIndex
CREATE INDEX "MatterStage_procedureId_order_idx" ON "MatterStage"("procedureId", "order");

-- CreateIndex
CREATE INDEX "Task_matterId_completed_dueAt_idx" ON "Task"("matterId", "completed", "dueAt");

-- CreateIndex
CREATE INDEX "Task_assigneeId_completed_idx" ON "Task"("assigneeId", "completed");

-- CreateIndex
CREATE INDEX "Hearing_procedureId_startsAt_idx" ON "Hearing"("procedureId", "startsAt");

-- CreateIndex
CREATE INDEX "Hearing_startsAt_idx" ON "Hearing"("startsAt");

-- CreateIndex
CREATE INDEX "Deadline_procedureId_dueAt_completed_idx" ON "Deadline"("procedureId", "dueAt", "completed");

-- CreateIndex
CREATE INDEX "Deadline_dueAt_completed_idx" ON "Deadline"("dueAt", "completed");

-- CreateIndex
CREATE INDEX "Party_matterId_role_ordinal_idx" ON "Party"("matterId", "role", "ordinal");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Party_idNumber_idx" ON "Party"("idNumber");

-- CreateIndex
CREATE INDEX "RelatedEntity_name_idx" ON "RelatedEntity"("name");

-- CreateIndex
CREATE INDEX "Note_matterId_occurredAt_idx" ON "Note"("matterId", "occurredAt");

-- CreateIndex
CREATE INDEX "Document_matterId_category_idx" ON "Document"("matterId", "category");

-- CreateIndex
CREATE INDEX "Document_procedureId_idx" ON "Document"("procedureId");

-- CreateIndex
CREATE INDEX "Document_familyId_idx" ON "Document"("familyId");

-- CreateIndex
CREATE INDEX "Billing_matterId_status_idx" ON "Billing"("matterId", "status");

-- CreateIndex
CREATE INDEX "FeeEntry_matterId_type_occurredAt_idx" ON "FeeEntry"("matterId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "FeeEntry_type_occurredAt_idx" ON "FeeEntry"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "FeeEntry_beneficiaryUserId_occurredAt_idx" ON "FeeEntry"("beneficiaryUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommissionPlan_matterId_idx" ON "CommissionPlan"("matterId");

-- CreateIndex
CREATE INDEX "CommissionPlan_userId_idx" ON "CommissionPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPlan_matterId_userId_key" ON "CommissionPlan"("matterId", "userId");

-- CreateIndex
CREATE INDEX "TimelineEvent_matterId_occurredAt_idx" ON "TimelineEvent"("matterId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "StageTemplate_procedureType_idx" ON "StageTemplate"("procedureType");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CauseOfAction" ADD CONSTRAINT "CauseOfAction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_primaryClientId_fkey" FOREIGN KEY ("primaryClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterMember" ADD CONSTRAINT "MatterMember_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterMember" ADD CONSTRAINT "MatterMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClient" ADD CONSTRAINT "MatterClient_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterClient" ADD CONSTRAINT "MatterClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterProcedure" ADD CONSTRAINT "MatterProcedure_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterStage" ADD CONSTRAINT "MatterStage_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedEntity" ADD CONSTRAINT "RelatedEntity_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictHit" ADD CONSTRAINT "ConflictHit_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ConflictCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_parentFeeEntryId_fkey" FOREIGN KEY ("parentFeeEntryId") REFERENCES "FeeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
