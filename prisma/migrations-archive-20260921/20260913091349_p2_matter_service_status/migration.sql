-- CreateEnum
CREATE TYPE "MatterServiceStatus" AS ENUM ('SERVICE_ACTIVE', 'SERVICE_COMPLETED');

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "serviceStatus" "MatterServiceStatus" NOT NULL DEFAULT 'SERVICE_ACTIVE';

