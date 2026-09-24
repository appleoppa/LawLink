-- AlterEnum
ALTER TYPE "ReminderDeliveryObjectType" ADD VALUE 'ARCHIVE_BORROW';

-- CreateTable
CREATE TABLE "archive_borrow_request" (
    "id" TEXT NOT NULL,
    "archiveRecordId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'WHOLE_VOLUME',
    "documentIds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "accessUntil" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_borrow_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_borrow_request_status_accessUntil_idx" ON "archive_borrow_request"("status", "accessUntil");

-- CreateIndex
CREATE INDEX "archive_borrow_request_applicantId_createdAt_idx" ON "archive_borrow_request"("applicantId", "createdAt");

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_borrow_request" ADD CONSTRAINT "archive_borrow_request_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

