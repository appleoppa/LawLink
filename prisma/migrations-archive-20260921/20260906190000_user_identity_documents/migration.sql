-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM (
    'PRC_RESIDENT_ID',
    'HK_MACAO_TAIWAN_RESIDENCE_PERMIT',
    'PRC_HK_MACAO_TRAVEL_PERMIT',
    'HK_MACAO_MAINLAND_TRAVEL_PERMIT',
    'TAIWAN_MAINLAND_TRAVEL_PERMIT',
    'PASSPORT',
    'FOREIGN_PERMANENT_RESIDENT_ID',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "IdentityDocumentPageKind" AS ENUM (
    'PORTRAIT_SIDE',
    'EMBLEM_SIDE',
    'DATA_PAGE',
    'SUPPLEMENTARY_PAGE',
    'OTHER'
);

-- Preserve existing resident ID numbers while expanding the identity model.
DROP INDEX "User_idNumber_key";
ALTER TABLE "User" RENAME COLUMN "idNumber" TO "identityDocumentNumber";
ALTER TABLE "User" ALTER COLUMN "identityDocumentNumber" TYPE VARCHAR(50);
ALTER TABLE "User"
    ADD COLUMN "identityDocumentName" VARCHAR(60),
    ADD COLUMN "identityDocumentType" "IdentityDocumentType";

UPDATE "User"
SET "identityDocumentType" = 'PRC_RESIDENT_ID'
WHERE "identityDocumentNumber" IS NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_identity_document_consistent" CHECK (
    (
        "identityDocumentType" IS NULL
        AND "identityDocumentNumber" IS NULL
        AND "identityDocumentName" IS NULL
    )
    OR
    (
        "identityDocumentType" IS NOT NULL
        AND "identityDocumentNumber" IS NOT NULL
        AND btrim("identityDocumentNumber") <> ''
        AND (
            ("identityDocumentType" = 'OTHER' AND NULLIF(btrim("identityDocumentName"), '') IS NOT NULL)
            OR
            ("identityDocumentType" <> 'OTHER' AND "identityDocumentName" IS NULL)
        )
    )
);

-- CreateTable
CREATE TABLE "UserIdentityDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKind" "IdentityDocumentPageKind" NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserIdentityDocument_userId_active_idx" ON "UserIdentityDocument"("userId", "active");

-- CreateIndex
CREATE INDEX "UserIdentityDocument_uploadedById_createdAt_idx" ON "UserIdentityDocument"("uploadedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_identityDocumentType_identityDocumentNumber_key" ON "User"("identityDocumentType", "identityDocumentNumber");

-- AddForeignKey
ALTER TABLE "UserIdentityDocument" ADD CONSTRAINT "UserIdentityDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityDocument" ADD CONSTRAINT "UserIdentityDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
