-- 2026-09-20 B1：法院短信来件文件与处理状态机（docs/SMS-B1-DESIGN-20260920.md §2）
-- 由 prisma migrate diff 生成结构 + 手工回填与部分唯一索引。
-- 安全性：新表/新列/新枚举均为增量；回填幂等；存量仅演示数据。
-- 执行前已备份（backups/hardening-migration-20260920 之后的 b1 备份）。
-- CreateEnum
CREATE TYPE "SmsProcessingState" AS ENUM ('PROCESSING', 'NEEDS_MANUAL_FETCH', 'NEEDS_MATCH', 'PARTIAL', 'READY_FOR_REVIEW', 'ORGANIZED', 'NO_ACTION_NEEDED');

-- CreateEnum
CREATE TYPE "SmsFileState" AS ENUM ('PENDING_REVIEW', 'FILED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SmsFileSource" AS ENUM ('LINK_FETCH', 'MANUAL_UPLOAD');

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "processingNote" TEXT,
ADD COLUMN     "processingState" "SmsProcessingState" NOT NULL DEFAULT 'READY_FOR_REVIEW',
ADD COLUMN     "rawTextHash" TEXT NOT NULL DEFAULT '';

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsInboundFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsInboundFile_matterId_state_idx" ON "SmsInboundFile"("matterId", "state");

-- CreateIndex
CREATE INDEX "SmsInboundFile_downloadedById_state_idx" ON "SmsInboundFile"("downloadedById", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SmsInboundFile_smsId_sha256_key" ON "SmsInboundFile"("smsId", "sha256");

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_rawTextHash_idx" ON "SmsMessage"("receivedById", "rawTextHash");

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "SmsMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInboundFile" ADD CONSTRAINT "SmsInboundFile_downloadedById_fkey" FOREIGN KEY ("downloadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 回填：原文哈希（幂等，重复执行安全）
UPDATE "SmsMessage" SET "rawTextHash" = encode(sha256("rawText"::bytea), 'hex') WHERE "rawTextHash" = '';

-- 回填：处理状态按既有人工标记映射（processed=true → NO_ACTION_NEEDED；needsManualAction → NEEDS_MANUAL_FETCH；其余 → READY_FOR_REVIEW）
UPDATE "SmsMessage" SET "processingState" = 'NO_ACTION_NEEDED'::"SmsProcessingState" WHERE "processed" = TRUE;
UPDATE "SmsMessage" SET "processingState" = 'NEEDS_MANUAL_FETCH'::"SmsProcessingState" WHERE "needsManualAction" = TRUE AND "processed" = FALSE;

-- 粘贴幂等：同一收件人同一原文只允许一条（部分唯一——仅约束已回填哈希的行；Prisma schema 层以注释表达，同 Client 身份唯一索引先例）
CREATE UNIQUE INDEX "SmsMessage_receiver_text_unique" ON "SmsMessage" ("receivedById", "rawTextHash") WHERE "rawTextHash" <> '';
