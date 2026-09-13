-- CreateEnum
CREATE TYPE "ExpressDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateTable
CREATE TABLE "ExpressTracking" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "trackingNo" TEXT NOT NULL,
    "companyCode" TEXT,
    "direction" "ExpressDirection" NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT,
    "recipientPhone" TEXT,
    "lastState" TEXT,
    "lastUpdateAt" TIMESTAMP(3),
    "tracesJson" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpressTracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpressTracking_matterId_idx" ON "ExpressTracking"("matterId");

-- CreateIndex
CREATE INDEX "ExpressTracking_trackingNo_idx" ON "ExpressTracking"("trackingNo");

-- CreateIndex
CREATE INDEX "ExpressTracking_createdById_createdAt_idx" ON "ExpressTracking"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "ExpressTracking" ADD CONSTRAINT "ExpressTracking_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpressTracking" ADD CONSTRAINT "ExpressTracking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
