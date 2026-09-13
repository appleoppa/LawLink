-- DropIndex
DROP INDEX "Client_idType_idNumber_idx";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "idNumberBlind" TEXT;

-- CreateIndex
CREATE INDEX "Client_idType_idNumberBlind_idx" ON "Client"("idType", "idNumberBlind");


-- v1.x P1 §三: 唯一性兜底从明文列换到盲索引列——
-- 明文列后续存密文，不可再作唯一约束；旧部分唯一索引一并替换。
DROP INDEX IF EXISTS "Client_idType_idNumber_active_key";
CREATE UNIQUE INDEX "Client_idType_idNumberBlind_active_key"
  ON "Client"("idType", "idNumberBlind")
  WHERE "idNumberBlind" IS NOT NULL AND "idType" IS NOT NULL AND "deletedAt" IS NULL;
