-- v0.42: 所内案号（律所可配置模板生成的案件编号）
-- firmCaseNo 可空且唯一；Postgres 允许多个 NULL，便于历史案件回填前留空。
ALTER TABLE "Matter" ADD COLUMN "firmCaseNo" TEXT;
CREATE UNIQUE INDEX "Matter_firmCaseNo_key" ON "Matter"("firmCaseNo");
