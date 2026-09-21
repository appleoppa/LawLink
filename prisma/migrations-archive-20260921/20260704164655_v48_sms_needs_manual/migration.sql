-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "needsManualAction" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SmsMessage_receivedById_needsManualAction_idx" ON "SmsMessage"("receivedById", "needsManualAction");


-- v0.48 存量回填：附件提取结果中含待人工状态的短信打标
UPDATE "SmsMessage" SET "needsManualAction" = true
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(("parsedJson"::jsonb)->'attachmentResults', '[]'::jsonb)) AS r
  WHERE r->>'status' IN ('LOGIN_REQUIRED', 'SKIPPED_NO_MATTER')
);
