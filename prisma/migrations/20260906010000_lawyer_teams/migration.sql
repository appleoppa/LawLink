-- Apply only after review. Transaction protects against partial schema/backfill changes.
BEGIN;

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "registeredById" TEXT;

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canViewAllMatters" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "Team_leaderId_active_idx" ON "Team"("leaderId", "active");

-- CreateIndex
CREATE INDEX "TeamMember_userId_active_idx" ON "TeamMember"("userId", "active");

-- CreateIndex
CREATE INDEX "Matter_registeredById_idx" ON "Matter"("registeredById");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Original intake creator is authoritative, not the approving user.
UPDATE "Matter" AS m SET "registeredById" = i."createdById"
FROM "Intake" AS i JOIN "User" AS u ON u.id = i."createdById"
WHERE m."intakeId" = i.id AND m."registeredById" IS NULL;

-- Direct historical creation: use the earliest attributable creation audit.
UPDATE "Matter" AS m SET "registeredById" = a."userId"
FROM (
  SELECT DISTINCT ON (a."targetId") a."targetId", a."userId"
  FROM "AuditLog" a JOIN "User" u ON u.id = a."userId"
  WHERE a.action = 'MATTER_CREATE' AND a."targetType" = 'Matter'
  ORDER BY a."targetId", a."createdAt", a.id
) a
WHERE m.id = a."targetId" AND m."intakeId" IS NULL AND m."registeredById" IS NULL;

COMMIT;
