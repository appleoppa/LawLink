-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('FACT', 'CLAIM', 'ANALYSIS', 'ISSUE', 'TODO_VERIFY');

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceItem_matterId_kind_idx" ON "EvidenceItem"("matterId", "kind");

-- CreateIndex
CREATE INDEX "EvidenceItem_sourceDocumentId_idx" ON "EvidenceItem"("sourceDocumentId");

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

