-- 恢复 Prisma 基线无法表达的数据库守卫对象（2026-09-21）
--
-- 背景：0_init 基线由 `prisma migrate diff --from-empty` 生成，只包含 Prisma schema
-- 能表达的对象。历史上经 20260919000002_business_workflow_repair 与
-- 20260920000001_audit_fix_hardening 落库的触发器、函数、CHECK 约束和部分唯一索引
-- 均不在其中——从 0_init 部署的全新数据库缺失这些守卫（审计日志可删、事项责任
-- 断链、财务余额无约束、重复申请无唯一防线）。
--
-- 本迁移按主库现行定义（与归档迁移原文核对一致）逐字恢复，全部幂等：
-- 函数 CREATE OR REPLACE；触发器/约束/索引先 DROP IF EXISTS 再 CREATE，
-- 使空库、主库与 v1.3.x 升级库三条路径收敛到同一套定义。

-- ============================================================
-- 1) 函数（5 个）
-- ============================================================

-- 审计日志禁删（AGENTS.md §六）：显式抛错而非静默吞删除，
-- 让越权或误删路径在第一时间暴露。
CREATE OR REPLACE FUNCTION "audit_log_forbid_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog 不允许删除（AGENTS.md §六）：审计日志只能归档处置，不可由业务代码删除';
END;
$$ LANGUAGE plpgsql;

-- 事项新建即确定责任，覆盖导入、规则生成和普通表单；不回填旧事项。
CREATE OR REPLACE FUNCTION lawlink_assign_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE responsible text; work_id text; is_done boolean; case_id text;
BEGIN
 IF TG_TABLE_NAME='Task' THEN
  SELECT COALESCE(NEW."assigneeId",m."ownerId") INTO responsible FROM "Matter" m WHERE m.id=NEW."matterId";
 ELSE
  SELECT CASE WHEN NOT p."isExternalLead" AND u.active AND (u.role<>'CUSTOM' OR rd.active) THEN p."leadLawyerId" ELSE m."ownerId" END INTO responsible
   FROM "MatterProcedure" p JOIN "Matter" m ON m.id=p."matterId" LEFT JOIN "User" u ON u.id=p."leadLawyerId" LEFT JOIN "RoleDefinition" rd ON rd.id=u."roleDefinitionId" WHERE p.id=NEW."procedureId";
 END IF;
 IF responsible IS NULL OR NOT EXISTS (SELECT 1 FROM "User" u LEFT JOIN "RoleDefinition" r ON r.id=u."roleDefinitionId" WHERE u.id=responsible AND u.active AND (u.role<>'CUSTOM' OR (r.active AND EXISTS(SELECT 1 FROM "RolePermission" rp WHERE rp."roleId"=r.id AND rp."permissionKey"='matters.write')))) THEN
  RAISE EXCEPTION '事项须有有效责任人，请先完成责任交接';
 END IF;
 work_id := 'work_' || md5(NEW.id || TG_TABLE_NAME);
 is_done := COALESCE((to_jsonb(NEW)->>'completed')::boolean,false);
 INSERT INTO "WorkResponsibility" (id,"taskId","deadlineId","hearingId","assigneeId",state,"closedAt",reason) VALUES(work_id,CASE WHEN TG_TABLE_NAME='Task' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='Deadline' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='Hearing' THEN NEW.id END,responsible,CASE WHEN is_done THEN 'DONE'::"WorkItemState" ELSE 'OPEN'::"WorkItemState" END,CASE WHEN is_done THEN NOW() END,CASE WHEN is_done THEN '登记时已完成' END);
 IF NOT is_done THEN
  IF TG_TABLE_NAME='Task' THEN case_id:=NEW."matterId"; ELSE SELECT "matterId" INTO case_id FROM "MatterProcedure" WHERE id=NEW."procedureId"; END IF;
  INSERT INTO "Notification" (id,"userId",type,priority,title,content,href,"refType","refId") VALUES('assignment_'||work_id,responsible,'SYSTEM','HIGH','新事项待承接','请核对事项内容和日期，确认承接责任。','/matters/'||case_id,'WorkResponsibility',work_id);
 END IF;
 IF TG_TABLE_NAME='Task' THEN
  IF NEW."assigneeId" IS NULL THEN UPDATE "Task" SET "assigneeId"=responsible WHERE id=NEW.id; END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lawlink_complete_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.completed IS DISTINCT FROM OLD.completed THEN
  IF NEW.completed THEN UPDATE "WorkResponsibility" SET state='DONE',"closedAt"=NOW(),reason='标记完成',revision=revision+1 WHERE ("taskId"=NEW.id OR "deadlineId"=NEW.id) AND state='OPEN';
  ELSE UPDATE "WorkResponsibility" SET state='OPEN',"closedAt"=NULL,reason='重新办理',revision=revision+1 WHERE ("taskId"=NEW.id OR "deadlineId"=NEW.id) AND state='DONE';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lawlink_change_work_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_date timestamp; next_date timestamp;
BEGIN
 IF TG_TABLE_NAME='Hearing' THEN prior_date=OLD."startsAt";next_date=NEW."startsAt";ELSE prior_date=OLD."dueAt";next_date=NEW."dueAt";END IF;
 IF prior_date IS DISTINCT FROM next_date THEN
  UPDATE "WorkResponsibility" SET "acceptedAt"=NULL,revision=revision+1 WHERE "taskId"=NEW.id OR "deadlineId"=NEW.id OR "hearingId"=NEW.id;
  UPDATE "Notification" SET read=true,"readAt"=NOW(),content='原日期已调整，请核对当前事项' WHERE "refId"=NEW.id AND "refType" LIKE 'DueReminder:%';
  INSERT INTO "AuditLog" (id,action,"targetType","targetId",detail) VALUES ('workdate_'||md5(random()::text||clock_timestamp()::text),'WORK_ITEM_DATE_CHANGED',TG_TABLE_NAME,NEW.id,jsonb_build_object('previousDate',prior_date,'newDate',next_date));
 END IF;RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lawlink_guard_task_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "WorkResponsibility" WHERE "taskId"=NEW.id AND "assigneeId" IS DISTINCT FROM NEW."assigneeId") THEN RAISE EXCEPTION '责任变更须经接收人确认';END IF;
 RETURN NEW;
END;
$$;

-- ============================================================
-- 2) 触发器（10 个）
-- ============================================================

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_forbid_delete"();

DROP TRIGGER IF EXISTS "Task_responsibility_create" ON "Task";
CREATE TRIGGER "Task_responsibility_create" AFTER INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();
DROP TRIGGER IF EXISTS "Deadline_responsibility_create" ON "Deadline";
CREATE TRIGGER "Deadline_responsibility_create" AFTER INSERT ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();
DROP TRIGGER IF EXISTS "Hearing_responsibility_create" ON "Hearing";
CREATE TRIGGER "Hearing_responsibility_create" AFTER INSERT ON "Hearing" FOR EACH ROW EXECUTE FUNCTION lawlink_assign_work();

DROP TRIGGER IF EXISTS "Task_responsibility_complete" ON "Task";
CREATE TRIGGER "Task_responsibility_complete" AFTER UPDATE OF completed ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_complete_work();
DROP TRIGGER IF EXISTS "Deadline_responsibility_complete" ON "Deadline";
CREATE TRIGGER "Deadline_responsibility_complete" AFTER UPDATE OF completed ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_complete_work();

DROP TRIGGER IF EXISTS "Task_date_change" ON "Task";
CREATE TRIGGER "Task_date_change" AFTER UPDATE OF "dueAt" ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
DROP TRIGGER IF EXISTS "Deadline_date_change" ON "Deadline";
CREATE TRIGGER "Deadline_date_change" AFTER UPDATE OF "dueAt" ON "Deadline" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();
DROP TRIGGER IF EXISTS "Hearing_date_change" ON "Hearing";
CREATE TRIGGER "Hearing_date_change" AFTER UPDATE OF "startsAt" ON "Hearing" FOR EACH ROW EXECUTE FUNCTION lawlink_change_work_date();

DROP TRIGGER IF EXISTS "Task_owner_guard" ON "Task";
CREATE TRIGGER "Task_owner_guard" BEFORE UPDATE OF "assigneeId" ON "Task" FOR EACH ROW EXECUTE FUNCTION lawlink_guard_task_owner();

-- ============================================================
-- 3) CHECK 约束（25 个，自主库现行定义导出）
-- ============================================================

ALTER TABLE "Allocation" DROP CONSTRAINT IF EXISTS "Allocation_balance_check";
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_balance_check" CHECK (((amount > (0)::numeric) AND ("reversedAmount" >= (0)::numeric) AND ("reversedAmount" <= amount)));
ALTER TABLE "ArchiveClosurePlan" DROP CONSTRAINT IF EXISTS "ArchiveClosurePlan_basis_check";
ALTER TABLE "ArchiveClosurePlan" ADD CONSTRAINT "ArchiveClosurePlan_basis_check" CHECK (((length(TRIM(BOTH FROM reason)) > 0) AND (length(fingerprint) = 64) AND (revision >= 0)));
ALTER TABLE "ArchiveRecord" DROP CONSTRAINT IF EXISTS "ArchiveRecord_supplement_check";
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_supplement_check" CHECK ((("supplementOfId" IS NULL) OR ("supplementOfId" <> id)));
ALTER TABLE "Billing" DROP CONSTRAINT IF EXISTS "Billing_amendment_source_check";
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_amendment_source_check" CHECK ((("sourceBillingId" IS NULL) OR ("sourceBillingId" <> id)));
ALTER TABLE "CommissionSettlement" DROP CONSTRAINT IF EXISTS "CommissionSettlement_record_check";
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_record_check" CHECK (((amount > (0)::numeric) AND (length(TRIM(BOTH FROM "voucherReference")) > 0) AND (("voidedAt" IS NULL) OR (("voidReason" IS NOT NULL) AND (length(TRIM(BOTH FROM "voidReason")) > 0)))));
ALTER TABLE "ConflictCheck" DROP CONSTRAINT IF EXISTS "ConflictCheck_subject_check";
ALTER TABLE "ConflictCheck" ADD CONSTRAINT "ConflictCheck_subject_check" CHECK ((num_nonnulls("intakeId", "matterId") <= 1));
ALTER TABLE "ExecutionTermination" DROP CONSTRAINT IF EXISTS "ExecutionTermination_target_check";
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_target_check" CHECK (((num_nonnulls("invoiceId", "sealId") = 1) AND (length(TRIM(BOTH FROM reason)) > 0) AND (revision >= 0)));
ALTER TABLE "ExecutionTermination" DROP CONSTRAINT IF EXISTS "ExecutionTermination_decision_check";
ALTER TABLE "ExecutionTermination" ADD CONSTRAINT "ExecutionTermination_decision_check" CHECK ((((status = 'PENDING'::"FinanceCorrectionStatus") AND ("decidedById" IS NULL) AND ("decidedAt" IS NULL)) OR ((status <> 'PENDING'::"FinanceCorrectionStatus") AND ("decidedById" IS NOT NULL) AND ("decidedAt" IS NOT NULL) AND ("decisionNote" IS NOT NULL) AND (length(TRIM(BOTH FROM "decisionNote")) > 0))));
ALTER TABLE "FinanceCorrection" DROP CONSTRAINT IF EXISTS "FinanceCorrection_confirmation_check";
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_confirmation_check" CHECK (((status <> 'CONFIRMED'::"FinanceCorrectionStatus") OR (("confirmedById" IS NOT NULL) AND ("confirmedAt" IS NOT NULL))));
ALTER TABLE "FinanceCorrection" DROP CONSTRAINT IF EXISTS "FinanceCorrection_subject_check";
ALTER TABLE "FinanceCorrection" ADD CONSTRAINT "FinanceCorrection_subject_check" CHECK ((("matterId" IS NOT NULL) AND (amount > (0)::numeric) AND (num_nonnulls("paymentId", "receivableId", "feeEntryId") = 1) AND (((("targetType" = 'Payment'::text) AND ("targetId" = "paymentId")) OR (("targetType" = 'Receivable'::text) AND ("targetId" = "receivableId")) OR (("targetType" = 'FeeEntry'::text) AND ("targetId" = "feeEntryId"))) IS TRUE)));
ALTER TABLE "FinanceCorrectionEffect" DROP CONSTRAINT IF EXISTS "FinanceCorrectionEffect_target_check";
ALTER TABLE "FinanceCorrectionEffect" ADD CONSTRAINT "FinanceCorrectionEffect_target_check" CHECK (((delta <> (0)::numeric) AND (num_nonnulls("paymentId", "receivableId", "allocationId", "invoiceAllocationId", "commissionEntryId", "expenseEntryId") = 1) AND ((("effectKind" = 'PAYMENT_REFUND'::"FinanceEffectKind") AND ("paymentId" IS NOT NULL) AND (delta > (0)::numeric)) OR (("effectKind" = 'RECEIVABLE_ADJUSTMENT'::"FinanceEffectKind") AND ("receivableId" IS NOT NULL)) OR (("effectKind" = 'ALLOCATION_REVERSAL'::"FinanceEffectKind") AND ("allocationId" IS NOT NULL) AND (delta > (0)::numeric)) OR (("effectKind" = 'INVOICE_ALLOCATION_REVERSAL'::"FinanceEffectKind") AND ("invoiceAllocationId" IS NOT NULL) AND (delta > (0)::numeric)) OR (("effectKind" = 'EXPENSE_REVERSAL'::"FinanceEffectKind") AND ("expenseEntryId" IS NOT NULL) AND (delta > (0)::numeric)) OR (("effectKind" = 'COMMISSION_ADJUSTMENT'::"FinanceEffectKind") AND ("commissionEntryId" IS NOT NULL)))));
ALTER TABLE "IntakeHandover" DROP CONSTRAINT IF EXISTS "IntakeHandover_basis_check";
ALTER TABLE "IntakeHandover" ADD CONSTRAINT "IntakeHandover_basis_check" CHECK ((("fromUserId" <> "toUserId") AND (length(TRIM(BOTH FROM reason)) > 0) AND (length(fingerprint) = 64) AND (revision >= 0)));
ALTER TABLE "IntakeRevision" DROP CONSTRAINT IF EXISTS "IntakeRevision_round_check";
ALTER TABLE "IntakeRevision" ADD CONSTRAINT "IntakeRevision_round_check" CHECK (((round > 0) AND (length(fingerprint) = 64)));
ALTER TABLE "IntakeUrgentItem" DROP CONSTRAINT IF EXISTS "IntakeUrgentItem_state_check";
ALTER TABLE "IntakeUrgentItem" ADD CONSTRAINT "IntakeUrgentItem_state_check" CHECK (((kind = ANY (ARRAY['TASK'::text, 'DEADLINE'::text, 'HEARING'::text])) AND (revision >= 0) AND ((state = 'OPEN'::"WorkItemState") OR (("closedAt" IS NOT NULL) AND (reason IS NOT NULL) AND (length(TRIM(BOTH FROM reason)) > 0)))));
ALTER TABLE "InvoiceAdjustment" DROP CONSTRAINT IF EXISTS "InvoiceAdjustment_basis_check";
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_basis_check" CHECK (((amount > (0)::numeric) AND (kind = ANY (ARRAY['RED'::text, 'VOID'::text, 'REPLACE'::text])) AND (length(TRIM(BOTH FROM reference)) > 0) AND (length(TRIM(BOTH FROM reason)) > 0) AND (((kind = 'REPLACE'::text) AND ("replacementInvoiceId" IS NOT NULL) AND ("replacementInvoiceId" <> "invoiceId")) OR ((kind <> 'REPLACE'::text) AND ("replacementInvoiceId" IS NULL)))));
ALTER TABLE "InvoicePaymentAllocation" DROP CONSTRAINT IF EXISTS "InvoicePaymentAllocation_balance_check";
ALTER TABLE "InvoicePaymentAllocation" ADD CONSTRAINT "InvoicePaymentAllocation_balance_check" CHECK (((amount > (0)::numeric) AND ("reversedAmount" >= (0)::numeric) AND ("reversedAmount" <= amount)));
ALTER TABLE "MatterHandover" DROP CONSTRAINT IF EXISTS "MatterHandover_people_check";
ALTER TABLE "MatterHandover" ADD CONSTRAINT "MatterHandover_people_check" CHECK ((("fromUserId" <> "toUserId") AND (reason IS NOT NULL) AND (length(TRIM(BOTH FROM reason)) > 0) AND (length(fingerprint) = 64)));
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_balance_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_balance_check" CHECK (((amount >= (0)::numeric) AND ("refundedAmount" >= (0)::numeric) AND ("refundedAmount" <= amount) AND ("allocatedAmount" >= (0)::numeric) AND ("allocatedAmount" <= (amount - "refundedAmount"))));
ALTER TABLE "Receivable" DROP CONSTRAINT IF EXISTS "Receivable_balance_check";
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_balance_check" CHECK (((amount >= (0)::numeric) AND ((amount + "adjustmentAmount") >= (0)::numeric) AND ("settledAmount" >= (0)::numeric) AND ("settledAmount" <= (amount + "adjustmentAmount"))));
ALTER TABLE "Receivable" DROP CONSTRAINT IF EXISTS "Receivable_due_state_check";
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_due_state_check" CHECK (((("dueState" <> 'DATE_SET'::"ReceivableDueState") OR ("dueDate" IS NOT NULL)) AND (("dueState" <> 'CONDITIONAL'::"ReceivableDueState") OR (("dueCondition" IS NOT NULL) AND (length(TRIM(BOTH FROM "dueCondition")) > 0))) AND (("conditionSatisfiedAt" IS NULL) OR ("conditionConfirmedById" IS NOT NULL))));
ALTER TABLE "RoleDefinition" DROP CONSTRAINT IF EXISTS "RoleDefinition_version_positive";
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_version_positive" CHECK ((version > 0));
ALTER TABLE "RolePermission" DROP CONSTRAINT IF EXISTS "RolePermission_scope_valid";
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_scope_valid" CHECK (((scope)::text = ANY ((ARRAY['OWN'::character varying, 'TEAM'::character varying, 'ALL'::character varying])::text[])));
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_custom_role_consistent";
ALTER TABLE "User" ADD CONSTRAINT "User_custom_role_consistent" CHECK (((((role)::text = 'CUSTOM'::text) AND ("roleDefinitionId" IS NOT NULL)) OR (((role)::text <> 'CUSTOM'::text) AND ("roleDefinitionId" IS NULL))));
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_identity_document_consistent";
ALTER TABLE "User" ADD CONSTRAINT "User_identity_document_consistent" CHECK (((("identityDocumentType" IS NULL) AND ("identityDocumentNumber" IS NULL) AND ("identityDocumentName" IS NULL)) OR (("identityDocumentType" IS NOT NULL) AND ("identityDocumentNumber" IS NOT NULL) AND (btrim(("identityDocumentNumber")::text) <> ''::text) AND ((("identityDocumentType" = 'OTHER'::"IdentityDocumentType") AND (NULLIF(btrim(("identityDocumentName")::text), ''::text) IS NOT NULL)) OR (("identityDocumentType" <> 'OTHER'::"IdentityDocumentType") AND ("identityDocumentName" IS NULL))))));
ALTER TABLE "WorkResponsibility" DROP CONSTRAINT IF EXISTS "WorkResponsibility_target_check";
ALTER TABLE "WorkResponsibility" ADD CONSTRAINT "WorkResponsibility_target_check" CHECK (((num_nonnulls("taskId", "deadlineId", "hearingId") = 1) AND (revision >= 0) AND ((state = 'OPEN'::"WorkItemState") OR (("closedAt" IS NOT NULL) AND (reason IS NOT NULL) AND (length(TRIM(BOTH FROM reason)) > 0)))));

-- ============================================================
-- 4) 部分唯一索引（8 个）
-- ============================================================

DROP INDEX IF EXISTS "Billing_active_successor_unique";
CREATE UNIQUE INDEX "Billing_active_successor_unique" ON "Billing" ("sourceBillingId") WHERE ((status = 'ACTIVE'::"BillingStatus") AND ("sourceBillingId" IS NOT NULL));
DROP INDEX IF EXISTS "Client_idType_idNumberBlind_active_key";
CREATE UNIQUE INDEX "Client_idType_idNumberBlind_active_key" ON "Client" ("idType", "idNumberBlind") WHERE (("idNumberBlind" IS NOT NULL) AND ("idType" IS NOT NULL) AND ("deletedAt" IS NULL));
DROP INDEX IF EXISTS "ExecutionTermination_invoice_open_unique";
CREATE UNIQUE INDEX "ExecutionTermination_invoice_open_unique" ON "ExecutionTermination" ("invoiceId") WHERE (status = ANY (ARRAY['PENDING'::"FinanceCorrectionStatus", 'CONFIRMED'::"FinanceCorrectionStatus"]));
DROP INDEX IF EXISTS "ExecutionTermination_seal_open_unique";
CREATE UNIQUE INDEX "ExecutionTermination_seal_open_unique" ON "ExecutionTermination" ("sealId") WHERE (status = ANY (ARRAY['PENDING'::"FinanceCorrectionStatus", 'CONFIRMED'::"FinanceCorrectionStatus"]));
DROP INDEX IF EXISTS "IntakeHandover_pending_unique";
CREATE UNIQUE INDEX "IntakeHandover_pending_unique" ON "IntakeHandover" ("intakeId") WHERE (status = 'PENDING'::"HandoverState");
DROP INDEX IF EXISTS "InvoiceAdjustment_replacement_unique";
CREATE UNIQUE INDEX "InvoiceAdjustment_replacement_unique" ON "InvoiceAdjustment" ("replacementInvoiceId") WHERE ("replacementInvoiceId" IS NOT NULL);
DROP INDEX IF EXISTS "MatterHandover_pending_unique";
CREATE UNIQUE INDEX "MatterHandover_pending_unique" ON "MatterHandover" ("matterId") WHERE (status = 'PENDING'::"HandoverState");
DROP INDEX IF EXISTS "SmsMessage_receiver_text_unique";
CREATE UNIQUE INDEX "SmsMessage_receiver_text_unique" ON "SmsMessage" ("receivedById", "rawTextHash") WHERE ("rawTextHash" <> ''::text);
