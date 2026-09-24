-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "intakeId" TEXT,
ALTER COLUMN "matterId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Document_intakeId_idx" ON "Document"("intakeId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
