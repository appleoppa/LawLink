"use server";
import {assertExecutionOpen} from "@/server/approval-permissions/termination";
import { checkRoleMutation } from "@/lib/roles/service";
import { isManager } from "@/lib/permissions";
import { shParts } from "@/lib/ui/sh-time";
import { shMonthStart } from "@/server/finance/facts";
import { approvalTransaction, approvalAudit, assertApprovalItem, approvalContextFor, requireApprovalRoute, canApproveItem, approvalRecipients } from "@/lib/approvals/service";
import { selfConfirmEligible } from "@/lib/approvals/self-confirm";
import { canReadDocument } from "@/lib/approvals/documents";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type SealType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { notifyDirectApprovers } from "@/server/notifications/approval";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAssociateMatter } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import { decryptBuffer, encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { normalizeUploadedFilename } from "@/lib/filename";
import {
  sealCreateSchema,
  sealApproveSchema,
  sealRejectSchema,
  sealCancelSchema,
  sealListFilterSchema
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

const MAX_FILE_SIZE = 20 * 1024 * 1024;


function assertPdfDocument(file: { name?: string | null; type?: string | null; mimeType?: string | null }) {
  const type = file.type ?? file.mimeType ?? "";
  const name = file.name ?? "";
  if (type !== "application/pdf" && !name.toLowerCase().endsWith(".pdf")) {
    throw new ActionError("需上传 pdf 格式文件");
  }
}

// ============================================================
// 流水号 SEAL-YYYY-NNNN
// ============================================================
async function generateSealCode(): Promise<string> {
  // 2026-09-20 第五轮审计时区修复：编号年份按上海（元旦 0-8 点不再生成去年编号、落去年计数器）
  const year = shParts(new Date()).y;
  const key = `seal-counter-${year}`;
  const next = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.systemSetting.findUnique({ where: { key } });
      const current = (existing?.value as { value?: number })?.value ?? 0;
      const incremented = current + 1;
      await tx.systemSetting.upsert({
        where: { key },
        update: { value: { value: incremented } },
        create: { key, value: { value: incremented } }
      });
      return incremented;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  return `SEAL-${year}-${String(next).padStart(4, "0")}`;
}

// ============================================================
// 权限 - 谁能审批某 sealType
// ============================================================
// ============================================================
// 列表
// ============================================================
export async function listSealRequests(input?: z.input<typeof sealListFilterSchema>) {
  const session = await requireSession("approval");
  const filter = sealListFilterSchema.parse(input ?? {});
  const rows = await prisma.sealRequest.findMany({
    where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.sealType ? { sealType: filter.sealType } : {}), ...(filter.scope === "mine" ? { requestedById: session.user.id } : {}), ...(filter.scope === "approval" ? { status: "PENDING" } : {}) },
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } },
      stampedByUser: { select: { id: true, name: true } }, draftDoc: { select: { id: true, name: true, size: true } }, stampedDoc: { select: { id: true, name: true, size: true } }
    }
  });
  const allowed = await Promise.all(rows.map(async row => {
    const canApprove = row.status === "PENDING" && await canApproveItem(session.user.id, "SEAL_APPROVE", row.id);
    const canStamp = row.status === "APPROVED" && await canApproveItem(session.user.id, "SEAL_STAMP", row.id);
    const canRead = row.requestedById === session.user.id || canApprove || canStamp || row.approvedById === session.user.id || row.stampedById === session.user.id;
    return (filter.scope === "approval" ? canApprove : canRead) ? { ...row, canApprove, canStamp } : null;
  }));
  return allowed.filter((row): row is NonNullable<typeof row> => row !== null);
}

async function notifySealApprovalRequested(input: {
  sealRequestId: string;
  code: string;
  sealType: SealType;
  documentTitle: string;
  purpose: string;
  requesterId: string;
  requesterName?: string | null;
  urgency: "NORMAL" | "URGENT";
}) {
  const userIds = await approvalRecipients(await approvalContextFor("SEAL_APPROVE", input.sealRequestId));
  await notifyDirectApprovers({
    userIds,
    excludeUserId: input.requesterId,
    title: "新的用印审批待处理",
    content: `${input.requesterName ?? "有用户"} 提交了用印申请：${input.code} · ${input.documentTitle} · ${input.purpose}`,
    href: `/approvals/seals?id=${input.sealRequestId}`,
    refType: "SealRequest",
    refId: input.sealRequestId,
    priority: input.urgency === "URGENT" ? "URGENT" : "HIGH"
  });
}

export async function getSealApprovalCapabilities() {
  await requireSession("approval");
  return { canApprove: true, canViewFirmQueue: true };
}

export async function getSealRequest(id: string) {
  const rows = await listSealRequests({ scope: "all" });
  return rows.find(row => row.id === id) ?? null;
}

export async function listSealTypeConfigs() {
  await requireSession("approval");
  return prisma.sealTypeConfig.findMany({ orderBy: { type: "asc" } });
}

export async function getSealStats() {
  const rows = await listSealRequests({ scope: "all" });
  // 2026-09-20 第五轮审计时区修复：本月窗口按上海月首
  const monthStart = shMonthStart();
  return { monthStamped: rows.filter(r => r.status === "STAMPED" && r.stampedAt && r.stampedAt >= monthStart).length,
    pendingApprovalCount: rows.filter(r => r.canApprove).length, waitingStampCount: rows.filter(r => r.canStamp).length };
}

// ============================================================
// 新建申请 - FormData（含 draftDoc 文件）
// ============================================================
export async function createSealRequest(formData: FormData) {
  const session = await requireSession("seals.request");
  if (session.user.role !== "CUSTOM" && !isManager(session.user) && session.user.role !== "INDEPENDENT_LAWYER" && session.user.role !== "LAWYER") {
    throw new ActionError("仅律师、合伙人或获授权岗位可申请用章");
  }

  const raw = {
    sealType: formData.get("sealType"),
    matterId: formData.get("matterId") || null,
    purposeConfigId: formData.get("purposeConfigId") || null,
    purpose: formData.get("purpose"),
    documentTitle: formData.get("documentTitle"),
    pageCount: formData.get("pageCount") ?? "1",
    requireCrossPageSeal: formData.get("requireCrossPageSeal") === "true",
    copies: formData.get("copies") ?? "1",
    urgency: formData.get("urgency") ?? "NORMAL",
    requestNote: formData.get("requestNote") || "",
    parentSealRequestId: formData.get("parentSealRequestId") || null
  };
  const data = sealCreateSchema.parse(raw);

  // "同时加盖法定代表人章"：主章不是法人章时附带创建一个 LEGAL_REP_SEAL 子请求，
  // 共用同一份文件副本，便于两条审批线分别走（公章/合同章走对应审批人，法人章走法定代表人）
  const alsoLegalRep =
    formData.get("alsoLegalRep") === "true" && data.sealType !== "LEGAL_REP_SEAL";

  const category = data.matterId ? (await prisma.matter.findUniqueOrThrow({ where: { id: data.matterId }, select: { category: true } })).category : null;
  const purposeConfig = data.purposeConfigId ? await prisma.sealPurposeConfig.findUnique({ where: { id: data.purposeConfigId } }) : null;
  if (!purposeConfig) throw new ActionError("请选择管理员配置的用章事项");
  // v1.x 4.3：主章命中自确认清单时跳过审批路由（法人章硬排除，永不自确认）；
  // 附带的法定代表人子请求仍走完整审批。
  const mainSealSelfConfirm = !alsoLegalRep && (await selfConfirmEligible(
    { action: "SEAL_APPROVE", category, requesterId: session.user.id, sealType: data.sealType, purposeId: purposeConfig?.id ?? null },
    prisma
  ));
  for (const type of [data.sealType, ...(alsoLegalRep ? ["LEGAL_REP_SEAL" as const] : [])]) {
    const cfg = await prisma.sealTypeConfig.findUnique({ where: { type } });
    if (!cfg?.enabled) throw new ActionError("该印章已停用");
    if (purposeConfig && (!purposeConfig.active || !purposeConfig.allowedSealTypes.includes(type))) throw new ActionError("所选事项不允许使用此印章");
    const typeSelfConfirm = mainSealSelfConfirm && type === data.sealType;
    if (!typeSelfConfirm) {
      await requireApprovalRoute({ action: "SEAL_APPROVE", category, requesterId: session.user.id, sealType: type, purposeId: purposeConfig?.id });
    }
  }
  if (data.parentSealRequestId) {
    const parent = await prisma.sealRequest.findUnique({ where: { id: data.parentSealRequestId }, select: { requestedById: true, status: true } });
    if (!parent || parent.requestedById !== session.user.id || parent.status !== "REJECTED") throw new ActionError("仅能重新提交自己被驳回的申请");
  }

  const existingDraftDocId = formData.get("existingDraftDocId");
  const draftFile = formData.get("draftDoc");

  // 若有 matterId 校验存在
  if (data.matterId) {
    await assertCanAssociateMatter(session.user.id, data.matterId);
    await assertMatterWritable(data.matterId);
    const m = await prisma.matter.findUnique({
      where: { id: data.matterId },
      select: { id: true }
    });
    if (!m) throw new ActionError("关联案件不存在");
  }

  // 准备 draftDocId：要么复制现有文档（卷宗联动），要么上传新文件
  // plainBuf 保留明文，便于"同时加盖法人章"时复制副本
  let plainBuf: Buffer;
  let draftDocPrepare: {
    name: string;
    mimeType: string;
    size: number;
    sha: string;
    path: string;
    algorithm: string;
    iv: string;
    authTag: string;
  };

  if (typeof existingDraftDocId === "string" && existingDraftDocId) {
    // 联动：从卷宗带来的现有文档 → 复制一份独立副本（SealRequest.draftDocId 是 unique）
    const src = await prisma.document.findUnique({
      where: { id: existingDraftDocId }
    });
    if (!src || src.deletedAt || !await canReadDocument(session.user.id, src)) throw new ActionError("待盖章文档不存在或无权访问");
    assertPdfDocument(src);
    const srcCt = await storage.readFile(src.path);
    plainBuf =
      src.encrypted && src.iv && src.authTag
        ? decryptBuffer(srcCt, src.iv, src.authTag)
        : srcCt;
    const enc = encryptBuffer(plainBuf);
    const newPath = await storage.writeFile(
      data.matterId ? `m_${data.matterId}` : "seals",
      enc.ciphertext
    );
    draftDocPrepare = {
      name: src.name,
      mimeType: src.mimeType ?? "application/octet-stream",
      size: src.size ?? plainBuf.length,
      sha: sha256(plainBuf),
      path: newPath,
      algorithm: enc.algorithm,
      iv: enc.iv.toString("base64"),
      authTag: enc.authTag.toString("base64")
    };
  } else if (draftFile instanceof File && draftFile.size > 0) {
    assertPdfDocument(draftFile);
    const validatedDraft = validateUploadedFile(draftFile, { purpose: "seal", maxBytes: MAX_FILE_SIZE });
    plainBuf = Buffer.from(await draftFile.arrayBuffer());
    const enc = encryptBuffer(plainBuf);
    const newPath = await storage.writeFile(
      data.matterId ? `m_${data.matterId}` : "seals",
      enc.ciphertext
    );
    draftDocPrepare = {
      name: normalizeUploadedFilename(draftFile.name),
      mimeType: validatedDraft.mimeType,
      size: draftFile.size,
      sha: sha256(plainBuf),
      path: newPath,
      algorithm: enc.algorithm,
      iv: enc.iv.toString("base64"),
      authTag: enc.authTag.toString("base64")
    };
  } else {
    throw new ActionError("请上传待盖章稿");
  }

  const code = await generateSealCode();
  // 子请求（法人章）也要预生成 code，否则不能在事务内调用 generateSealCode（嵌套事务）
  const legalRepCode = alsoLegalRep ? await generateSealCode() : null;

  // 子请求复制一份独立加密副本（draftDocId 是 unique）
  let legalRepDocPrepare: typeof draftDocPrepare | null = null;
  if (alsoLegalRep) {
    const enc2 = encryptBuffer(plainBuf);
    const path2 = await storage.writeFile(
      data.matterId ? `m_${data.matterId}` : "seals",
      enc2.ciphertext
    );
    legalRepDocPrepare = {
      name: draftDocPrepare.name,
      mimeType: draftDocPrepare.mimeType,
      size: draftDocPrepare.size,
      sha: draftDocPrepare.sha,
      path: path2,
      algorithm: enc2.algorithm,
      iv: enc2.iv.toString("base64"),
      authTag: enc2.authTag.toString("base64")
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "seals.request");
    const draftDoc = await tx.document.create({
      data: {
        matterId: data.matterId ?? undefined,
        name: draftDocPrepare.name,
        category: "OTHER",
        path: draftDocPrepare.path,
        mimeType: draftDocPrepare.mimeType,
        size: draftDocPrepare.size,
        sha256: draftDocPrepare.sha,
        encrypted: true,
        algorithm: draftDocPrepare.algorithm,
        iv: draftDocPrepare.iv,
        authTag: draftDocPrepare.authTag,
        tags: ["用章申请", "待盖章稿"],
        uploadedById: session.user.id
      }
    });

    const seal = await tx.sealRequest.create({
      data: {
        code,
        sealType: data.sealType,
        matterId: data.matterId ?? undefined,
        purposeConfigId: purposeConfig?.id,
        purposeLabel: purposeConfig?.name,
        purpose: data.purpose.trim(),
        documentTitle: data.documentTitle.trim(),
        pageCount: data.pageCount,
        requireCrossPageSeal: data.requireCrossPageSeal,
        copies: data.copies,
        urgency: data.urgency,
        requestNote: (data.requestNote || "").trim() || null,
        draftDocId: draftDoc.id,
        requestedById: session.user.id,
        status: mainSealSelfConfirm ? "APPROVED" : "PENDING",
        parentSealRequestId: data.parentSealRequestId ?? undefined
      }
    });
    if (mainSealSelfConfirm) {
      await approvalAudit(tx, session.user.id, "SEAL_SELF_CONFIRM", seal.id, {
        sealType: data.sealType,
        purpose: purposeConfig?.name ?? data.purpose,
        note: "命中自确认清单，申请人自我确认即生效；盖章回填流程不变"
      });
    }

    let legalRepSealId: string | null = null;
    if (legalRepDocPrepare && legalRepCode) {
      const legalRepDoc = await tx.document.create({
        data: {
          matterId: data.matterId ?? undefined,
          name: legalRepDocPrepare.name,
          category: "OTHER",
          path: legalRepDocPrepare.path,
          mimeType: legalRepDocPrepare.mimeType,
          size: legalRepDocPrepare.size,
          sha256: legalRepDocPrepare.sha,
          encrypted: true,
          algorithm: legalRepDocPrepare.algorithm,
          iv: legalRepDocPrepare.iv,
          authTag: legalRepDocPrepare.authTag,
          tags: ["用章申请", "待盖章稿", "法人章副本"],
          uploadedById: session.user.id
        }
      });
      const legalRepSeal = await tx.sealRequest.create({
        data: {
          code: legalRepCode,
          sealType: "LEGAL_REP_SEAL",
          matterId: data.matterId ?? undefined,
          purposeConfigId: purposeConfig?.id,
          purposeLabel: purposeConfig?.name,
          purpose: `${data.purpose.trim()}（与 ${code} 同时加盖）`,
          documentTitle: data.documentTitle.trim(),
          pageCount: data.pageCount,
          requireCrossPageSeal: data.requireCrossPageSeal,
          copies: data.copies,
          urgency: data.urgency,
          requestNote: (data.requestNote || "").trim() || null,
          draftDocId: legalRepDoc.id,
          requestedById: session.user.id,
          status: "PENDING",
          parentSealRequestId: seal.id
        }
      });
      legalRepSealId = legalRepSeal.id;
    }

    return { seal, legalRepSealId };
  });

  await audit({
    userId: session.user.id,
    action: "SEAL_REQUEST_CREATE",
    targetType: "SealRequest",
    targetId: created.seal.id,
    detail: {
      code,
      sealType: data.sealType,
      matterId: data.matterId,
      alsoLegalRep: !!created.legalRepSealId
    }
  });
  if (created.legalRepSealId && legalRepCode) {
    await audit({
      userId: session.user.id,
      action: "SEAL_REQUEST_CREATE",
      targetType: "SealRequest",
      targetId: created.legalRepSealId,
      detail: {
        code: legalRepCode,
        sealType: "LEGAL_REP_SEAL",
        matterId: data.matterId,
        parentCode: code
      }
    });
  }

  // 自确认直效的申请不进审批队列，也不给审批人发「待审批」通知（假任务）；
  // 通知申请人本人留痕即可。
  if (mainSealSelfConfirm) {
    await prisma.notification.create({
      data: {
        userId: session.user.id,
        type: "SYSTEM",
        title: "用章申请已按自确认配置直接生效",
        content: `${data.documentTitle.trim()}（${code}）`,
        href: "/approvals?tab=mine",
        refType: "SealRequest",
        refId: created.seal.id
      }
    });
  } else {
    await notifySealApprovalRequested({
      sealRequestId: created.seal.id,
      code,
      sealType: data.sealType,
      documentTitle: data.documentTitle.trim(),
      purpose: data.purpose.trim(),
      requesterId: session.user.id,
      requesterName: session.user.name,
      urgency: data.urgency
    });
  }

  if (created.legalRepSealId && legalRepCode) {
    await notifySealApprovalRequested({
      sealRequestId: created.legalRepSealId,
      code: legalRepCode,
      sealType: "LEGAL_REP_SEAL",
      documentTitle: data.documentTitle.trim(),
      purpose: `${data.purpose.trim()}（与 ${code} 同时加盖）`,
      requesterId: session.user.id,
      requesterName: session.user.name,
      urgency: data.urgency
    });
  }

  revalidatePath("/approvals/seals");
  revalidatePath("/approvals");
  if (data.matterId) await revalidateMatter(data.matterId);
  return { ok: true, id: created.seal.id, code };
}

// ============================================================
// 审批通过
// ============================================================
export async function approveSealRequest(input: z.infer<typeof sealApproveSchema>) {
  const session = await requireSession("approval");
  const data = sealApproveSchema.parse(input);

  const seal = await prisma.sealRequest.findUnique({
    where: { id: data.id },
    select: { id: true, status: true, sealType: true, matterId: true, requestedById: true, updatedAt: true }
  });
  if (!seal) throw new ActionError("申请不存在");
  if (seal.status !== "PENDING") throw new ActionError("此申请已处理");



  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "SEAL_APPROVE", data.id, tx);
  await tx.sealRequest.update({
    where: { id: data.id, status: "PENDING", updatedAt: seal.updatedAt },
    data: {
      status: "APPROVED",
      approveNote: (data.note || "").trim() || null,
      approvedById: session.user.id,
      approvedAt: new Date()
    }
  });
    await approvalAudit(tx, session.user.id, "SEAL_APPROVED", data.id, { note: data.note ?? "" });
  });


  await createNotification({
    userId: seal.requestedById,
    type: "SEAL_STATUS_CHANGE",
    title: "用章申请已通过",
    content: `您的用章申请（${seal.sealType}）已审批通过`,
    href: "/approvals/seals",
    refType: "SealRequest",
    refId: data.id
  });

  revalidatePath("/approvals/seals");
  revalidatePath("/approvals");
  if (seal.matterId) await revalidateMatter(seal.matterId);
  return { ok: true };
}

// ============================================================
// 驳回
// ============================================================
export async function rejectSealRequest(input: z.infer<typeof sealRejectSchema>) {
  const session = await requireSession("approval");
  const data = sealRejectSchema.parse(input);

  const seal = await prisma.sealRequest.findUnique({
    where: { id: data.id },
    select: { id: true, status: true, sealType: true, matterId: true, requestedById: true, updatedAt: true }
  });
  if (!seal) throw new ActionError("申请不存在");
  if (seal.status !== "PENDING") throw new ActionError("此申请已处理");



  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "SEAL_APPROVE", data.id, tx);
  await tx.sealRequest.update({
    where: { id: data.id, status: "PENDING", updatedAt: seal.updatedAt },
    data: {
      status: "REJECTED",
      approveNote: data.reason,
      approvedById: session.user.id,
      approvedAt: new Date(),
      rejectedAt: new Date()
    }
  });
    await approvalAudit(tx, session.user.id, "SEAL_REJECTED", data.id, { note: data.reason });
  });


  await createNotification({
    userId: seal.requestedById,
    type: "SEAL_STATUS_CHANGE",
    title: "用章申请已驳回",
    content: `您的用章申请（${seal.sealType}）已被驳回，原因：${data.reason}`,
    href: "/approvals/seals",
    refType: "SealRequest",
    refId: data.id
  });

  revalidatePath("/approvals/seals");
  revalidatePath("/approvals");
  if (seal.matterId) await revalidateMatter(seal.matterId);
  return { ok: true };
}

// ============================================================
// 盖章回填（FormData：stampedDoc 必传）
// ============================================================
export async function stampSealRequest(formData: FormData) {
  const session = await requireSession("approval");

  const id = formData.get("id");
  if (typeof id !== "string" || !id) throw new ActionError("id 缺失");

  const seal = await prisma.sealRequest.findUnique({
    where: { id },
    select: { id: true, status: true, sealType: true, matterId: true, requestedById: true }
  });
  if (!seal) throw new ActionError("申请不存在");
  if (seal.status !== "APPROVED") throw new ActionError("仅已批准的申请可回填盖章件");

  await assertExecutionOpen(prisma,"SEAL",id);
  await assertApprovalItem(session.user.id, "SEAL_STAMP", id);

  const stampedFile = formData.get("stampedDoc");
  if (!(stampedFile instanceof File) || stampedFile.size === 0) {
    throw new ActionError("请上传盖章后扫描件");
  }
  assertPdfDocument(stampedFile);
  const validatedStamped = validateUploadedFile(stampedFile, { purpose: "stamp", maxBytes: MAX_FILE_SIZE });

  const buf = Buffer.from(await stampedFile.arrayBuffer());
  const enc = encryptBuffer(buf);
  const path = await storage.writeFile(
    seal.matterId ? `m_${seal.matterId}` : "seals",
    enc.ciphertext
  );

  await approvalTransaction(async (tx) => {
    await assertExecutionOpen(tx,"SEAL",id);
    await assertApprovalItem(session.user.id, "SEAL_STAMP", id, tx);
    // 法人章本人回填仅在 allowSelfApproval 单人例外开启时可达（P2-14），审计显式标注
    await approvalAudit(tx, session.user.id, "SEAL_STAMPED", id, seal.requestedById === session.user.id && seal.sealType === "LEGAL_REP_SEAL" ? { selfStamp: true } : undefined);
    const stampedDoc = await tx.document.create({
      data: {
        matterId: seal.matterId ?? undefined,
        name: normalizeUploadedFilename(stampedFile.name),
        category: "OTHER",
        path,
        mimeType: validatedStamped.mimeType,
        size: stampedFile.size,
        sha256: sha256(buf),
        encrypted: true,
        algorithm: enc.algorithm,
        iv: enc.iv.toString("base64"),
        authTag: enc.authTag.toString("base64"),
        tags: ["用章申请", "盖章后扫描件"],
        uploadedById: session.user.id
      }
    });
    await tx.sealRequest.update({
      where: { id, status: "APPROVED" },
      data: {
        status: "STAMPED",
        stampedDocId: stampedDoc.id,
        stampedById: session.user.id,
        stampedAt: new Date()
      }
    });
  });

  await audit({
    userId: session.user.id,
    action: "SEAL_STAMPED",
    targetType: "SealRequest",
    targetId: id,
    detail: { sealType: seal.sealType }
  });

  revalidatePath("/approvals/seals");
  revalidatePath("/approvals");
  if (seal.matterId) await revalidateMatter(seal.matterId);
  return { ok: true };
}

// ============================================================
// 撤销（仅未审批 + 仅申请人/主任律师）
// ============================================================
export async function cancelSealRequest(input: z.infer<typeof sealCancelSchema>) {
  const session = await requireSession("approval");
  const data = sealCancelSchema.parse(input);

  const seal = await prisma.sealRequest.findUnique({
    where: { id: data.id },
    select: { id: true, status: true, requestedById: true, matterId: true }
  });
  if (!seal) throw new ActionError("申请不存在");
  if (seal.status !== "PENDING") throw new ActionError("仅未审批的申请可撤销");

  const isOwner = seal.requestedById === session.user.id;
  const canCancelOthers = isManager(session.user);
  if (!isOwner && !canCancelOthers) throw new ActionError("仅申请人或主任律师可撤销");

  await prisma.sealRequest.update({
    where: { id: data.id, status: "PENDING" },
    data: { status: "CANCELLED" }
  });

  await audit({
    userId: session.user.id,
    action: "SEAL_CANCELLED",
    targetType: "SealRequest",
    targetId: data.id
  });

  revalidatePath("/approvals/seals");
  revalidatePath("/approvals");
  if (seal.matterId) await revalidateMatter(seal.matterId);
  return { ok: true };
}
