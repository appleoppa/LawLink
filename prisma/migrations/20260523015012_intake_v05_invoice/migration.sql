/*
  Warnings:

  - You are about to drop the column `source` on the `Intake` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('LUMP_SUM', 'INSTALLMENT', 'CONTINGENCY_FULL', 'CONTINGENCY_PARTIAL', 'HOURLY');

-- CreateEnum
CREATE TYPE "InvoiceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LitigationStanding" ADD VALUE 'COUNTERCLAIM_PLAINTIFF';
ALTER TYPE "LitigationStanding" ADD VALUE 'COUNTERCLAIM_DEFENDANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'APPELLANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'APPELLEE';
ALTER TYPE "LitigationStanding" ADD VALUE 'RETRIAL_APPLICANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'RETRIAL_RESPONDENT';
ALTER TYPE "LitigationStanding" ADD VALUE 'ENFORCEMENT_APPLICANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'EXECUTED_PERSON';
ALTER TYPE "LitigationStanding" ADD VALUE 'ADMIN_PLAINTIFF';
ALTER TYPE "LitigationStanding" ADD VALUE 'ADMIN_DEFENDANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'ADMIN_RECONSIDERATION_APPLICANT';
ALTER TYPE "LitigationStanding" ADD VALUE 'ADMIN_RECONSIDERATION_RESPONDENT';

-- AlterTable
ALTER TABLE "Intake" DROP COLUMN "source",
ADD COLUMN     "claimAmount" DECIMAL(14,2),
ADD COLUMN     "claimDescription" TEXT,
ADD COLUMN     "clientType" "ClientType",
ADD COLUMN     "coUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "feeAmount" DECIMAL(14,2),
ADD COLUMN     "feeNote" TEXT,
ADD COLUMN     "feeSchedule" TEXT,
ADD COLUMN     "feeType" "FeeType",
ADD COLUMN     "firstAgency" TEXT,
ADD COLUMN     "firstProcedureType" "ProcedureType",
ADD COLUMN     "ourStanding" "LitigationStanding",
ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "standing" "LitigationStanding";

-- CreateTable
CREATE TABLE "InvoiceRequest" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "title" TEXT,
    "status" "InvoiceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestNote" TEXT,
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
CREATE INDEX "Intake_ownerUserId_idx" ON "Intake"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
