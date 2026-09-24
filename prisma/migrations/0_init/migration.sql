-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOM', 'PRINCIPAL_LAWYER', 'INDEPENDENT_LAWYER', 'LAWYER', 'ASSISTANT', 'FINANCE');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('NONE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('PRC_RESIDENT_ID', 'HK_MACAO_TAIWAN_RESIDENCE_PERMIT', 'PRC_HK_MACAO_TRAVEL_PERMIT', 'HK_MACAO_MAINLAND_TRAVEL_PERMIT', 'TAIWAN_MAINLAND_TRAVEL_PERMIT', 'PASSPORT', 'FOREIGN_PERMANENT_RESIDENT_ID', 'OTHER');

-- CreateEnum
CREATE TYPE "IdentityDocumentPageKind" AS ENUM ('PORTRAIT_SIDE', 'EMBLEM_SIDE', 'DATA_PAGE', 'SUPPLEMENTARY_PAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "MatterCategory" AS ENUM ('CIVIL_COMMERCIAL', 'LABOR_ARBITRATION', 'COMMERCIAL_ARBITRATION', 'CRIMINAL', 'ADMINISTRATIVE', 'NON_LITIGATION', 'LEGAL_COUNSEL', 'SPECIAL_PROJECT');

-- CreateEnum
CREATE TYPE "ClientIdType" AS ENUM ('ID_CARD', 'USCC', 'PASSPORT', 'OTHER', 'HK_MACAO_MAINLAND_PERMIT', 'TAIWAN_MAINLAND_PERMIT', 'FOREIGN_PERMANENT_ID');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('PENDING_ACCEPTANCE', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MatterServiceStatus" AS ENUM ('SERVICE_ACTIVE', 'SERVICE_COMPLETED');

-- CreateEnum
CREATE TYPE "MatterMemberRole" AS ENUM ('LEAD', 'CO_LEAD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('INTAKE', 'PENDING_CONFIRMATION', 'CONVERTED', 'DECLINED', 'NEEDS_REVISION', 'VOID');

-- CreateEnum
CREATE TYPE "LitigationStanding" AS ENUM ('PLAINTIFF', 'JOINT_PLAINTIFF', 'DEFENDANT', 'JOINT_DEFENDANT', 'THIRD_PARTY', 'COUNTERCLAIM_PLAINTIFF', 'COUNTERCLAIM_DEFENDANT', 'APPELLANT', 'APPELLEE', 'RETRIAL_APPLICANT', 'RETRIAL_RESPONDENT', 'ENFORCEMENT_APPLICANT', 'EXECUTED_PERSON', 'CRIMINAL_DEFENDANT', 'CRIMINAL_VICTIM', 'PRIVATE_PROSECUTOR', 'CRIMINAL_INCIDENTAL_PLAINTIFF', 'ARBITRATION_CLAIMANT', 'ARBITRATION_RESPONDENT', 'ADMIN_PLAINTIFF', 'ADMIN_DEFENDANT', 'ADMIN_RECONSIDERATION_APPLICANT', 'ADMIN_RECONSIDERATION_RESPONDENT', 'NON_LITIGATION_PARTY');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('FIXED', 'CONTINGENCY', 'TIMED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('PLAIN', 'SPECIAL');

-- CreateEnum
CREATE TYPE "InvoiceItem" AS ENUM ('LAWYER_FEE', 'CONSULTING_FEE', 'AGENCY_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentSourceOrigin" AS ENUM ('CLIENT_PROVIDED', 'COURT_SERVED', 'AI_EXTRACTED', 'SELF_COLLECTED', 'TEAM_PRODUCED');

-- CreateEnum
CREATE TYPE "DocumentTextSource" AS ENUM ('DOCX', 'PDF_TEXT', 'OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentOcrStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'SKIP');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'FILED');

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
CREATE TYPE "PartyType" AS ENUM ('NATURAL_PERSON', 'ORGANIZATION', 'COMPANY', 'PARTNERSHIP', 'INDIVIDUAL_BUSINESS', 'INSTITUTION', 'SOCIAL_ORG', 'GOVERNMENT', 'OTHER_ORG');

-- CreateEnum
CREATE TYPE "BarFilingType" AS ENUM ('NONE', 'COLLECTIVE', 'SENSITIVE', 'MAJOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ClientCooperationStatus" AS ENUM ('POTENTIAL', 'NEGOTIATING', 'SIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ClientGender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ConflictSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKING');

-- CreateEnum
CREATE TYPE "ConflictConclusion" AS ENUM ('PENDING', 'SAME_SUBJECT', 'DIFFERENT', 'NEED_INFO');

-- CreateEnum
CREATE TYPE "DeadlinePeriodUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "DeadlineCategory" AS ENUM ('LIMITATION', 'EVIDENCE', 'APPEAL', 'PERFORMANCE', 'RESPONSE', 'ENFORCEMENT', 'ARBITRATION_SET_ASIDE', 'PRESERVATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NoteChannel" AS ENUM ('PHONE', 'WECHAT', 'EMAIL', 'MEETING', 'COURT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('EVIDENCE', 'PLEADING', 'PROCEDURE', 'JUDGMENT', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeeEntryType" AS ENUM ('RECEIVABLE', 'RECEIVED', 'REFUND', 'COST', 'COMMISSION');

-- CreateEnum
CREATE TYPE "FeeConfirmState" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('INTAKE', 'RETAINER', 'LITIGATION', 'HEARING', 'WORK_PRODUCT', 'ARCHIVE', 'CLOSING', 'BLANK');

-- CreateEnum
CREATE TYPE "SealType" AS ENUM ('OFFICIAL_SEAL', 'CONTRACT_SEAL', 'FINANCE_SEAL', 'LEGAL_REP_SEAL', 'CONTRACT_REVIEW_SEAL');

-- CreateEnum
CREATE TYPE "SealRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'STAMPED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('MATTER', 'CLIENT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- CreateEnum
CREATE TYPE "MatterStageStatus" AS ENUM ('ACTIVE', 'HIDDEN');

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
CREATE TYPE "ArchiveStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArchiveClosedReason" AS ENUM ('JUDGMENT', 'MEDIATION', 'WITHDRAWAL', 'SETTLEMENT', 'RULING', 'OTHER');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('HEARING_NOTICE', 'SERVICE_NOTICE', 'FEE_NOTICE', 'MEDIATION', 'ENFORCEMENT', 'FILING_NOTICE', 'JUDGMENT_NOTICE', 'EVIDENCE_SUBMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "SmsMatchSource" AS ENUM ('AUTO_CASE_NUMBER', 'MANUAL', 'UNMATCHED');

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
CREATE TYPE "PreservationType" AS ENUM ('PRE_LITIGATION', 'LITIGATION', 'ENFORCEMENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('BANK_DEPOSIT', 'REAL_ESTATE', 'VEHICLE', 'EQUITY', 'IP', 'OTHER');

-- CreateEnum
CREATE TYPE "GuaranteeType" AS ENUM ('CASH_DEPOSIT', 'GUARANTEE_LETTER', 'PROPERTY', 'NONE');

-- CreateEnum
CREATE TYPE "PreservationStatus" AS ENUM ('ACTIVE', 'RENEWED', 'EXPIRED', 'LIFTED');

-- CreateEnum
CREATE TYPE "ExpressDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PRESERVATION_EXPIRY', 'HEARING_REMINDER', 'DEADLINE_REMINDER', 'SEAL_STATUS_CHANGE', 'SMS_ARRIVAL', 'TASK_ASSIGNED', 'SYSTEM', 'ARCHIVE_APPROVED', 'ARCHIVE_REJECTED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ReminderDeliveryObjectType" AS ENUM ('DEADLINE', 'HEARING', 'PRESERVATION_PROPERTY', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryKind" AS ENUM ('OFFSET', 'EXPIRED', 'ESCALATION', 'RECIPIENT_MISSING', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryChannel" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FirmFileCategory" AS ENUM ('POLICY', 'GUIDE', 'TEMPLATE', 'REFERENCE', 'CONTRACT', 'LETTER', 'LICENSE', 'OTHER_FIRM');

-- CreateEnum
CREATE TYPE "ExternalContactCategory" AS ENUM ('COURT', 'PROSECUTOR', 'POLICE', 'NOTARY', 'ARBITRATION', 'OTHER_FIRM', 'EXPERT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalContactStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('INTAKE_APPROVE', 'DOCUMENT_APPROVE', 'ARCHIVE_APPROVE', 'INVOICE_APPROVE', 'SEAL_APPROVE', 'SEAL_STAMP');

-- CreateEnum
CREATE TYPE "ApprovalCaseScope" AS ENUM ('ALL_CASES', 'CATEGORIES', 'NON_CASE');

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

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "normalizedName" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" VARCHAR(60) NOT NULL,
    "scope" VARCHAR(20) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'LAWYER',
    "systemRole" "SystemRole" NOT NULL DEFAULT 'NONE',
    "managerAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "roleDefinitionId" TEXT,
    "phone" TEXT,
    "identityDocumentType" "IdentityDocumentType",
    "identityDocumentName" VARCHAR(60),
    "identityDocumentNumber" VARCHAR(50),
    "avatar" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totpEnforced" BOOLEAN NOT NULL DEFAULT false,
    "calendarToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentityDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKind" "IdentityDocumentPageKind" NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canViewAllMatters" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "idType" "ClientIdType",
    "idNumber" TEXT,
    "idNumberBlind" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "legalRep" TEXT,
    "internalCode" TEXT,
    "cooperationStatus" "ClientCooperationStatus" NOT NULL DEFAULT 'SIGNED',
    "industry" TEXT,
    "gender" "ClientGender",
    "ethnicity" TEXT,
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
    "workflowRevision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL DEFAULT 'CIVIL_COMMERCIAL',
    "causeId" TEXT,
    "causeFreeText" TEXT,
    "description" TEXT,
    "status" "IntakeStatus" NOT NULL DEFAULT 'INTAKE',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declinedReason" TEXT,
    "clientId" TEXT,
    "clientType" "ClientType",
    "contactName" TEXT,
    "contactPhone" TEXT,
    "firstProcedureType" "ProcedureType",
    "firstAgency" TEXT,
    "jurisdiction" TEXT,
    "ourStanding" "LitigationStanding",
    "claimAmount" DECIMAL(14,2),
    "claimDescription" TEXT,
    "barFiling" "BarFilingType",
    "counterclaim" BOOLEAN NOT NULL DEFAULT false,
    "businessType" TEXT,
    "serviceScope" TEXT,
    "deliverables" TEXT,
    "counselType" TEXT,
    "serviceStart" TIMESTAMP(3),
    "serviceEnd" TIMESTAMP(3),
    "feeType" "FeeType",
    "feeAmount" DECIMAL(14,2),
    "contingencyTerms" TEXT,
    "feeSchedule" TEXT,
    "feeNote" TEXT,
    "ownerUserId" TEXT,
    "coUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matter" (
    "id" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "firmCaseNo" TEXT,
    "title" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL DEFAULT 'CIVIL_COMMERCIAL',
    "status" "MatterStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "serviceStatus" "MatterServiceStatus" NOT NULL DEFAULT 'SERVICE_ACTIVE',
    "teamAccessRestricted" BOOLEAN NOT NULL DEFAULT false,
    "causeId" TEXT,
    "causeFreeText" TEXT,
    "claimAmount" DECIMAL(14,2),
    "ourStanding" "LitigationStanding",
    "counterclaimAsPlaintiff" BOOLEAN NOT NULL DEFAULT false,
    "counterclaimAsDefendant" BOOLEAN NOT NULL DEFAULT false,
    "barFiling" "BarFilingType",
    "businessType" TEXT,
    "serviceScope" TEXT,
    "deliverables" TEXT,
    "counselType" TEXT,
    "serviceStart" TIMESTAMP(3),
    "serviceEnd" TIMESTAMP(3),
    "intakeDate" TIMESTAMP(3),
    "primaryClientId" TEXT,
    "ownerId" TEXT NOT NULL,
    "registeredById" TEXT,
    "intakeId" TEXT,
    "firstAcceptedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "customValues" JSONB NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "entityType" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
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
    "jurisdiction" TEXT,
    "presidingJudge" TEXT,
    "presidingJudgeContact" TEXT,
    "judgeAssistant" TEXT,
    "judgeAssistantContact" TEXT,
    "ourStanding" "LitigationStanding",
    "leadLawyerId" TEXT,
    "isExternalLead" BOOLEAN NOT NULL DEFAULT false,
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
    "status" "MatterStageStatus" NOT NULL DEFAULT 'ACTIVE',
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
    "address" TEXT,
    "judge" TEXT,
    "contact" TEXT,
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
    "sourceRuleId" TEXT,
    "startFact" TEXT,
    "sourceDocumentId" TEXT,
    "confirmStatus" "DeadlineConfirmStatus" NOT NULL DEFAULT 'CONFIRMED',
    "adjustedById" TEXT,
    "adjustedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerLabel" TEXT NOT NULL,
    "periodValue" INTEGER NOT NULL,
    "periodUnit" "DeadlinePeriodUnit" NOT NULL DEFAULT 'DAYS',
    "category" "DeadlineCategory" NOT NULL DEFAULT 'CUSTOM',
    "legalBasis" TEXT NOT NULL,
    "legalBasisUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "applicableProcedures" "ProcedureType"[],
    "applicableCategories" "MatterCategory"[],
    "remindDays" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureMemo" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcedureMemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT,
    "matterId" TEXT,
    "role" "PartyRole" NOT NULL,
    "standing" "LitigationStanding",
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "partyType" "PartyType" NOT NULL DEFAULT 'NATURAL_PERSON',
    "idType" "ClientIdType",
    "idNumber" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "legalRep" TEXT,
    "contactName" TEXT,
    "notes" TEXT,
    "enterpriseId" TEXT,
    "enterpriseSocialCode" TEXT,
    "enterpriseName" TEXT,
    "enterpriseBoundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_parties" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "standing" "LitigationStanding" NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procedure_parties_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "MatterLink" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "relatedMatterId" TEXT NOT NULL,
    "relation" "MatterLinkRelation" NOT NULL DEFAULT 'RELATED_CASE',
    "notedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictCheck" (
    "matterId" TEXT,
    "subjectFingerprint" TEXT,
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
    "reviewedById" TEXT,
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "intakeId" TEXT,
    "procedureId" TEXT,
    "stageId" TEXT,
    "name" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
    "sourceParty" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "familyId" TEXT,
    "sourceOrigin" "DocumentSourceOrigin",
    "textContent" TEXT,
    "pageCount" INTEGER,
    "textSource" "DocumentTextSource",
    "ocrStatus" "DocumentOcrStatus" NOT NULL DEFAULT 'PENDING',
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
    "folderId" TEXT,
    "templateId" TEXT,
    "templateContextSnapshot" JSONB,
    "archiveChecklistItemId" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceRequest" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "noMatterReason" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "title" TEXT,
    "status" "InvoiceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestNote" TEXT,
    "invoiceType" "InvoiceType",
    "invoiceItem" "InvoiceItem",
    "buyerName" TEXT,
    "buyerTaxNo" TEXT,
    "buyerAddress" TEXT,
    "buyerPhone" TEXT,
    "buyerBank" TEXT,
    "buyerBankAccount" TEXT,
    "evidenceDocIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invoiceNo" TEXT,
    "issuedAt" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "processNote" TEXT,
    "contractScanId" TEXT,
    "invoiceFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceRequest_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "Billing" (
    "draftTerms" JSONB,
    "completedWork" TEXT,
    "handoverWork" TEXT,
    "amendmentType" "BillingAmendmentType",
    "sourceBillingId" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "previousAmount" DECIMAL(14,2),
    "resultingAmount" DECIMAL(14,2),
    "terminationReason" TEXT,
    "moneyKind" "MoneyKind" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "engagementId" TEXT,
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
    "commissionRateSnapshot" DECIMAL(5,2),
    "commissionBaseSnapshot" DECIMAL(14,2),
    "moneyKind" "MoneyKind" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
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
    "confirmState" "FeeConfirmState" NOT NULL DEFAULT 'PENDING',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
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
CREATE TABLE "ArchiveRecord" (
    "supplementOfId" TEXT,
    "workflowSnapshot" JSONB,
    "frozenManifest" JSONB,
    "reviewedById" TEXT,
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "archiveNo" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "judgmentSummary" TEXT,
    "closedReason" "ArchiveClosedReason",
    "completedAt" TIMESTAMP(3),
    "checklistJson" JSONB NOT NULL,
    "missingItems" TEXT[],
    "coverDocId" TEXT,
    "catalogDocId" TEXT,
    "archivedBy" TEXT NOT NULL,
    "archivedById" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportPath" TEXT,
    "checksum" TEXT,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

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

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "description" TEXT,
    "applicableCategories" "MatterCategory"[],
    "docxBlobId" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolder" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SealTypeConfig" (
    "type" "SealType" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "approverRoles" "UserRole"[],
    "requiresLegalRep" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SealTypeConfig_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "SealRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sealType" "SealType" NOT NULL,
    "matterId" TEXT,
    "purposeConfigId" TEXT,
    "purposeLabel" TEXT,
    "purpose" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "requireCrossPageSeal" BOOLEAN NOT NULL DEFAULT false,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "draftDocId" TEXT NOT NULL,
    "stampedDocId" TEXT,
    "status" "SealRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestNote" TEXT,
    "approveNote" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "stampedById" TEXT,
    "stampedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "parentSealRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SealRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "rawTextHash" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "parsedJson" JSONB NOT NULL,
    "smsType" "SmsType" NOT NULL DEFAULT 'OTHER',
    "matchedMatterId" TEXT,
    "matchedBy" "SmsMatchSource" NOT NULL DEFAULT 'UNMATCHED',
    "generatedHearingId" TEXT,
    "generatedDeadlineId" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "needsManualAction" BOOLEAN NOT NULL DEFAULT false,
    "processingState" "SmsProcessingState" NOT NULL DEFAULT 'READY_FOR_REVIEW',
    "processingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "PreservationCase" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "type" "PreservationType" NOT NULL,
    "status" "PreservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "court" TEXT,
    "rulingNumber" TEXT,
    "guaranteeType" "GuaranteeType",
    "appliedAt" TIMESTAMP(3),
    "note" TEXT,
    "ownerId" TEXT,
    "remindDays" INTEGER[] DEFAULT ARRAY[30, 15, 7, 3, 1]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreservationTarget" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreservationProperty" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "propertyDetail" TEXT,
    "amount" DECIMAL(18,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" "PreservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreservationPropertyRenewal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "oldExpiryDate" TIMESTAMP(3) NOT NULL,
    "newExpiryDate" TIMESTAMP(3) NOT NULL,
    "renewalDuration" INTEGER NOT NULL,
    "note" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreservationPropertyRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpressTracking" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "trackingNo" TEXT NOT NULL,
    "companyCode" TEXT,
    "direction" "ExpressDirection" NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT,
    "recipientPhone" TEXT,
    "lastState" TEXT,
    "lastUpdateAt" TIMESTAMP(3),
    "tracesJson" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpressTracking_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "href" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemCount" INTEGER NOT NULL,
    "itemsJson" JSONB NOT NULL,
    "textPreviewChars" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirmFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "FirmFileCategory" NOT NULL,
    "tags" TEXT[],
    "path" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT NOT NULL,
    "supersededById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalContact" (
    "reviewedById" TEXT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExternalContactCategory" NOT NULL,
    "organization" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "wechat" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "tags" TEXT[],
    "createdById" TEXT NOT NULL,
    "status" "ExternalContactStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPermissionGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPermissionMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPermissionMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "ApprovalPermissionRule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "caseScope" "ApprovalCaseScope" NOT NULL,
    "categories" "MatterCategory"[],
    "allSealPurposes" BOOLEAN NOT NULL DEFAULT false,
    "purposeId" TEXT,
    "sealTypes" "SealType"[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ApprovalPermissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SealPurposeConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowedSealTypes" "SealType"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SealPurposeConfig_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "RoleDefinition_name_key" ON "RoleDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_normalizedName_key" ON "RoleDefinition"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");

-- CreateIndex
CREATE INDEX "User_roleDefinitionId_idx" ON "User"("roleDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_identityDocumentType_identityDocumentNumber_key" ON "User"("identityDocumentType", "identityDocumentNumber");

-- CreateIndex
CREATE INDEX "UserIdentityDocument_userId_active_idx" ON "UserIdentityDocument"("userId", "active");

-- CreateIndex
CREATE INDEX "UserIdentityDocument_uploadedById_createdAt_idx" ON "UserIdentityDocument"("uploadedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "Team_leaderId_active_idx" ON "Team"("leaderId", "active");

-- CreateIndex
CREATE INDEX "TeamMember_userId_active_idx" ON "TeamMember"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Client_internalCode_key" ON "Client"("internalCode");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_idType_idNumberBlind_idx" ON "Client"("idType", "idNumberBlind");

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
CREATE INDEX "Intake_ownerUserId_idx" ON "Intake"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_internalCode_key" ON "Matter"("internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_firmCaseNo_key" ON "Matter"("firmCaseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_intakeId_key" ON "Matter"("intakeId");

-- CreateIndex
CREATE INDEX "Matter_status_updatedAt_idx" ON "Matter"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Matter_ownerId_idx" ON "Matter"("ownerId");

-- CreateIndex
CREATE INDEX "Matter_registeredById_idx" ON "Matter"("registeredById");

-- CreateIndex
CREATE INDEX "Matter_primaryClientId_idx" ON "Matter"("primaryClientId");

-- CreateIndex
CREATE INDEX "Matter_category_status_idx" ON "Matter"("category", "status");

-- CreateIndex
CREATE INDEX "Matter_causeId_idx" ON "Matter"("causeId");

-- CreateIndex
CREATE INDEX "CustomFieldDef_entityType_order_idx" ON "CustomFieldDef"("entityType", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_entityType_key_key" ON "CustomFieldDef"("entityType", "key");

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
CREATE UNIQUE INDEX "DeadlineRule_code_key" ON "DeadlineRule"("code");

-- CreateIndex
CREATE INDEX "DeadlineRule_enabled_sortOrder_idx" ON "DeadlineRule"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "ProcedureMemo_procedureId_idx" ON "ProcedureMemo"("procedureId");

-- CreateIndex
CREATE INDEX "Party_matterId_role_ordinal_idx" ON "Party"("matterId", "role", "ordinal");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "Party"("name");

-- CreateIndex
CREATE INDEX "Party_idNumber_idx" ON "Party"("idNumber");

-- CreateIndex
CREATE INDEX "Party_enterpriseSocialCode_idx" ON "Party"("enterpriseSocialCode");

-- CreateIndex
CREATE INDEX "procedure_parties_procedureId_standing_ordinal_idx" ON "procedure_parties"("procedureId", "standing", "ordinal");

-- CreateIndex
CREATE INDEX "procedure_parties_partyId_idx" ON "procedure_parties"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_parties_procedureId_partyId_standing_key" ON "procedure_parties"("procedureId", "partyId", "standing");

-- CreateIndex
CREATE INDEX "RelatedEntity_name_idx" ON "RelatedEntity"("name");

-- CreateIndex
CREATE INDEX "MatterLink_matterId_idx" ON "MatterLink"("matterId");

-- CreateIndex
CREATE INDEX "MatterLink_relatedMatterId_idx" ON "MatterLink"("relatedMatterId");

-- CreateIndex
CREATE UNIQUE INDEX "MatterLink_matterId_relatedMatterId_key" ON "MatterLink"("matterId", "relatedMatterId");

-- CreateIndex
CREATE INDEX "Note_matterId_occurredAt_idx" ON "Note"("matterId", "occurredAt");

-- CreateIndex
CREATE INDEX "Document_matterId_category_idx" ON "Document"("matterId", "category");

-- CreateIndex
CREATE INDEX "Document_intakeId_idx" ON "Document"("intakeId");

-- CreateIndex
CREATE INDEX "Document_procedureId_idx" ON "Document"("procedureId");

-- CreateIndex
CREATE INDEX "Document_familyId_idx" ON "Document"("familyId");

-- CreateIndex
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");

-- CreateIndex
CREATE INDEX "Document_templateId_idx" ON "Document"("templateId");

-- CreateIndex
CREATE INDEX "Document_matterId_archiveChecklistItemId_idx" ON "Document"("matterId", "archiveChecklistItemId");

-- CreateIndex
CREATE INDEX "Document_stageId_idx" ON "Document"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_contractScanId_key" ON "InvoiceRequest"("contractScanId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_invoiceFileId_key" ON "InvoiceRequest"("invoiceFileId");

-- CreateIndex
CREATE INDEX "InvoiceRequest_matterId_status_idx" ON "InvoiceRequest"("matterId", "status");

-- CreateIndex
CREATE INDEX "InvoiceRequest_status_requestedAt_idx" ON "InvoiceRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "InvoiceRequest_requestedById_idx" ON "InvoiceRequest"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRequest_id_matterId_key" ON "InvoiceRequest"("id", "matterId");

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
CREATE INDEX "Billing_matterId_status_idx" ON "Billing"("matterId", "status");

-- CreateIndex
CREATE INDEX "FeeEntry_matterId_type_occurredAt_idx" ON "FeeEntry"("matterId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "FeeEntry_type_occurredAt_idx" ON "FeeEntry"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "FeeEntry_beneficiaryUserId_occurredAt_idx" ON "FeeEntry"("beneficiaryUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "FeeEntry_confirmState_occurredAt_idx" ON "FeeEntry"("confirmState", "occurredAt");

-- CreateIndex
CREATE INDEX "CommissionPlan_matterId_idx" ON "CommissionPlan"("matterId");

-- CreateIndex
CREATE INDEX "CommissionPlan_userId_idx" ON "CommissionPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPlan_matterId_userId_key" ON "CommissionPlan"("matterId", "userId");

-- CreateIndex
CREATE INDEX "TimelineEvent_matterId_occurredAt_idx" ON "TimelineEvent"("matterId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveClosurePlan_matterId_key" ON "ArchiveClosurePlan"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRecord_archiveNo_key" ON "ArchiveRecord"("archiveNo");

-- CreateIndex
CREATE INDEX "ArchiveRecord_matterId_idx" ON "ArchiveRecord"("matterId");

-- CreateIndex
CREATE INDEX "ArchiveRecord_archivedAt_idx" ON "ArchiveRecord"("archivedAt");

-- CreateIndex
CREATE INDEX "ArchiveRecord_status_idx" ON "ArchiveRecord"("status");

-- CreateIndex
CREATE INDEX "ArchiveRecord_archivedById_status_idx" ON "ArchiveRecord"("archivedById", "status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "StageTemplate_procedureType_idx" ON "StageTemplate"("procedureType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_docxBlobId_key" ON "DocumentTemplate"("docxBlobId");

-- CreateIndex
CREATE INDEX "DocumentTemplate_category_enabled_idx" ON "DocumentTemplate"("category", "enabled");

-- CreateIndex
CREATE INDEX "DocumentTemplate_isBuiltIn_idx" ON "DocumentTemplate"("isBuiltIn");

-- CreateIndex
CREATE INDEX "DocumentFolder_matterId_orderIndex_idx" ON "DocumentFolder"("matterId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolder_matterId_name_key" ON "DocumentFolder"("matterId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SealRequest_code_key" ON "SealRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SealRequest_draftDocId_key" ON "SealRequest"("draftDocId");

-- CreateIndex
CREATE UNIQUE INDEX "SealRequest_stampedDocId_key" ON "SealRequest"("stampedDocId");

-- CreateIndex
CREATE INDEX "SealRequest_status_requestedAt_idx" ON "SealRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "SealRequest_requestedById_status_idx" ON "SealRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "SealRequest_sealType_status_idx" ON "SealRequest"("sealType", "status");

-- CreateIndex
CREATE INDEX "SealRequest_matterId_idx" ON "SealRequest"("matterId");

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_processed_receivedAt_idx" ON "SmsMessage"("receivedById", "processed", "receivedAt");

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_needsManualAction_idx" ON "SmsMessage"("receivedById", "needsManualAction");

-- CreateIndex
CREATE INDEX "SmsMessage_matchedMatterId_idx" ON "SmsMessage"("matchedMatterId");

-- CreateIndex
CREATE INDEX "SmsMessage_smsType_receivedAt_idx" ON "SmsMessage"("smsType", "receivedAt");

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_rawTextHash_idx" ON "SmsMessage"("receivedById", "rawTextHash");

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
CREATE INDEX "PreservationCase_matterId_idx" ON "PreservationCase"("matterId");

-- CreateIndex
CREATE INDEX "PreservationCase_status_idx" ON "PreservationCase"("status");

-- CreateIndex
CREATE INDEX "PreservationTarget_caseId_idx" ON "PreservationTarget"("caseId");

-- CreateIndex
CREATE INDEX "PreservationProperty_targetId_idx" ON "PreservationProperty"("targetId");

-- CreateIndex
CREATE INDEX "PreservationProperty_status_expiryDate_idx" ON "PreservationProperty"("status", "expiryDate");

-- CreateIndex
CREATE INDEX "PreservationPropertyRenewal_propertyId_idx" ON "PreservationPropertyRenewal"("propertyId");

-- CreateIndex
CREATE INDEX "ExpressTracking_matterId_idx" ON "ExpressTracking"("matterId");

-- CreateIndex
CREATE INDEX "ExpressTracking_trackingNo_idx" ON "ExpressTracking"("trackingNo");

-- CreateIndex
CREATE INDEX "ExpressTracking_createdById_createdAt_idx" ON "ExpressTracking"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobQueue_dedupeKey_key" ON "JobQueue"("dedupeKey");

-- CreateIndex
CREATE INDEX "JobQueue_status_runAt_idx" ON "JobQueue"("status", "runAt");

-- CreateIndex
CREATE INDEX "ExternalCallLog_createdAt_idx" ON "ExternalCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalCallLog_service_createdAt_idx" ON "ExternalCallLog"("service", "createdAt");

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
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewRecord_documentId_reviewedAt_idx" ON "ReviewRecord"("documentId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReviewRecord_matterId_reviewedAt_idx" ON "ReviewRecord"("matterId", "reviewedAt");

-- CreateIndex
CREATE INDEX "FirmFile_category_archivedAt_createdAt_idx" ON "FirmFile"("category", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "FirmFile_supersededById_idx" ON "FirmFile"("supersededById");

-- CreateIndex
CREATE INDEX "Announcement_pinned_archivedAt_publishedAt_idx" ON "Announcement"("pinned", "archivedAt", "publishedAt");

-- CreateIndex
CREATE INDEX "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalContact_category_archivedAt_name_idx" ON "ExternalContact"("category", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "ExternalContact_status_archivedAt_createdAt_idx" ON "ExternalContact"("status", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalContact_reviewedById_idx" ON "ExternalContact"("reviewedById");

-- CreateIndex
CREATE INDEX "ExternalContact_name_idx" ON "ExternalContact"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPermissionGroup_name_key" ON "ApprovalPermissionGroup"("name");

-- CreateIndex
CREATE INDEX "ApprovalPermissionMember_userId_active_idx" ON "ApprovalPermissionMember"("userId", "active");

-- CreateIndex
CREATE INDEX "ApprovalPermissionRule_groupId_active_action_idx" ON "ApprovalPermissionRule"("groupId", "active", "action");

-- CreateIndex
CREATE UNIQUE INDEX "SealPurposeConfig_name_key" ON "SealPurposeConfig"("name");

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

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityDocument" ADD CONSTRAINT "UserIdentityDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityDocument" ADD CONSTRAINT "UserIdentityDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CauseOfAction" ADD CONSTRAINT "CauseOfAction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "CauseOfAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_primaryClientId_fkey" FOREIGN KEY ("primaryClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "MatterProcedure" ADD CONSTRAINT "MatterProcedure_leadLawyerId_fkey" FOREIGN KEY ("leadLawyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "ProcedureMemo" ADD CONSTRAINT "ProcedureMemo_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_parties" ADD CONSTRAINT "procedure_parties_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_parties" ADD CONSTRAINT "procedure_parties_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedEntity" ADD CONSTRAINT "RelatedEntity_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_relatedMatterId_fkey" FOREIGN KEY ("relatedMatterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Document" ADD CONSTRAINT "Document_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_contractScanId_fkey" FOREIGN KEY ("contractScanId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRequest" ADD CONSTRAINT "InvoiceRequest_invoiceFileId_fkey" FOREIGN KEY ("invoiceFileId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_parentFeeEntryId_fkey" FOREIGN KEY ("parentFeeEntryId") REFERENCES "FeeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPlan" ADD CONSTRAINT "CommissionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_financeOwnerId_fkey" FOREIGN KEY ("financeOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_supplementOfId_fkey" FOREIGN KEY ("supplementOfId") REFERENCES "ArchiveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_docxBlobId_fkey" FOREIGN KEY ("docxBlobId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_purposeConfigId_fkey" FOREIGN KEY ("purposeConfigId") REFERENCES "SealPurposeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_draftDocId_fkey" FOREIGN KEY ("draftDocId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_stampedDocId_fkey" FOREIGN KEY ("stampedDocId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_stampedById_fkey" FOREIGN KEY ("stampedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_parentSealRequestId_fkey" FOREIGN KEY ("parentSealRequestId") REFERENCES "SealRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_matchedMatterId_fkey" FOREIGN KEY ("matchedMatterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "PreservationCase" ADD CONSTRAINT "PreservationCase_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationCase" ADD CONSTRAINT "PreservationCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationTarget" ADD CONSTRAINT "PreservationTarget_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PreservationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationProperty" ADD CONSTRAINT "PreservationProperty_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PreservationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationPropertyRenewal" ADD CONSTRAINT "PreservationPropertyRenewal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "PreservationProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationPropertyRenewal" ADD CONSTRAINT "PreservationPropertyRenewal_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressTracking" ADD CONSTRAINT "ExpressTracking_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressTracking" ADD CONSTRAINT "ExpressTracking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmFile" ADD CONSTRAINT "FirmFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmFile" ADD CONSTRAINT "FirmFile_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "FirmFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionMember" ADD CONSTRAINT "ApprovalPermissionMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ApprovalPermissionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionMember" ADD CONSTRAINT "ApprovalPermissionMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionRule" ADD CONSTRAINT "ApprovalPermissionRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ApprovalPermissionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionRule" ADD CONSTRAINT "ApprovalPermissionRule_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "SealPurposeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

