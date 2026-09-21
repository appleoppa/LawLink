-- CreateTable
CREATE TABLE "reminder_delivery" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "offset" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
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
CREATE INDEX "reminder_delivery_status_scheduledAt_idx" ON "reminder_delivery"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_delivery_dedupe" ON "reminder_delivery"("objectType", "objectId", "offset", "channel", "dayKey", "userId");

