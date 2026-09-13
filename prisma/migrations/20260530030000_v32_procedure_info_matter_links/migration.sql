-- AlterTable
ALTER TABLE "MatterProcedure" ADD COLUMN     "judgeAssistant" TEXT,
ADD COLUMN     "judgeAssistantContact" TEXT,
ADD COLUMN     "jurisdiction" TEXT,
ADD COLUMN     "ourStanding" "LitigationStanding",
ADD COLUMN     "presidingJudge" TEXT,
ADD COLUMN     "presidingJudgeContact" TEXT;

-- CreateTable
CREATE TABLE "MatterLink" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "relatedMatterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatterLink_matterId_idx" ON "MatterLink"("matterId");

-- CreateIndex
CREATE INDEX "MatterLink_relatedMatterId_idx" ON "MatterLink"("relatedMatterId");

-- CreateIndex
CREATE UNIQUE INDEX "MatterLink_matterId_relatedMatterId_key" ON "MatterLink"("matterId", "relatedMatterId");

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_relatedMatterId_fkey" FOREIGN KEY ("relatedMatterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

