-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('INTAKE', 'RETAINER', 'LITIGATION', 'HEARING', 'WORK_PRODUCT', 'ARCHIVE', 'CLOSING', 'BLANK');

-- CreateEnum
CREATE TYPE "SealType" AS ENUM ('OFFICIAL_SEAL', 'CONTRACT_SEAL', 'FINANCE_SEAL', 'LEGAL_REP_SEAL', 'CONTRACT_REVIEW_SEAL');

-- CreateEnum
CREATE TYPE "SealRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'STAMPED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('NORMAL', 'URGENT');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "templateContextSnapshot" JSONB,
ADD COLUMN     "templateId" TEXT;

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
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");

-- CreateIndex
CREATE INDEX "Document_templateId_idx" ON "Document"("templateId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_docxBlobId_fkey" FOREIGN KEY ("docxBlobId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
