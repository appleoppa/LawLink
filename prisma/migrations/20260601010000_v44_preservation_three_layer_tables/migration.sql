-- v0.44 保全三层模型建表（补写）
--
-- 背景：`20260601_v044_preservation_three_layer` 是一个空迁移（内容仅有
-- "-- This is an empty migration."），当时这四张表是用 `prisma db push` 直接推到
-- 本地数据库的，建表语句从未进入迁移历史。后果是全新安装无法完成初始化——
-- `20260704070236_v48_drop_legacy_preservation` 会向 "PreservationCase" 搬迁数据，
-- 而该表在全新库中根本不存在，迁移在此中断（P3009）。
--
-- 本迁移补上缺失的 DDL，命名使其排在 20260704070236 之前（Prisma 按目录名字典序执行），
-- 且排在创建相关 enum 的 20260523125802_v09_sms_preservation 之后。
--
-- 全部语句均为幂等：已通过 db push 建好这些表的既有实例，执行本迁移为无操作，
-- 不会报错、不会丢数据。

CREATE TABLE IF NOT EXISTS "PreservationCase" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "type" "PreservationType" NOT NULL,
    "status" "PreservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "court" TEXT,
    "rulingNumber" TEXT,
    "guaranteeType" "GuaranteeType",
    "appliedAt" TIMESTAMP(3),
    "note" TEXT,
    "ownerId" TEXT,
    "remindDays" INTEGER[] DEFAULT ARRAY[30, 15, 7, 3, 1]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PreservationTarget" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PreservationProperty" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "propertyDetail" TEXT,
    "amount" DECIMAL(18,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" "PreservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreservationProperty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PreservationPropertyRenewal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "renewedAt" TIMESTAMP(3) NOT NULL,
    "oldExpiryDate" TIMESTAMP(3) NOT NULL,
    "newExpiryDate" TIMESTAMP(3) NOT NULL,
    "renewalDuration" INTEGER NOT NULL,
    "note" TEXT,
    "performedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreservationPropertyRenewal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PreservationCase_matterId_idx" ON "PreservationCase"("matterId");
CREATE INDEX IF NOT EXISTS "PreservationCase_status_idx" ON "PreservationCase"("status");
CREATE INDEX IF NOT EXISTS "PreservationTarget_caseId_idx" ON "PreservationTarget"("caseId");
CREATE INDEX IF NOT EXISTS "PreservationProperty_targetId_idx" ON "PreservationProperty"("targetId");
CREATE INDEX IF NOT EXISTS "PreservationProperty_status_expiryDate_idx" ON "PreservationProperty"("status", "expiryDate");
CREATE INDEX IF NOT EXISTS "PreservationPropertyRenewal_propertyId_idx" ON "PreservationPropertyRenewal"("propertyId");

-- 外键：PostgreSQL 的 ADD CONSTRAINT 不支持 IF NOT EXISTS，逐个查 pg_constraint 后再加
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationCase_matterId_fkey') THEN
    ALTER TABLE "PreservationCase" ADD CONSTRAINT "PreservationCase_matterId_fkey"
      FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationCase_ownerId_fkey') THEN
    ALTER TABLE "PreservationCase" ADD CONSTRAINT "PreservationCase_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationTarget_caseId_fkey') THEN
    ALTER TABLE "PreservationTarget" ADD CONSTRAINT "PreservationTarget_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "PreservationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationProperty_targetId_fkey') THEN
    ALTER TABLE "PreservationProperty" ADD CONSTRAINT "PreservationProperty_targetId_fkey"
      FOREIGN KEY ("targetId") REFERENCES "PreservationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationPropertyRenewal_propertyId_fkey') THEN
    ALTER TABLE "PreservationPropertyRenewal" ADD CONSTRAINT "PreservationPropertyRenewal_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "PreservationProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreservationPropertyRenewal_performedById_fkey') THEN
    ALTER TABLE "PreservationPropertyRenewal" ADD CONSTRAINT "PreservationPropertyRenewal_performedById_fkey"
      FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
