-- AlterTable: 非诉 / 顾问 / 专项 专属字段
ALTER TABLE "Intake" ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "counselType" TEXT,
ADD COLUMN     "deliverables" TEXT,
ADD COLUMN     "serviceEnd" TIMESTAMP(3),
ADD COLUMN     "serviceScope" TEXT,
ADD COLUMN     "serviceStart" TIMESTAMP(3);
