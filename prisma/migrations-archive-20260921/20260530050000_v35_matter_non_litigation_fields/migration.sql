-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "barFiling" "BarFilingType",
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "counselType" TEXT,
ADD COLUMN     "deliverables" TEXT,
ADD COLUMN     "serviceEnd" TIMESTAMP(3),
ADD COLUMN     "serviceScope" TEXT,
ADD COLUMN     "serviceStart" TIMESTAMP(3);

