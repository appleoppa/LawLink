-- CreateEnum
CREATE TYPE "DeadlinePeriodUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

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

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineRule_code_key" ON "DeadlineRule"("code");

-- CreateIndex
CREATE INDEX "DeadlineRule_enabled_sortOrder_idx" ON "DeadlineRule"("enabled", "sortOrder");

