-- CreateEnum
CREATE TYPE "MatterLinkRelation" AS ENUM ('RELATED_CASE', 'REMAND', 'DERIVED_ENFORCEMENT', 'RELATED_CONTRACT', 'REFERENCE_ONLY');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'DEAD');

-- AlterTable
ALTER TABLE "MatterLink" ADD COLUMN     "notedById" TEXT,
ADD COLUMN     "relation" "MatterLinkRelation" NOT NULL DEFAULT 'RELATED_CASE';

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

-- CreateIndex
CREATE UNIQUE INDEX "JobQueue_dedupeKey_key" ON "JobQueue"("dedupeKey");

-- CreateIndex
CREATE INDEX "JobQueue_status_runAt_idx" ON "JobQueue"("status", "runAt");

