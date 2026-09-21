-- AlterTable
ALTER TABLE "User" ADD COLUMN     "idNumber" VARCHAR(18);

-- CreateIndex
CREATE UNIQUE INDEX "User_idNumber_key" ON "User"("idNumber");
