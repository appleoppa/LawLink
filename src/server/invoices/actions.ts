"use server";
import {assertExecutionOpen,terminationReady} from "@/server/approval-permissions/termination";

import { approvalTransaction, approvalAudit, assertApprovalItem, canExecuteInvoice } from "@/lib/approvals/service";


import { scopeFor, type RoleGrant } from "@/lib/roles/catalog";
import { matterFinanceVisibilityFilter, hasAllScope } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shMonthStart } from "@/server/finance/facts";
import { requireSession } from "@/lib/auth/session";
import { assertMatterWritable } from "@/lib/archive/guard";
import {
  assertCanAccessMatterFinance,
  assertCanAssociateMatter,
  assertCanLeadMatter,
  isManager,
  matterVisibilityFilter
} from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { serializeDecimals } from "@/lib/decimal";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

const MAX_FILE_SIZE = 20 * 1024 * 1024;


function canReviewInvoiceRequests(role: string) {
  return isManager(role) || role === "FINANCE";
}

function invoiceRequestVisibilityWhere(
  userId: string,
  role: string,
  grants?: RoleGrant[]
): Prisma.InvoiceRequestWhereInput {
  if (role === "CUSTOM") {
    if (scopeFor({ role, rolePermissions: grants }, "finance.read") === "ALL") return {};
    return { OR: [{ requestedById: userId }, { matter: { deletedAt: null, ...matterFinanceVisibilityFilter(userId, role, grants) } }] };
  }
  if (canReviewInvoiceRequests(role)) return {};
  // 业务管理权含 finance.read:ALL（P2-9）：开票申请列表与「全所财务可见」契约对齐，
  // 此前对 managerAuthorized 用户回落旧版过滤器且不带 grants，只看到本人经办案件的开票。
  // 只放大读取；开票执行资格（canExecuteInvoice）不受影响。
  if (hasAllScope(grants, "finance.read")) return {};
  return {
    OR: [
      { requestedById: userId },
      {
        matter: {
          deletedAt: null,
          ...matterVisibilityFilter(userId, role)
        }
      }
    ]
  };
}

/** 律师在案件详情提交开票申请 */
const createSchema = z.object({
  matterId: z.string().cuid(),
  amount: z.coerce.number().positive("金额需大于 0"),
  title: z.string().max(120).optional().or(z.literal("")),
  requestNote: z.string().max(500).optional().or(z.literal(""))
});

export async function createInvoiceRequest(input: z.infer<typeof createSchema>) {
  const session = await requireSession("approval");
  const data = createSchema.parse(input);
  await assertCanAssociateMatter(session.user.id, data.matterId);
  await assertMatterWritable(data.matterId);

  await assertCanLeadMatter(session.user.id, data.matterId, "仅案件主办/协办律师可申请开票");

  // 两套入口一套规则（2026-09-20 A 批 P2-15）：旧表单缺少开票类型、名目、抬头与开票依据，
  // 无法满足「关联案件必传开票依据、专票校验购方六要素」的现行服务端规则。此入口已无页面
  // 引用（两个表单组件均使用 finance/actions 的完整版），剩余可达路径为直接 RPC——
  // 不以"UI 不引用"作为安全依据，一律明确报错并指引完整入口，不创建缺依据的申请。
  throw new ActionError("旧版开票入口已停用：缺少开票类型、名目、抬头与开票依据。请在案件财务区或财务页使用完整开票表单提交");
}

export async function listInvoiceRequests(filter?: { status?: "PENDING" | "ISSUED" | "REJECTED" | "APPROVED" }) {
  const session = await requireSession("approval");
  const where: Prisma.InvoiceRequestWhereInput = {
    ...invoiceRequestVisibilityWhere(session.user.id, session.user.role, session.user.rolePermissions),
    ...(filter?.status ? { status: filter.status } : {})
  };
  const allRows = await prisma.invoiceRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      requestedBy: { select: { id: true, name: true } },
      processedBy: { select: { id: true, name: true } },
      contractScan: { select: { id: true, name: true } },
      invoiceFile: { select: { id: true, name: true } }
    }
  });
  // 已确认终止执行的申请不再呈「待开票」可点（服务端有 assertExecutionOpen 兜底，
  // 此处修 UI 误导）；全部记录视图仍展示原始状态。
  let rows = allRows;
  if (filter?.status === "APPROVED" && await terminationReady(prisma)) {
    const terminatedRows = await prisma.$queryRaw<{ invoiceId: string }[]>`SELECT "invoiceId" FROM "ExecutionTermination" WHERE "invoiceId" IS NOT NULL AND status='CONFIRMED'`;
    const terminated = new Set(terminatedRows.map(r => r.invoiceId));
    rows = allRows.filter(r => !terminated.has(r.id));
  }

  const evidenceIds = Array.from(new Set(rows.flatMap((row) => row.evidenceDocIds)));
  const docs = evidenceIds.length
    ? await prisma.document.findMany({
        where: { id: { in: evidenceIds }, deletedAt: null },
        select: { id: true, name: true, size: true, mimeType: true, createdAt: true }
      })
    : [];
  const docMap = new Map(docs.map((doc) => [doc.id, doc]));

  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    evidenceDocs: row.evidenceDocIds
      .map((id) => docMap.get(id))
      .filter((doc): doc is (typeof docs)[number] => Boolean(doc))
  }));
}

export async function listInvoiceRequestsByMatter(matterId: string) {
  const session = await requireSession("approval");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, matterId, session.user.rolePermissions);
  const rows = await prisma.invoiceRequest.findMany({
    where: { matterId },
    orderBy: { requestedAt: "desc" },
    include: {
      requestedBy: { select: { id: true, name: true } },
      processedBy: { select: { id: true, name: true } },
      contractScan: { select: { id: true, name: true } },
      invoiceFile: { select: { id: true, name: true } }
    }
  });
  return serializeDecimals(rows);
}

/**
 * 财务批准 + 上传电子发票。FormData：
 *   requestId, processNote?, contractScan(File?), invoiceFile(File?)
 * - 不传 invoiceFile：状态 APPROVED
 * - 传 invoiceFile：状态 ISSUED
 *
 * contractScan 仅保留兼容旧数据流；申请依据应由申请人上传到 evidenceDocIds。
 */
export async function approveInvoiceRequest(formData: FormData) {
  const session = await requireSession("approval");

  const requestId = formData.get("requestId");
  if (typeof requestId !== "string" || !requestId) throw new ActionError("requestId 缺失");

  const existing = await prisma.invoiceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, matterId: true, status: true, updatedAt: true, evidenceDocIds: true, contractScanId: true, invoiceFileId: true }
  });
  if (!existing) throw new ActionError("申请不存在");
  if (existing.status === "ISSUED") throw new ActionError("此申请已开具");
  if (existing.status === "REJECTED") throw new ActionError("此申请已驳回");

  if (existing.status === "APPROVED") {
    await assertExecutionOpen(prisma,"INVOICE",requestId);
    if (!await canExecuteInvoice(session.user.id, requestId)) throw new ActionError("没有此申请的开票执行权限");
  } else {
    await assertApprovalItem(session.user.id, "INVOICE_APPROVE", requestId);
  }
  const processNote = formData.get("processNote");
  const contractScan = formData.get("contractScan");
  const invoiceFile = formData.get("invoiceFile");
  // v0.14: 真实发票号（财务批准/开具时回填）
  const invoiceNo = formData.get("invoiceNo");
  const invoiceNoStr = typeof invoiceNo === "string" ? invoiceNo.trim() : "";
  if (session.user.role === "CUSTOM" && existing.status === "PENDING" && invoiceFile instanceof File && invoiceFile.size > 0) throw new ActionError("请先完成审批，再由具备开票执行权限的人员上传发票");
  if (invoiceFile instanceof File && invoiceFile.size > 0 && !invoiceNoStr) {
    throw new ActionError("上传电子发票时必须填写发票号码");
  }

  if (existing.status === "APPROVED" && !(invoiceFile instanceof File && invoiceFile.size > 0)) throw new ActionError("申请已批准，请上传电子发票完成开具");

  type FilePrep = { path: string; mimeType: string; size: number; sha256: string; enc: ReturnType<typeof encryptBuffer>; name: string };
  let contractScanPrep: FilePrep | null = null;
  let invoiceFilePrep: FilePrep | null = null;

  // 兼容旧流程：历史上允许财务补传扫描件合同；新流程由申请人上传 evidenceDocIds。
  // 文件落盘在事务外（存储写不可回滚），Document 行改在事务内创建——
  // 双执行者竞态失败时不再把孤儿发票文件留在案件卷宗（2026-09-19 审计）。
  if (contractScan instanceof File && contractScan.size > 0) {
    const validatedScan = validateUploadedFile(contractScan, { purpose: "invoice", maxBytes: MAX_FILE_SIZE });
    const raw = Buffer.from(await contractScan.arrayBuffer());
    const enc = encryptBuffer(raw);
    contractScanPrep = {
      path: await storage.writeFile(storageScope(existing.matterId, requestId), enc.ciphertext),
      mimeType: validatedScan.mimeType,
      size: contractScan.size,
      sha256: sha256(raw),
      enc,
      name: contractScan.name
    };
  }

  // 上传电子发票
  if (invoiceFile instanceof File && invoiceFile.size > 0) {
    const validatedInvoice = validateUploadedFile(invoiceFile, { purpose: "invoice", maxBytes: MAX_FILE_SIZE });
    const raw = Buffer.from(await invoiceFile.arrayBuffer());
    const enc = encryptBuffer(raw);
    invoiceFilePrep = {
      path: await storage.writeFile(storageScope(existing.matterId, requestId), enc.ciphertext),
      mimeType: validatedInvoice.mimeType,
      size: invoiceFile.size,
      sha256: sha256(raw),
      enc,
      name: invoiceFile.name
    };
  }

  const finalStatus = invoiceFilePrep ? ("ISSUED" as const) : ("APPROVED" as const);

  let contractScanDocId: string | undefined;
  let invoiceFileDocId: string | undefined;
  await approvalTransaction(async tx => {
    await assertExecutionOpen(tx,"INVOICE",requestId);
    if (existing.status === "APPROVED") {
      if (!await canExecuteInvoice(session.user.id, requestId, tx)) throw new ActionError("开票执行权限已失效");
    } else await assertApprovalItem(session.user.id, "INVOICE_APPROVE", requestId, tx);
    if (contractScanPrep) {
      const doc = await tx.document.create({
        data: {
          matterId: existing.matterId,
          name: contractScanPrep.name,
          category: "CONTRACT",
          path: contractScanPrep.path,
          mimeType: contractScanPrep.mimeType,
          size: contractScanPrep.size,
          sha256: contractScanPrep.sha256,
          encrypted: true,
          algorithm: contractScanPrep.enc.algorithm,
          iv: contractScanPrep.enc.iv.toString("base64"),
          authTag: contractScanPrep.enc.authTag.toString("base64"),
          tags: ["发票申请"],
          uploadedById: session.user.id
        }
      });
      contractScanDocId = doc.id;
    }
    if (invoiceFilePrep) {
      const doc = await tx.document.create({
        data: {
          matterId: existing.matterId,
          name: invoiceFilePrep.name,
          category: "OTHER",
          path: invoiceFilePrep.path,
          mimeType: invoiceFilePrep.mimeType,
          size: invoiceFilePrep.size,
          sha256: invoiceFilePrep.sha256,
          encrypted: true,
          algorithm: invoiceFilePrep.enc.algorithm,
          iv: invoiceFilePrep.enc.iv.toString("base64"),
          authTag: invoiceFilePrep.enc.authTag.toString("base64"),
          tags: ["电子发票"],
          uploadedById: session.user.id
        }
      });
      invoiceFileDocId = doc.id;
    }
  await tx.invoiceRequest.update({
    where: { id: requestId, status: existing.status, updatedAt: existing.updatedAt },
    data: {
      status: finalStatus,
      processNote: typeof processNote === "string" ? processNote.trim() || null : null,
      processedById: session.user.id,
      processedAt: new Date(),
      ...(contractScanDocId ? { contractScanId: contractScanDocId } : {}),
      ...(invoiceFileDocId ? { invoiceFileId: invoiceFileDocId } : {}),
      // v0.14: 开票完成（ISSUED）时回填真实发票号 + 时间
      ...(finalStatus === "ISSUED"
        ? { invoiceNo: invoiceNoStr, issuedAt: new Date() }
        : {})
    }
  });
    const attachmentIds = [...existing.evidenceDocIds, ...[contractScanDocId ?? existing.contractScanId, invoiceFileDocId ?? existing.invoiceFileId].filter((id): id is string => !!id)];
    if (existing.status === "PENDING") await approvalAudit(tx, session.user.id, "INVOICE_APPROVED", requestId, { note: typeof processNote === "string" ? processNote.trim() : "", attachmentIds });
    if (finalStatus === "ISSUED") await approvalAudit(tx, session.user.id, "INVOICE_ISSUED", requestId, { note: typeof processNote === "string" ? processNote.trim() : "", attachmentIds });
  });


  if (existing.matterId) await revalidateMatter(existing.matterId);
  revalidatePath("/finance");
  revalidatePath("/approvals");
  return { ok: true, status: finalStatus };
}

function storageScope(matterId: string | null, requestId: string) {
  return matterId ? `m_${matterId}` : `invoice_${requestId}`;
}

const rejectSchema = z.object({
  requestId: z.string().cuid(),
  reason: z.string().min(1, "请说明驳回原因").max(500)
});

export async function rejectInvoiceRequest(input: z.infer<typeof rejectSchema>) {
  const session = await requireSession("approval");
  const data = rejectSchema.parse(input);

  const existing = await prisma.invoiceRequest.findUnique({
    where: { id: data.requestId },
    select: { matterId: true, status: true, evidenceDocIds: true, contractScanId: true, invoiceFileId: true }
  });
  if (!existing) throw new ActionError("申请不存在");
  if (existing.status === "ISSUED") throw new ActionError("已开具的申请不可驳回");

  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "INVOICE_APPROVE", data.requestId, tx);
  await tx.invoiceRequest.update({
    where: { id: data.requestId, status: "PENDING" },
    data: {
      status: "REJECTED",
      processNote: data.reason,
      processedById: session.user.id,
      processedAt: new Date()
    }
  });
    await approvalAudit(tx, session.user.id, "INVOICE_REJECTED", data.requestId, { reason: data.reason, attachmentIds: [...existing.evidenceDocIds, ...[existing.contractScanId, existing.invoiceFileId].filter((id): id is string => !!id)] });
  });


  if (existing.matterId) await revalidateMatter(existing.matterId);
  revalidatePath("/finance");
  revalidatePath("/approvals");
  return { ok: true };
}

/** 财务页 KPI：本月已开票合计（净额口径：票面 − 红冲/折让等调整，与 readLedger / 案件财务一致） */
export async function getInvoiceStats() {
  const session = await requireSession("approval");
  // 上海月界：服务器本地时区（如 UTC 容器）会把月初 0-8 点的数据归错月
  const monthStart = shMonthStart();
  const visibilityWhere = invoiceRequestVisibilityWhere(session.user.id, session.user.role, session.user.rolePermissions);
  const issuedWhere: Prisma.InvoiceRequestWhereInput = {
    ...visibilityWhere,
    status: "ISSUED",
    processedAt: { gte: monthStart }
  };
  const issued = await prisma.invoiceRequest.aggregate({
    where: issuedWhere,
    _sum: { amount: true },
    _count: true
  });
  // 红冲/折让等调整全额扣减：InvoiceAdjustment 无作废/被替代态，按 invoiceId 关联全部行（同 readLedger 净额口径）
  let adjustmentTotal = 0;
  try {
    const adjustments = await prisma.invoiceAdjustment.groupBy({
      by: ["invoiceId"],
      _sum: { amount: true },
      where: { invoice: issuedWhere }
    });
    adjustmentTotal = adjustments.reduce((acc, r) => acc + Number(r._sum.amount ?? 0), 0);
  } catch {
    // InvoiceAdjustment 表尚未迁移的库：无红冲能力，净额即票面
    adjustmentTotal = 0;
  }
  const pendingCount = await prisma.invoiceRequest.count({
    where: {
      ...visibilityWhere,
      status: "PENDING"
    }
  });
  return {
    monthlyIssued: Number(issued._sum.amount ?? 0) - adjustmentTotal,
    monthlyIssuedCount: issued._count,
    pendingCount
  };
}
