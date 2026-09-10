-- Restore the two nullable Hearing projection fields required by the runtime Prisma schema.
-- Intentionally scoped: do not apply unrelated schema drift in this migration.
ALTER TABLE "Hearing"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "contact" TEXT;
