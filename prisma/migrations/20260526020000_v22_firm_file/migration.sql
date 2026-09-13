-- CreateEnum
CREATE TYPE "FirmFileCategory" AS ENUM ('POLICY', 'GUIDE', 'TEMPLATE', 'REFERENCE');

-- CreateTable
CREATE TABLE "FirmFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "FirmFileCategory" NOT NULL,
    "tags" TEXT[],
    "path" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT NOT NULL,
    "supersededById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirmFile_category_archivedAt_createdAt_idx" ON "FirmFile"("category", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "FirmFile_supersededById_idx" ON "FirmFile"("supersededById");

-- AddForeignKey
ALTER TABLE "FirmFile" ADD CONSTRAINT "FirmFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmFile" ADD CONSTRAINT "FirmFile_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "FirmFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

