-- CreateEnum
CREATE TYPE "ExternalContactCategory" AS ENUM (
  'COURT',
  'PROSECUTOR',
  'POLICE',
  'NOTARY',
  'ARBITRATION',
  'OTHER_FIRM',
  'EXPERT',
  'OTHER'
);

-- CreateTable Announcement
CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "authorId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_pinned_archivedAt_publishedAt_idx" ON "Announcement"("pinned", "archivedAt", "publishedAt");
CREATE INDEX "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable ExternalContact
CREATE TABLE "ExternalContact" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "ExternalContactCategory" NOT NULL,
  "organization" TEXT,
  "title" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "wechat" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "tags" TEXT[],
  "createdById" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExternalContact_category_archivedAt_name_idx" ON "ExternalContact"("category", "archivedAt", "name");
CREATE INDEX "ExternalContact_name_idx" ON "ExternalContact"("name");
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
