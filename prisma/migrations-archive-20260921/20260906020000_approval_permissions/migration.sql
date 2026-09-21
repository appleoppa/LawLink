-- Reviewed additive migration. No existing business rows are rewritten.
BEGIN;

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('INTAKE_APPROVE', 'DOCUMENT_APPROVE', 'ARCHIVE_APPROVE', 'INVOICE_APPROVE', 'SEAL_APPROVE', 'SEAL_STAMP');

-- CreateEnum
CREATE TYPE "ApprovalCaseScope" AS ENUM ('ALL_CASES', 'CATEGORIES', 'NON_CASE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SealRequest" ADD COLUMN     "purposeConfigId" TEXT,
ADD COLUMN     "purposeLabel" TEXT;

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

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPermissionGroup_name_key" ON "ApprovalPermissionGroup"("name");

-- CreateIndex
CREATE INDEX "ApprovalPermissionMember_userId_active_idx" ON "ApprovalPermissionMember"("userId", "active");

-- CreateIndex
CREATE INDEX "ApprovalPermissionRule_groupId_active_action_idx" ON "ApprovalPermissionRule"("groupId", "active", "action");

-- CreateIndex
CREATE UNIQUE INDEX "SealPurposeConfig_name_key" ON "SealPurposeConfig"("name");

-- AddForeignKey
ALTER TABLE "SealRequest" ADD CONSTRAINT "SealRequest_purposeConfigId_fkey" FOREIGN KEY ("purposeConfigId") REFERENCES "SealPurposeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionMember" ADD CONSTRAINT "ApprovalPermissionMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ApprovalPermissionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionMember" ADD CONSTRAINT "ApprovalPermissionMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionRule" ADD CONSTRAINT "ApprovalPermissionRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ApprovalPermissionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPermissionRule" ADD CONSTRAINT "ApprovalPermissionRule_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "SealPurposeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
