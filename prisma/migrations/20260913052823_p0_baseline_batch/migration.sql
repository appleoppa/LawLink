-- CreateEnum
CREATE TYPE "ClientIdType" AS ENUM ('ID_CARD', 'USCC', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentTextSource" AS ENUM ('DOCX', 'PDF_TEXT', 'OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentOcrStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'SKIP');

-- CreateEnum
CREATE TYPE "DeadlineConfirmStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ADJUSTED');

-- DropIndex
DROP INDEX "Client_idNumber_idx";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "idType" "ClientIdType";

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
ADD COLUMN     "textContent" TEXT,
ADD COLUMN     "textSource" "DocumentTextSource";

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "teamAccessRestricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Client_idType_idNumber_idx" ON "Client"("idType", "idNumber");


-- v1.x P0-1: 证件号码规范化（trim；身份证尾号 x 统一大写）
UPDATE "Client" SET "idNumber" = UPPER(TRIM("idNumber")) WHERE "idNumber" IS NOT NULL;

-- v1.x P0-1: 身份持续唯一——部分唯一索引，仅约束已填号码且未删除的行。
-- 存量行 idType 为 NULL 不受约束（补录证件类型后纳入）；软删除行不释放身份，
-- 重复主体经合并流程处理（保留原 ID 映射与合并依据）。
CREATE UNIQUE INDEX "Client_idType_idNumber_active_key"
  ON "Client"("idType", "idNumber")
  WHERE "idNumber" IS NOT NULL AND "idType" IS NOT NULL AND "deletedAt" IS NULL;
