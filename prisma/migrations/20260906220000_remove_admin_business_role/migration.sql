-- System administration is represented only by User.systemRole.
-- Keep every account as a business user while removing the former mixed ADMIN role.
BEGIN;

UPDATE "User"
SET "role" = 'LAWYER'
WHERE "role" = 'ADMIN';

-- Role-based seal approvers are no longer used. Remove the retired enum value
-- from the stored arrays so PostgreSQL can rebuild UserRole safely.
UPDATE "SealTypeConfig"
SET "approverRoles" = ARRAY(
  SELECT stored_role
  FROM unnest("approverRoles") AS stored_role
  WHERE stored_role::text <> 'ADMIN'
);

-- AlterEnum
CREATE TYPE "UserRole_new" AS ENUM ('CUSTOM', 'PRINCIPAL_LAWYER', 'LAWYER', 'ASSISTANT', 'FINANCE');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "SealTypeConfig" ALTER COLUMN "approverRoles" TYPE "UserRole_new"[] USING ("approverRoles"::text::"UserRole_new"[]);
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'LAWYER';
COMMIT;
