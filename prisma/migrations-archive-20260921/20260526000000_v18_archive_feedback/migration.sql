-- v0.18: 归档审批反馈闭环
-- 1. ArchiveRecord.archivedById 记录申请人 User.id（用于通知路由）
-- 2. NotificationType 加 ARCHIVE_APPROVED / ARCHIVE_REJECTED

ALTER TABLE "ArchiveRecord" ADD COLUMN "archivedById" TEXT;
CREATE INDEX "ArchiveRecord_archivedById_status_idx" ON "ArchiveRecord"("archivedById", "status");

CREATE TYPE "NotificationType_NEW" AS ENUM (
  'PRESERVATION_EXPIRY',
  'HEARING_REMINDER',
  'DEADLINE_REMINDER',
  'SEAL_STATUS_CHANGE',
  'SMS_ARRIVAL',
  'TASK_ASSIGNED',
  'SYSTEM',
  'ARCHIVE_APPROVED',
  'ARCHIVE_REJECTED'
);

ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_NEW" USING "type"::text::"NotificationType_NEW";
DROP TYPE "NotificationType";
ALTER TYPE "NotificationType_NEW" RENAME TO "NotificationType";
