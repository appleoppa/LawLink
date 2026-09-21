-- 2026-09-19 第三轮审计修复：数据层加固（2026-09-20 A 批修订后重新展示）
-- ⚠️ 仅生成（create-only），未执行；执行前须经叶森确认（AGENTS.md §五.6）
--
-- 1) FeeEntry.confirmState 默认值 CONFIRMED → PENDING
--    「实收一律两步，无人例外」：任何漏写 confirmState 的 RECEIVED 插入此前会
--    静默落成已确认。改默认后防线在数据库层成立；COMMISSION/COST 等派生行由代码
--    显式写 CONFIRMED（已改）。风险口径（2026-09-20 收窄）：默认值只影响漏写状态的
--    落库结果；Payment 与分成的生成仍取决于调用路径，默认值本身不自动派生。
--
-- 2) Matter → 财务四表外键 CASCADE → RESTRICT
--    应用层只有软删（deletedAt），物理删除案件此前会连带删光应收/收款/合同/
--    流水（PG 级联顺序不确定，也可能中途 FK 报错）。业务上财务记录禁止随案
--    物理删除，RESTRICT 使误删在数据库层直接失败。
--
-- 3) AuditLog 防删（AGENTS.md §六：AuditLog 不可由业务代码删除，只能归档）
--    2026-09-20 A 批修订：由「RULE ... DO INSTEAD NOTHING（静默无操作）」改为
--    BEFORE DELETE 触发器显式抛错——静默吞删除会让调用方误以为删除成功
--    （Prisma deleteMany 返回 0 行也难以察觉）；显式报错让越权或误删路径
--    在第一时间暴露。需要清理时由管理员显式 DROP TRIGGER 后另行归档处置。

-- 1. 实收确认默认值改为待确认
ALTER TABLE "FeeEntry" ALTER COLUMN "confirmState" SET DEFAULT 'PENDING';

-- 2. 财务外键改为 RESTRICT
ALTER TABLE "Receivable" DROP CONSTRAINT "Receivable_matterId_fkey";
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_matterId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Billing" DROP CONSTRAINT "Billing_matterId_fkey";
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FeeEntry" DROP CONSTRAINT "FeeEntry_matterId_fkey";
ALTER TABLE "FeeEntry" ADD CONSTRAINT "FeeEntry_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. 审计日志禁删（显式拒绝；业务删除路径立即报错而非静默无操作）
CREATE OR REPLACE FUNCTION "audit_log_forbid_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog 不允许删除（AGENTS.md §六）：审计日志只能归档处置，不可由业务代码删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_delete" BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_forbid_delete"();
