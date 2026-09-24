-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('NATURAL_PERSON', 'ORGANIZATION');

-- AlterTable
ALTER TABLE "Party" ADD COLUMN "partyType" "PartyType" NOT NULL DEFAULT 'NATURAL_PERSON';
ALTER TABLE "Party" ADD COLUMN "contactName" TEXT;

-- Backfill：旧数据若有企业字段或法代字段，认定为 ORGANIZATION
UPDATE "Party" SET "partyType" = 'ORGANIZATION'
WHERE "enterpriseSocialCode" IS NOT NULL
   OR "enterpriseName" IS NOT NULL
   OR ("legalRep" IS NOT NULL AND "legalRep" <> '');
