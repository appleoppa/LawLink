-- v0.48: 移除旧 Preservation / PreservationRenewal 单表模型
-- 先把存量数据无损迁入 v0.44 三层模型（case → target → property），再删表。
-- 迁移生成的 ID 带 mig_ 前缀，保留与旧记录的溯源关系。

-- Step 1: 旧 Preservation → PreservationCase（案件层字段）
INSERT INTO "PreservationCase"
  ("id", "matterId", "type", "status", "court", "rulingNumber", "guaranteeType",
   "appliedAt", "note", "ownerId", "remindDays", "createdAt", "updatedAt")
SELECT
  'mig_c_' || p."id", p."matterId", p."type", p."status",
  NULLIF(p."court", ''), NULLIF(p."rulingNumber", ''), p."guaranteeType",
  p."appliedAt", p."note", p."ownerId", p."remindDays", p."createdAt", p."updatedAt"
FROM "Preservation" p;

-- Step 2: 被保全人层（旧模型一条记录一个被保全人）
INSERT INTO "PreservationTarget" ("id", "caseId", "name", "createdAt", "updatedAt")
SELECT 'mig_t_' || p."id", 'mig_c_' || p."id", p."respondent", p."createdAt", p."updatedAt"
FROM "Preservation" p;

-- Step 3: 财产层（财产类型/金额/期限）
INSERT INTO "PreservationProperty"
  ("id", "targetId", "propertyType", "propertyDetail", "amount",
   "startDate", "duration", "expiryDate", "status", "createdAt", "updatedAt")
SELECT
  'mig_p_' || p."id", 'mig_t_' || p."id", p."propertyType",
  NULLIF(p."propertyDetail", ''), p."amount",
  p."startDate", p."duration", p."expiryDate", p."status", p."createdAt", p."updatedAt"
FROM "Preservation" p;

-- Step 4: 续保记录
INSERT INTO "PreservationPropertyRenewal"
  ("id", "propertyId", "renewedAt", "oldExpiryDate", "newExpiryDate",
   "renewalDuration", "note", "performedById", "createdAt")
SELECT
  'mig_r_' || r."id", 'mig_p_' || r."preservationId", r."renewedAt",
  r."oldExpiryDate", r."newExpiryDate", r."renewalDuration", r."note",
  r."performedById", r."createdAt"
FROM "PreservationRenewal" r;

-- Step 5: 删除旧表
-- DropForeignKey
ALTER TABLE "Preservation" DROP CONSTRAINT "Preservation_matterId_fkey";

-- DropForeignKey
ALTER TABLE "Preservation" DROP CONSTRAINT "Preservation_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PreservationRenewal" DROP CONSTRAINT "PreservationRenewal_performedById_fkey";

-- DropForeignKey
ALTER TABLE "PreservationRenewal" DROP CONSTRAINT "PreservationRenewal_preservationId_fkey";

-- DropTable
DROP TABLE "Preservation";

-- DropTable
DROP TABLE "PreservationRenewal";
