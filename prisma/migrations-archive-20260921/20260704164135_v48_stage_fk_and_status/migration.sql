-- CreateEnum
CREATE TYPE "MatterStageStatus" AS ENUM ('ACTIVE', 'HIDDEN');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "MatterStage" ADD COLUMN     "status" "MatterStageStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Document_stageId_idx" ON "Document"("stageId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "MatterStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- v0.48 存量回填：把既有"阶段:环节名"标签关联转为外键（同程序内按环节名匹配）
UPDATE "Document" d
SET "stageId" = s."id"
FROM "MatterStage" s
WHERE d."procedureId" = s."procedureId"
  AND d."stageId" IS NULL
  AND ('阶段:' || s."name") = ANY(d."tags");
