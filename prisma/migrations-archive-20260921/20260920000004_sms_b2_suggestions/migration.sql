-- CreateEnum
CREATE TYPE "SmsAnalysisState" AS ENUM ('PENDING', 'ANALYZING', 'ANALYZED', 'NEEDS_OCR', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsSuggestionKind" AS ENUM ('FIELD_CHANGE', 'HEARING', 'DEADLINE', 'MATTER_MATCH', 'DOC_TYPE');

-- CreateEnum
CREATE TYPE "SmsSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "SmsInboundFile" ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisState" "SmsAnalysisState" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "docType" TEXT,
ADD COLUMN     "extractedPages" INTEGER;

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

-- CreateIndex
CREATE INDEX "SmsSuggestion_smsId_status_idx" ON "SmsSuggestion"("smsId", "status");

-- CreateIndex
CREATE INDEX "SmsSuggestion_fileId_idx" ON "SmsSuggestion"("fileId");

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "SmsMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "SmsInboundFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsSuggestion" ADD CONSTRAINT "SmsSuggestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

