-- Repair schema drift for Hearing fields added after the original migration history.
-- IF NOT EXISTS keeps this safe when a runtime already received the columns manually.
ALTER TABLE "Hearing"
    ADD COLUMN IF NOT EXISTS "address" TEXT,
    ADD COLUMN IF NOT EXISTS "contact" TEXT;
