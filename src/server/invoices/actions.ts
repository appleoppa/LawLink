"use server";

import { approvalTransaction, approvalAudit, assertApprovalItem, canExecuteInvoice, requireApprovalRoute } from "@/lib/approvals/service";


import { scopeFor, type RoleGrant } from "@/lib/roles/catalog";
import { matterFinanceVisibilityFilter } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
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
import { notifyRoleApprovers } from "@/server/notifications/approval";
import { serializeDecimals } from "@/lib/decimal";
import { revalidateMatter } from "@/server/matters/route";

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

  const approvalMatter = data.matterId ? await prisma.matter.findUniqueOrThrow({ where: { id: data.matterId }, select: { category: true } }) : null;
  await requireApprovalRoute({ action: "INVOICE_APPROVE", category: approvalMatter?.category ?? null, requesterId: session.user.id });
  const created = await prisma.invoiceRequest.create({
    data: {
      matterId: data.matterId,
      amount: data.amount,
      title: data.title?.trim() || null,
      requestNote: data.requestNote?.trim() || null,
      requestedById: session.user.id,
      status: "PENDING"
    }
  });

  await audit({
    userId: session.user.id,
    action: "INVOICE_REQUEST_CREATE",
    targetType: "InvoiceRequest",
    targetId: created.id,
    detail: { matterId: data.matterId, amount: data.amount }
  });

  const matter = await prisma.matter.findUnique({
    where: { id: data.matterId },
    select: { internalCode: true, title: true }
  });

  await notifyRoleApprovers({
    roles: ["PRINCIPAL_LAWYER", "FINANCE"],
    excludeUserId: session.user.id,
    title: "新的发票审批待处理",
    content: `${session.user.name ?? "有用户"} 提交了开票申请：${
      matter ? `${matter.internalCode} ${matter.title}` : "关联案件"
    }，金额 ${data.amount.toLocaleString("zh-CN")} 元`,
    href: "/finance",
    refType: "InvoiceRequest",
    refId: created.id,
    priority: "HIGH"
  });

  await revalidateMatter(data.matterId);
  revalidatePath("/finance");
  revalidatePath("/approvals");
  return { ok: true, id: created.id };
}

export async function listInvoiceRequests(filter?: { status?: "PENDING" | "ISSUED" | "REJECTED" | "APPROVED" }) {
  const session = await requireSession("approval");
  const where: Prisma.InvoiceRequestWhereInput = {
    ...invoiceRequestVisibilityWhere(session.user.id, session.user.role, session.user.rolePermissions),
    ...(filter?.status ? { status: filter.status } : {})
  };
  const rows = await prisma.invoiceRequest.findMany({
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
  if (typeof requestId !== "string" || !requestId) throw new Error("requestId 缺失");

  const existing = await prisma.invoiceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, matterId: true, status: true, updatedAt: true, evidenceDocIds: true, contractScanId: true, invoiceFileId: true }
  });
  if (!existing) throw new Error("申请不存在");
  if (existing.status === "ISSUED") throw new Error("此申请已开具");
  if (existing.status === "REJECTED") throw new Error("此申请已驳回");

  if (existing.status === "APPROVED") {
    if (!await canExecuteInvoice(session.user.id, requestId)) throw new Error("没有此申请的开票执行权限");
  } else {
    await assertApprovalItem(session.user.id, "INVOICE_APPROVE", requestId);
  }
  const processNote = formData.get("processNote");
  const contractScan = formData.get("contractScan");
  const invoiceFile = formData.get("invoiceFile");
  // v0.14: 真实发票号（财务批准/开具时回填）
  const invoiceNo = formData.get("invoiceNo");
  const invoiceNoStr = typeof invoiceNo === "string" ? invoiceNo.trim() : "";
  if (session.user.role === "CUSTOM" && existing.status === "PENDING" && invoiceFile instanceof File && invoiceFile.size > 0) throw new Error("请先完成审批，再由具备开票执行权限的人员上传发票");
  if (invoiceFile instanceof File && invoiceFile.size > 0 && !invoiceNoStr) {
    throw new Error("上传电子发票时必须填写发票号码");
  }

  if (existing.status === "APPROVED" && !(invoiceFile instanceof File && invoiceFile.size > 0)) throw new Error("申请已批准，请上传电子发票完成开具");

  let contractScanDocId: string | undefined;
  let invoiceFileDocId: string | undefined;

  // 兼容旧流程：历史上允许财务补传扫描件合同；新流程由申请人上传 evidenceDocIds。
  if (contractScan instanceof File && contractScan.size > 0) {
    validateUploadedFile(contractScan, { purpose: "invoice", maxBytes: MAX_FILE_SIZE });
    const raw = Buffer.from(await contractScan.arrayBuffer());
    const enc = encryptBuffer(raw);
    const path = await storage.writeFile(storageScope(existing.matterId, requestId), enc.ciphertext);
    const doc = await prisma.document.create({
      data: {
        matterId: existing.matterId,
        name: contractScan.name,
        category: "CONTRACT",
        path,
        mimeType: contractScan.type || "application/octet-stream",
        size: contractScan.size,
        sha256: sha256(raw),
        encrypted: true,
        algorithm: enc.algorithm,
        iv: enc.iv.toString("base64"),
        authTag: enc.authTag.toString("base64"),
        tags: ["发票申请"],
        uploadedById: session.user.id
      }
    });
    contractScanDocId = doc.id;
  }

  // 上传电子发票
  if (invoiceFile instanceof File && invoiceFile.size > 0) {
    validateUploadedFile(invoiceFile, { purpose: "invoice", maxBytes: MAX_FILE_SIZE });
    const raw = Buffer.from(await invoiceFile.arrayBuffer());
    const enc = encryptBuffer(raw);
    const path = await storage.writeFile(storageScope(existing.matterId, requestId), enc.ciphertext);
    const doc = await prisma.document.create({
      data: {
        matterId: existing.matterId,
        name: invoiceFile.name,
        category: "OTHER",
        path,
        mimeType: invoiceFile.type || "application/octet-stream",
        size: invoiceFile.size,
        sha256: sha256(raw),
        encrypted: true,
        algorithm: enc.algorithm,
        iv: enc.iv.toString("base64"),
        authTag: enc.authTag.toString("base64"),
        tags: ["电子发票"],
        uploadedById: session.user.id
      }
    });
    invoiceFileDocId = doc.id;
  }

  const finalStatus = invoiceFileDocId
    ? ("ISSUED" as const)
    : contractScanDocId
      ? ("APPROVED" as const)
      : ("APPROVED" as const);

  await approvalTransaction(async tx => {
    if (existing.status === "APPROVED") {
      if (!await canExecuteInvoice(session.user.id, requestId, tx)) throw new Error("开票执行权限已失效");
    } else await assertApprovalItem(session.user.id, "INVOICE_APPROVE", requestId, tx);
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
  if (!existing) throw new Error("申请不存在");
  if (existing.status === "ISSUED") throw new Error("已开具的申请不可驳回");

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

/** 财务页 KPI：本月已开票合计 */
export async function getInvoiceStats() {
  const session = await requireSession("approval");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const visibilityWhere = invoiceRequestVisibilityWhere(session.user.id, session.user.role, session.user.rolePermissions);
  const issued = await prisma.invoiceRequest.aggregate({
    where: {
      ...visibilityWhere,
      status: "ISSUED",
      processedAt: { gte: monthStart }
    },
    _sum: { amount: true },
    _count: true
  });
  const pendingCount = await prisma.invoiceRequest.count({
    where: {
      ...visibilityWhere,
      status: "PENDING"
    }
  });
  return {
    monthlyIssued: Number(issued._sum.amount ?? 0),
    monthlyIssuedCount: issued._count,
    pendingCount
  };
}
