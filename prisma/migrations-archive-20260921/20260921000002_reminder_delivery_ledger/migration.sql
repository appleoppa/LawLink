-- CreateEnum
CREATE TYPE "ReminderDeliveryObjectType" AS ENUM ('DEADLINE', 'HEARING', 'PRESERVATION_PROPERTY', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryKind" AS ENUM ('OFFSET', 'EXPIRED', 'ESCALATION', 'RECIPIENT_MISSING', 'DIGEST');

-- CreateEnum
CREATE TYPE "ReminderDeliveryChannel" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'SUPERSEDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "reminder_delivery" (
    "id" TEXT NOT NULL,
    "objectType" "ReminderDeliveryObjectType" NOT NULL,
    "objectId" TEXT NOT NULL,
    "kind" "ReminderDeliveryKind" NOT NULL,
    "offset" INTEGER NOT NULL,
    "channel" "ReminderDeliveryChannel" NOT NULL,
    "dayKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_delivery_day_channel_status" ON "reminder_delivery"("dayKey", "channel", "status");

-- CreateIndex
CREATE INDEX "reminder_delivery_status_registeredAt_idx" ON "reminder_delivery"("status", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_delivery_dedupe" ON "reminder_delivery"("objectType", "objectId", "kind", "offset", "channel", "dayKey", "userId");

