-- v0.14: InvoiceRequest 加真实发票号 + 开票时间
ALTER TABLE "InvoiceRequest"
  ADD COLUMN "invoiceNo" TEXT,
  ADD COLUMN "issuedAt" TIMESTAMP(3);
