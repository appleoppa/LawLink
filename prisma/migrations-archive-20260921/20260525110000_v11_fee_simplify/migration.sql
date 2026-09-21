-- v0.11: 律师费精简为 FIXED / CONTINGENCY，新增 contingencyTerms

-- 1. 清空所有 Intake 的费用相关字段（按用户授权"直接清空覆盖"）
UPDATE "Intake"
  SET "feeType" = NULL,
      "feeAmount" = NULL,
      "feeSchedule" = NULL,
      "feeNote" = NULL;

-- 2. 替换 FeeType enum
ALTER TYPE "FeeType" RENAME TO "FeeType_old";
CREATE TYPE "FeeType" AS ENUM ('FIXED', 'CONTINGENCY');
ALTER TABLE "Intake"
  ALTER COLUMN "feeType" TYPE "FeeType" USING (NULL::text::"FeeType");
DROP TYPE "FeeType_old";

-- 3. 新增 contingencyTerms 字段
ALTER TABLE "Intake" ADD COLUMN "contingencyTerms" TEXT;
