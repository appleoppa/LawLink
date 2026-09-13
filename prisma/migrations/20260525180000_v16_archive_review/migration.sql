-- v0.16: 归档审批流
CREATE TYPE "ArchiveStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "ArchiveRecord"
  ADD COLUMN "status" "ArchiveStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;

-- 历史已存在记录直接标 APPROVED（旧版本直接归档，相当于已通过）
UPDATE "ArchiveRecord" SET "status" = 'APPROVED' WHERE "status" = 'PENDING_REVIEW';

CREATE INDEX "ArchiveRecord_status_idx" ON "ArchiveRecord"("status");
