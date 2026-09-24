-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "roleDefinitionId" TEXT;

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "normalizedName" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" VARCHAR(60) NOT NULL,
    "scope" VARCHAR(20) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_name_key" ON "RoleDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_normalizedName_key" ON "RoleDefinition"("normalizedName");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy accounts and reject inconsistent custom-role assignments.
ALTER TABLE "User" ADD CONSTRAINT "User_custom_role_consistent"
CHECK (("role"::text = 'CUSTOM' AND "roleDefinitionId" IS NOT NULL)
    OR ("role"::text <> 'CUSTOM' AND "roleDefinitionId" IS NULL));
CREATE INDEX "User_roleDefinitionId_idx" ON "User"("roleDefinitionId");
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_scope_valid" CHECK ("scope" IN ('OWN','TEAM','ALL'));
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_version_positive" CHECK ("version" > 0);

-- Initial administrative role; no existing account is reassigned.
INSERT INTO "RoleDefinition" ("id", "name", "normalizedName", "description", "updatedAt")
VALUES ('cmrolesadministrative00001', '行政', '行政', '公告、律所公共资料、快递及外部联系人维护；审批另按事项授权。', CURRENT_TIMESTAMP);
INSERT INTO "RolePermission" ("roleId", "permissionKey", "scope") VALUES
('cmrolesadministrative00001', 'announcements.manage', 'ALL'),
('cmrolesadministrative00001', 'firm-files.manage', 'ALL'),
('cmrolesadministrative00001', 'express.manage', 'OWN'),
('cmrolesadministrative00001', 'contacts.manage', 'OWN'),
('cmrolesadministrative00001', 'seals.request', 'OWN');
