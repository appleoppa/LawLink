-- CreateTable
CREATE TABLE "ExternalCallLog" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "action" TEXT,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalCallLog_createdAt_idx" ON "ExternalCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExternalCallLog_service_createdAt_idx" ON "ExternalCallLog"("service", "createdAt");

