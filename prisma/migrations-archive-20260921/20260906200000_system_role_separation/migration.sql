-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('NONE', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "systemRole" "SystemRole" NOT NULL DEFAULT 'NONE';

-- Preserve current system administrators without guessing their business role.
UPDATE "User"
SET "systemRole" = 'SUPER_ADMIN'
WHERE "role" = 'ADMIN';
