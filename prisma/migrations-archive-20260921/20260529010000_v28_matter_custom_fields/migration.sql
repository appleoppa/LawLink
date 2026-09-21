-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('MATTER', 'CLIENT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- AlterTable: 案件自定义字段值（JSON 列方案）
ALTER TABLE "Matter" ADD COLUMN "customValues" JSONB NOT NULL DEFAULT '{}';

-- CreateTable: 自定义字段定义
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "entityType" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_entityType_key_key" ON "CustomFieldDef"("entityType", "key");

-- CreateIndex
CREATE INDEX "CustomFieldDef_entityType_order_idx" ON "CustomFieldDef"("entityType", "order");
