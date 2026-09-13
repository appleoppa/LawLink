-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('HEARING_NOTICE', 'SERVICE_NOTICE', 'FEE_NOTICE', 'MEDIATION', 'ENFORCEMENT', 'FILING_NOTICE', 'JUDGMENT_NOTICE', 'EVIDENCE_SUBMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "SmsMatchSource" AS ENUM ('AUTO_CASE_NUMBER', 'MANUAL', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "PreservationType" AS ENUM ('PRE_LITIGATION', 'LITIGATION', 'ENFORCEMENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('BANK_DEPOSIT', 'REAL_ESTATE', 'VEHICLE', 'EQUITY', 'IP', 'OTHER');

-- CreateEnum
CREATE TYPE "GuaranteeType" AS ENUM ('CASH_DEPOSIT', 'GUARANTEE_LETTER', 'PROPERTY', 'NONE');

-- CreateEnum
CREATE TYPE "PreservationStatus" AS ENUM ('ACTIVE', 'RENEWED', 'EXPIRED', 'LIFTED');

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preservation" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "type" "PreservationType" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "amount" DECIMAL(18,2),
    "respondent" TEXT NOT NULL,
    "guaranteeType" "GuaranteeType",
    "appliedAt" TIMESTAMP(3),
    "startDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "court" TEXT,
    "rulingNumber" TEXT,
    "propertyDetail" TEXT,
    "note" TEXT,
    "ownerId" TEXT,
    "remindDays" INTEGER[] DEFAULT ARRAY[30, 15, 7, 3, 1]::INTEGER[],
    "status" "PreservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Preservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreservationRenewal" (
    "id" TEXT NOT NULL,
    "preservationId" TEXT NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "oldExpiryDate" TIMESTAMP(3) NOT NULL,
    "newExpiryDate" TIMESTAMP(3) NOT NULL,
    "renewalDuration" INTEGER NOT NULL,
    "note" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreservationRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_processed_receivedAt_idx" ON "SmsMessage"("receivedById", "processed", "receivedAt");

-- CreateIndex
CREATE INDEX "SmsMessage_matchedMatterId_idx" ON "SmsMessage"("matchedMatterId");

-- CreateIndex
CREATE INDEX "SmsMessage_smsType_receivedAt_idx" ON "SmsMessage"("smsType", "receivedAt");

-- CreateIndex
CREATE INDEX "Preservation_matterId_idx" ON "Preservation"("matterId");

-- CreateIndex
CREATE INDEX "Preservation_status_expiryDate_idx" ON "Preservation"("status", "expiryDate");

-- CreateIndex
CREATE INDEX "Preservation_ownerId_status_idx" ON "Preservation"("ownerId", "status");

-- CreateIndex
CREATE INDEX "PreservationRenewal_preservationId_idx" ON "PreservationRenewal"("preservationId");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_matchedMatterId_fkey" FOREIGN KEY ("matchedMatterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preservation" ADD CONSTRAINT "Preservation_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preservation" ADD CONSTRAINT "Preservation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationRenewal" ADD CONSTRAINT "PreservationRenewal_preservationId_fkey" FOREIGN KEY ("preservationId") REFERENCES "Preservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreservationRenewal" ADD CONSTRAINT "PreservationRenewal_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
