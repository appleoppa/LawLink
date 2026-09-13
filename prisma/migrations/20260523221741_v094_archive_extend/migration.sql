-- CreateEnum
CREATE TYPE "ArchiveClosedReason" AS ENUM ('JUDGMENT', 'MEDIATION', 'WITHDRAWAL', 'SETTLEMENT', 'RULING', 'OTHER');

-- AlterTable
ALTER TABLE "ArchiveRecord" ADD COLUMN     "archiveNo" TEXT NOT NULL,
ADD COLUMN     "catalogDocId" TEXT,
ADD COLUMN     "checklistJson" JSONB NOT NULL,
ADD COLUMN     "closedReason" "ArchiveClosedReason",
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "coverDocId" TEXT,
ADD COLUMN     "judgmentSummary" TEXT,
ADD COLUMN     "missingItems" TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRecord_archiveNo_key" ON "ArchiveRecord"("archiveNo");

-- CreateIndex
CREATE INDEX "ArchiveRecord_matterId_idx" ON "ArchiveRecord"("matterId");

-- CreateIndex
CREATE INDEX "ArchiveRecord_archivedAt_idx" ON "ArchiveRecord"("archivedAt");

