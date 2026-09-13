-- v0.12: 开票申请扩展 - 类型/名目/抬头/税号/依据附件

-- 1. 新枚举
CREATE TYPE "InvoiceType" AS ENUM ('PLAIN', 'SPECIAL');
CREATE TYPE "InvoiceItem" AS ENUM ('LAWYER_FEE', 'CONSULTING_FEE', 'AGENCY_FEE', 'OTHER');

-- 2. InvoiceRequest 加字段
ALTER TABLE "InvoiceRequest"
  ADD COLUMN "invoiceType" "InvoiceType",
  ADD COLUMN "invoiceItem" "InvoiceItem",
  ADD COLUMN "buyerName" TEXT,
  ADD COLUMN "buyerTaxNo" TEXT,
  ADD COLUMN "evidenceDocIds" TEXT[] NOT NULL DEFAULT '{}';
