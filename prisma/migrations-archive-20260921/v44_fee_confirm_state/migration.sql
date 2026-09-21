-- CreateEnum
CREATE TYPE "FeeConfirmState" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "FeeEntry" ADD COLUMN     "confirmState" "FeeConfirmState" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT;

-- CreateIndex
CREATE INDEX "FeeEntry_confirmState_occurredAt_idx" ON "FeeEntry"("confirmState", "occurredAt");

-- AddForeignKey
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

