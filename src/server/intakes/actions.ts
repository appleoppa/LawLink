"use server";
import { hasCustomPermission, scopeFor } from "@/lib/roles/catalog";
import { clientVisibilityFilter } from "@/lib/permissions";
import { normalizeIdNumber, duplicateWhereInput, suggestIdType } from "@/lib/clients/identity";
import { sealIdNumber, decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { roleMutation } from "@/lib/roles/service";

import { assertAssignableColleagues } from "@/lib/teams/validate-colleagues";

import { buildIntakeConflictQueries, conflictPartyRoleLabel } from "@/lib/approvals/intake-detail";
import { approvalTransaction, approvalAudit, assertApprovalItem, approvalContextFor, requireApprovalRoute } from "@/lib/approvals/service";


import { revalidatePath } from "next/cache";
import { Prisma, type ClientIdType, type ClientType, type LitigationStanding, type PartyType, type PartyRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultStageNamesForProcedure } from "@/lib/procedure-stage-defaults";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { intakeVisibilityFilter, intakeReadVisibilityFilter, teamIntakeFilter } from "@/lib/permissions";
import { assertAgencyAllowedForProcedure, normalizeJurisdictionForAgency } from "@/lib/china-regions";
import { serializeDecimals } from "@/lib/decimal";
import {
  intakeCreateSchema,
  intakeListQuerySchema,
  declineIntakeSchema,
  type IntakeCreateInput,
  type IntakeListQuery,
  type DeclineIntakeInput
} from "./schemas";
import { seedDefaultFolders } from "@/lib/default-folders";
import { notifyRoleApprovers } from "@/server/notifications/approval";
import { assertCauseAllowedForSelection } from "@/server/causes/validation";
import { recordTimelineEvent } from "@/server/timeline/record";

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? null : v;
  }
  return out as T;
}


/** 按 {委托方} 与 {对方} {案由} 自动生成标题 — 案由本身通常已含"纠纷"二字 */
function generateTitle(
  clientName: string | null,
  opposingNames: string[],
  causeName: string | null
): string {
  const left = clientName || "待补充委托方";
  const right = opposingNames.length > 0 ? opposingNames.join("、") : "待补充对方";
  const cause = causeName ?? "案件";
  // 案件名称不含空格（产品要求，与 matterCreateSchema 去空白一致）
  return `${left}与${right}${cause}`.replace(/\s+/g, "");
}

function clientTypeToPartyType(type: ClientType): PartyType {
  if (type === "INDIVIDUAL") return "NATURAL_PERSON";
  if (type === "COMPANY") return "COMPANY";
  return "OTHER_ORG";
}

type IntakeConflictRole = PartyRole;

type IntakeConflictQuery = {
  role: IntakeConflictRole;
  name: string;
  idNumber: string;
};

type IntakeConflictGateInput = {
  client: { name: string; idNumber: string | null } | null;
  parties: { role: PartyRole; name: string; idNumber: string | null; enterpriseSocialCode?: string | null }[];
  conflictChecks: {
    conclusion: string;
    note: string | null;
    queryPayload: Prisma.JsonValue;
    hits: { severity: string }[];
  }[];
};

function normalizeConflictQuery(q: {
  role?: string | null;
  name?: string | null;
  idNumber?: string | null;
}): IntakeConflictQuery | null {
  if (!q.role || !Object.prototype.hasOwnProperty.call(conflictPartyRoleLabel, q.role)) {
    return null;
  }
  const name = q.name?.trim() ?? "";
  const idNumber = q.idNumber?.trim() ?? "";
  if (!name && !idNumber) return null;
  return { role: q.role as PartyRole, name, idNumber };
}

function conflictQueryKey(q: IntakeConflictQuery) {
  return `${q.role}|${q.name}|${q.idNumber}`;
}

function formatConflictQuery(q: IntakeConflictQuery) {
  return `${conflictPartyRoleLabel[q.role]}「${q.name || "仅证件条件"}」`;
}

function buildExpectedConflictQueries(intake: IntakeConflictGateInput) {
  return buildIntakeConflictQueries(intake, decryptIdNumber);
}

function getCheckedConflictQueries(payload: Prisma.JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const queries = (payload as { queries?: unknown }).queries;
  if (!Array.isArray(queries)) return [];

  return queries
    .map((q) => {
      if (!q || typeof q !== "object" || Array.isArray(q)) return null;
      const row = q as { role?: unknown; name?: unknown; idNumber?: unknown };
      return normalizeConflictQuery({
        role: typeof row.role === "string" ? row.role : null,
        name: typeof row.name === "string" ? row.name : null,
        idNumber: typeof row.idNumber === "string" ? row.idNumber : null
      });
    })
    .filter((q): q is IntakeConflictQuery => !!q);
}

function assertConflictReviewAllowsConversion(intake: IntakeConflictGateInput) {
  const expectedQueries = buildExpectedConflictQueries(intake);
  if (expectedQueries.length === 0) {
    throw new Error("请先补充委托方或相对方，再运行利益冲突检索");
  }

  const latestCheck = intake.conflictChecks[0];
  if (!latestCheck) {
    throw new Error("转为正式案件前必须先运行利益冲突检索");
  }

  const checkedKeys = new Set(
    getCheckedConflictQueries(latestCheck.queryPayload).map(conflictQueryKey)
  );
  const missingQueries = expectedQueries.filter((q) => !checkedKeys.has(conflictQueryKey(q)));
  if (missingQueries.length > 0) {
    throw new Error(
      `收案当事人已变更，请重新运行利益冲突检索。缺少：${missingQueries
        .map(formatConflictQuery)
        .join("、")}`
    );
  }

  if (latestCheck.conclusion === "PENDING") {
    throw new Error("利益冲突检索还没有结论，请先标记是否可承接");
  }
  if (latestCheck.conclusion === "NEED_INFO") {
    throw new Error("利益冲突检索结论为信息不足，不能转为正式案件");
  }
  if (latestCheck.conclusion === "SAME_SUBJECT") {
    throw new Error("已确认存在利益冲突，不能直接转为正式案件");
  }
  if (latestCheck.conclusion !== "DIFFERENT") {
    throw new Error("利益冲突检索结论异常，请重新检索后再转为正式案件");
  }

  const hasHighRiskHit = latestCheck.hits.some(
    (h) => h.severity === "HIGH" || h.severity === "BLOCKING"
  );
  if (hasHighRiskHit && !latestCheck.note?.trim()) {
    throw new Error("存在高风险或阻塞命中，请在冲突结论备注中写明排除理由或书面同意留痕");
  }
}

export async function listIntakes(input: Partial<IntakeListQuery> = {}) {
  const session = await requireSession("matters.read");
  const query = intakeListQuerySchema.parse(input);

  const statusWhere: Prisma.IntakeWhereInput = query.statusIn?.length
    ? { status: { in: query.statusIn } }
    : query.status
      ? { status: query.status }
      : {};

  const orderBy: Prisma.IntakeOrderByWithRelationInput[] =
    query.sortBy === "claimAmount"
      ? [{ claimAmount: query.sortDir }, { receivedAt: "desc" }]
      : [{ receivedAt: query.sortDir }];

  const whereParts: Prisma.IntakeWhereInput[] = [
    intakeReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions),
    statusWhere
  ];
  if (query.scope === "mine") whereParts.push(intakeVisibilityFilter(session.user.id, "LAWYER", session.user.rolePermissions));
  if (query.scope === "team" || query.teamId) whereParts.push(teamIntakeFilter(session.user.id, query.teamId));
  if (query.ownerId) whereParts.push({ ownerUserId: query.ownerId });
  if (query.category) whereParts.push({ category: query.category });
  if (query.receivedAtFrom || query.receivedAtTo) {
    whereParts.push({
      receivedAt: {
        ...(query.receivedAtFrom ? { gte: query.receivedAtFrom } : {}),
        ...(query.receivedAtTo ? { lte: query.receivedAtTo } : {})
      }
    });
  }
  if (query.search) {
    whereParts.push({
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { client: { name: { contains: query.search, mode: "insensitive" } } }
      ]
    });
  }
  const where: Prisma.IntakeWhereInput = { AND: whereParts };

  const [items, total] = await Promise.all([
    prisma.intake.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, title: true, category: true, status: true, receivedAt: true, claimAmount: true,
        client: { select: { id: true, name: true, type: true } },
        cause: { select: { id: true, name: true } },
        conflictChecks: {
          orderBy: { checkedAt: "desc" },
          take: 1,
          select: { id: true, conclusion: true, hits: { select: { severity: true } } }
        },
        parties: { where: { role: "OPPOSING_PARTY" }, select: { name: true } },
        matter: { select: { id: true, internalCode: true } },
        ownerUser: { select: { id: true, name: true } }
      }
    }),
    prisma.intake.count({ where })
  ]);

  return { items: serializeDecimals(items), total, page: query.page, pageSize: query.pageSize };
}

export async function getIntakeById(id: string) {
  const session = await requireSession("matters.read");
  const visible = await prisma.intake.findFirst({
    where: { id, ...intakeReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) },
    select: { id: true }
  });
  if (!visible) throw new Error("收案记录不存在");
  const intake = await prisma.intake.findUnique({
    where: { id },
    include: {
      client: true,
      cause: true,
      ownerUser: { select: { id: true, name: true, role: true } },
      parties: { orderBy: [{ role: "asc" }, { ordinal: "asc" }] },
      conflictChecks: {
        orderBy: { checkedAt: "desc" },
        include: { hits: true, decidedBy: { select: { id: true, name: true } } }
      },
      matter: { select: { id: true, internalCode: true, title: true } },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, category: true, size: true, createdAt: true }
      }
    }
  });
  if (intake) {
    await audit({
      userId: session.user.id,
      action: "INTAKE_VIEW",
      targetType: "Intake",
      targetId: id
    });
  }
  if (!intake) return null;
  const businessAccess = await prisma.intake.findFirst({
    where: { id, ...intakeVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) }, select: { id: true }
  });
  if (!businessAccess) return { ...intake, teamReadOnly: true,
    feeType: null, feeAmount: null, contingencyTerms: null, feeSchedule: null, feeNote: null,
    documents: [], conflictChecks: []
  };
  return { ...intake, teamReadOnly: !hasCustomPermission(session.user, "matters.write"),
    ...(!hasCustomPermission(session.user, "finance.read") ? { feeType: null, feeAmount: null, contingencyTerms: null, feeSchedule: null, feeNote: null } : {}),
    ...(!hasCustomPermission(session.user, "documents.read") ? { documents: [] } : {})
  };
}

export async function createIntake(input: IntakeCreateInput) {
  const session = await requireSession("intakes.create");
  const data = intakeCreateSchema.parse(input);
  await requireApprovalRoute({ action: "INTAKE_APPROVE", category: data.category, requesterId: session.user.id });
  assertAgencyAllowedForProcedure(data.firstAgency, data.firstProcedureType);
  await assertCauseAllowedForSelection({
    causeId: data.causeId,
    category: data.category,
    procedureType: data.firstProcedureType
  });

  await assertAssignableColleagues([data.ownerUserId || session.user.id, ...data.coUserIds]);

  // ----- 解析客户：已选 / 自由输入新建 -----
  let resolvedClientId: string | null = data.clientId || null;
  let resolvedClientName: string | null = null;

  if (!resolvedClientId && data.clientName && data.clientName.trim()) {
    const name = data.clientName.trim();
    // v1.x P0-1: 收案自动建档走统一查重——证件命中（含软删）时拒绝并提示，
    // 避免收案入口绕过客户主数据唯一性。
    const normalizedIdNumber = normalizeIdNumber(data.clientIdNumber);
    const intakeIdType: ClientIdType | null = (data.clientIdType || null) as ClientIdType | null ?? suggestIdType(data.clientType ?? "INDIVIDUAL");
    if (normalizedIdNumber && intakeIdType) {
      const dup = await prisma.client.findFirst({
        where: duplicateWhereInput({ idType: intakeIdType, idNumber: normalizedIdNumber }),
        select: { id: true, name: true, deletedAt: true }
      });
      if (dup) {
        throw new Error(
          dup.deletedAt
            ? `客户证件号已登记于停用客户「${dup.name}」，请先恢复该客户或在客户档案中合并`
            : `客户证件号已登记于「${dup.name}」，请在客户栏选择该客户而非重新输入`
        );
      }
    }
    const newClient = await roleMutation(session.user, "intakes.create", async roleDb => roleDb.client.create({
      data: {
        name,
        type: data.clientType ?? "INDIVIDUAL",
        idType: normalizedIdNumber ? (intakeIdType ?? undefined) : undefined,
        ...(normalizedIdNumber ? sealIdNumber(normalizedIdNumber) : {}),
        address: data.clientAddress || null,
        legalRep: data.clientLegalRep || null,
        phone: data.contactPhone || null,
        // 同步建一个主联系人
        contacts:
          data.contactName?.trim() || data.contactPhone?.trim()
            ? {
                create: {
                  name: (data.contactName || name).trim(),
                  phone: data.contactPhone?.trim() || null,
                  isPrimary: true
                }
              }
            : undefined
      }
    }));
    resolvedClientId = newClient.id;
    resolvedClientName = name;
    await audit({
      userId: session.user.id,
      action: "CLIENT_AUTO_CREATE",
      targetType: "Client",
      targetId: newClient.id,
      detail: { name, type: newClient.type, source: "intake" }
    });
  } else if (resolvedClientId) {
    if (session.user.role === "CUSTOM" && !await prisma.client.count({ where: { id: resolvedClientId, deletedAt: null, ...clientVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) } })) throw new Error("客户不存在或无权选择");
    const c = await prisma.client.findUnique({
      where: { id: resolvedClientId },
      select: { name: true }
    });
    resolvedClientName = c?.name ?? null;

    // 已有客户也补一条联系人（如果填了且现有不存在同名联系人）
    if ((data.contactName?.trim() || data.contactPhone?.trim()) && hasCustomPermission(session.user, "clients.write")) {
      if (session.user.role === "CUSTOM") {
        const scope = scopeFor(session.user, "clients.write");
        if (!scope || !await prisma.client.count({ where: { id: resolvedClientId, ...clientVisibilityFilter(session.user.id, session.user.role, [{ permissionKey: "clients.read", scope }]) } })) throw new Error("无权维护此客户的联系人");
      }
      const existing = await prisma.contact.findFirst({
        where: {
          clientId: resolvedClientId,
          name: (data.contactName || resolvedClientName || "").trim() || undefined
        }
      });
      if (!existing) {
    const contactClientId = resolvedClientId;
        await roleMutation(session.user, "intakes.create", async roleDb => roleDb.contact.create({
          data: {
            clientId: contactClientId,
            name: (data.contactName || resolvedClientName || "联系人").trim(),
            phone: data.contactPhone?.trim() || null,
            isPrimary: false
          }
        }));
      }
    }
  }

  // ----- 案由名（用于自动 title）-----
  let causeName: string | null = data.causeFreeText || null;
  if (data.causeId) {
    const cause = await prisma.causeOfAction.findUnique({
      where: { id: data.causeId },
      select: { name: true }
    });
    causeName = cause?.name ?? causeName;
  }

  const opposingNames = data.parties
    .filter((p) => p.role === "OPPOSING_PARTY")
    .map((p) => p.name)
    .filter(Boolean);

  const finalTitle =
    data.title && data.title.trim()
      ? data.title.trim()
      : generateTitle(resolvedClientName, opposingNames, causeName);

  const created = await roleMutation(session.user, "intakes.create", async roleDb => roleDb.intake.create({
    data: {
      title: finalTitle,
      category: data.category,
      causeId: data.causeId || null,
      causeFreeText: data.causeFreeText || null,
      description: data.description || null,
      status: "PENDING_CONFIRMATION",
      receivedAt: data.receivedAt ?? new Date(),

      clientId: resolvedClientId,
      clientType: data.clientType ?? null,
      contactName: data.contactName?.trim() || null,
      contactPhone: data.contactPhone?.trim() || null,

      firstProcedureType: data.firstProcedureType ?? null,
      firstAgency: data.firstAgency?.trim() || null,
      jurisdiction: normalizeJurisdictionForAgency(data.firstAgency, data.jurisdiction),
      ourStanding: data.ourStanding ?? null,
      claimAmount: data.claimAmount ?? null,
      claimDescription: data.claimDescription?.trim() || null,
      barFiling: data.barFiling ?? null,
      counterclaim: data.counterclaim ?? false,

      businessType: data.businessType?.trim() || null,
      serviceScope: data.serviceScope?.trim() || null,
      deliverables: data.deliverables?.trim() || null,
      counselType: data.counselType?.trim() || null,
      serviceStart: data.serviceStart ?? null,
      serviceEnd: data.serviceEnd ?? null,

      feeType: data.feeType ?? null,
      feeAmount: data.feeAmount ?? null,
      contingencyTerms: data.contingencyTerms?.trim() || null,
      feeSchedule: data.feeSchedule?.trim() || null,
      feeNote: data.feeNote?.trim() || null,

      ownerUserId: data.ownerUserId || session.user.id,
      coUserIds: data.coUserIds,

      createdById: session.user.id,
      parties: {
        create: data.parties.map((p) =>
          emptyToNull({
            role: p.role,
            standing: p.standing ?? null,
            ordinal: p.ordinal,
            name: p.name,
            partyType: p.partyType,
            idType: p.partyType === "NATURAL_PERSON" ? (p.idType || "ID_CARD") : null,
            idNumber: p.idNumber,
            phone: p.phone,
            address: p.address,
            legalRep: p.legalRep,
            contactName: p.contactName,
            enterpriseSocialCode: p.enterpriseSocialCode,
            enterpriseName: p.enterpriseName,
            notes: p.notes
          })
        )
      }
    }
  }));

  await audit({
    userId: session.user.id,
    action: "INTAKE_CREATE",
    targetType: "Intake",
    targetId: created.id,
    detail: {
      title: created.title,
      category: created.category,
      autoTitle: !data.title,
      autoClient: !!resolvedClientName && !data.clientId
    }
  });

  await notifyRoleApprovers({
    roles: ["PRINCIPAL_LAWYER"],
    excludeUserId: session.user.id,
    title: "新的案件审批待处理",
    content: `${session.user.name ?? "有用户"} 提交了案件审批：${created.title}`,
    href: `/intakes/${created.id}`,
    refType: "Intake",
    refId: created.id,
    priority: "HIGH"
  });

  revalidatePath("/intakes");
  revalidatePath("/approvals");
  revalidatePath("/matters");
  return { ok: true, id: created.id, clientId: resolvedClientId };
}

export async function declineIntake(input: DeclineIntakeInput) {
  const session = await requireSession("approval");
  const data = declineIntakeSchema.parse(input);

  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "INTAKE_APPROVE", data.id, tx);
  await tx.intake.update({
    where: { id: data.id, status: "PENDING_CONFIRMATION" },
    data: {
      status: "DECLINED",
      declinedReason: data.reason
    }
  });
    const attachments = await tx.document.findMany({ where: { intakeId: data.id, deletedAt: null }, select: { id: true } });
    await approvalAudit(tx, session.user.id, "INTAKE_DECLINE", data.id, { reason: data.reason, attachmentIds: attachments.map(d => d.id) });
  });


  revalidatePath("/intakes");
  revalidatePath("/approvals");
  revalidatePath(`/intakes/${data.id}`);
  revalidatePath("/matters");
  return { ok: true };
}

/** v0.14: 标记需补正 — 让律师补充材料后可再次提交（区别于 DECLINED 终态） */
export async function markIntakeNeedsRevision(input: { id: string; reason: string }) {
  const session = await requireSession("approval");
  if (!input.reason.trim()) throw new Error("请填写补正原因");

  await approvalTransaction(async tx => {
    await assertApprovalItem(session.user.id, "INTAKE_APPROVE", input.id, tx);
  await tx.intake.update({
    where: { id: input.id, status: "PENDING_CONFIRMATION" },
    data: {
      status: "NEEDS_REVISION",
      declinedReason: input.reason
    }
  });
    const attachments = await tx.document.findMany({ where: { intakeId: input.id, deletedAt: null }, select: { id: true } });
    await approvalAudit(tx, session.user.id, "INTAKE_NEEDS_REVISION", input.id, { reason: input.reason.trim(), attachmentIds: attachments.map(d => d.id) });
  });


  revalidatePath("/intakes");
  revalidatePath("/approvals");
  revalidatePath(`/intakes/${input.id}`);
  revalidatePath("/matters");
  return { ok: true };
}

/** v0.14: 律师补完材料后重新提交（NEEDS_REVISION → PENDING_CONFIRMATION） */
export async function resubmitIntake(id: string) {
  const session = await requireSession("matters.write");

  const intake = await prisma.intake.findUnique({
    where: { id },
    select: { status: true, title: true, createdById: true, ownerUserId: true, declinedReason: true }
  });
  if (!intake) throw new Error("收案不存在");
  if (intake.createdById !== session.user.id && intake.ownerUserId !== session.user.id) throw new Error("仅申请人或主办可重新提交");
  await requireApprovalRoute(await approvalContextFor("INTAKE_APPROVE", id));
  if (intake.status !== "NEEDS_REVISION") throw new Error("只有待补正状态可重新提交");

  await roleMutation(session.user, "matters.write", async roleDb => roleDb.intake.update({
    where: { id, status: "NEEDS_REVISION" },
    data: {
      status: "PENDING_CONFIRMATION",
      declinedReason: null
    }
  }));

  await audit({
    userId: session.user.id,
    action: "INTAKE_RESUBMIT",
    targetType: "Intake",
    targetId: id,
    detail: { note: intake.declinedReason ? `前次补正意见（原记录）：${intake.declinedReason}` : "" }
  });

  await notifyRoleApprovers({
    roles: ["PRINCIPAL_LAWYER"],
    excludeUserId: session.user.id,
    title: "案件审批已重新提交",
    content: `${session.user.name ?? "有用户"} 重新提交了案件审批：${intake.title}`,
    href: `/intakes/${id}`,
    refType: "Intake",
    refId: id,
    priority: "HIGH"
  });

  revalidatePath("/intakes");
  revalidatePath("/approvals");
  revalidatePath(`/intakes/${id}`);
  revalidatePath("/matters");
  return { ok: true };
}

/** 转 Matter：把 intake 上的全部字段铺到 Matter / 首程序 / 程序当事人 / Billing / MatterMember / Document */
export async function convertIntakeToMatter(intakeId: string, note?: string) {
  const session = await requireSession("approval");
  await assertApprovalItem(session.user.id, "INTAKE_APPROVE", intakeId);
  const intake = await prisma.intake.findUnique({
    where: { id: intakeId },
    include: {
      client: true,
      parties: true,
      conflictChecks: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: {
          conclusion: true,
          note: true,
          queryPayload: true,
          hits: { select: { severity: true } }
        }
      },
      documents: { select: { id: true } }
    }
  });
  if (!intake) throw new Error("Intake 不存在");
  if (intake.status !== "PENDING_CONFIRMATION") throw new Error("仅待审批收案可转为正式案件");
  assertConflictReviewAllowsConversion(intake);

  const { generateInternalCode, generateFirmCaseNo } = await import("@/server/matters/code-generator");
  const internalCode = await generateInternalCode(intake.category);
  const firmCaseNo = await generateFirmCaseNo(intake.category);

  // 首程序类型：优先用 intake 选的，缺失按案件类别推断
  const firstProcedureType =
    intake.firstProcedureType ??
    (intake.category === "CIVIL_COMMERCIAL" ||
    intake.category === "CRIMINAL" ||
    intake.category === "ADMINISTRATIVE"
      ? "FIRST_INSTANCE"
      : "NON_LITIGATION_PHASE");
  assertAgencyAllowedForProcedure(intake.firstAgency, firstProcedureType);
  await assertCauseAllowedForSelection({
    causeId: intake.causeId,
    category: intake.category,
    procedureType: firstProcedureType
  });

  const matter = await approvalTransaction(async (tx) => {
    await assertApprovalItem(session.user.id, "INTAKE_APPROVE", intakeId, tx);
    await tx.intake.update({ where: { id: intakeId, status: "PENDING_CONFIRMATION", updatedAt: intake.updatedAt }, data: { status: "CONVERTED" } });
    await approvalAudit(tx, session.user.id, "INTAKE_APPROVE", intakeId, { note: note?.trim().slice(0, 500) ?? "", attachmentIds: intake.documents.map(d => d.id) });
    const ownerId = intake.ownerUserId ?? session.user.id;

    const m = await tx.matter.create({
      data: {
        internalCode,
        firmCaseNo,
        title: intake.title,
        category: intake.category,
        ownerId,
        registeredById: intake.createdById,
        causeId: intake.causeId,
        causeFreeText: intake.causeFreeText,
        primaryClientId: intake.clientId,
        intakeId: intake.id,
        intakeDate: intake.receivedAt,
        ourStanding: intake.ourStanding,
        claimAmount: intake.claimAmount,
        // 是否反诉：按我方地位推断角色（被告提反诉→反诉原告；原告被反诉→反诉被告）
        counterclaimAsPlaintiff:
          !!intake.counterclaim &&
          (intake.ourStanding === "DEFENDANT" || intake.ourStanding === "JOINT_DEFENDANT"),
        counterclaimAsDefendant:
          !!intake.counterclaim &&
          (intake.ourStanding === "PLAINTIFF" || intake.ourStanding === "JOINT_PLAINTIFF"),
        barFiling: intake.barFiling,
        // v0.35: 非诉/顾问/专项 专属字段带入
        businessType: intake.businessType,
        serviceScope: intake.serviceScope,
        deliverables: intake.deliverables,
        counselType: intake.counselType,
        serviceStart: intake.serviceStart,
        serviceEnd: intake.serviceEnd,
        // 主办自动作为 LEAD；coUserIds 作为 CO_LEAD
        members: {
          create: [
            { userId: ownerId, role: "LEAD" },
            ...intake.coUserIds
              .filter((uid) => uid !== ownerId)
              .map((uid) => ({ userId: uid, role: "CO_LEAD" as const }))
          ]
        },
        clientLinks: intake.clientId
          ? { create: { clientId: intake.clientId, isPrimary: true, label: "主要委托方" } }
          : undefined,
      }
    });

    const procedurePartyRows: { partyId: string; standing: LitigationStanding; ordinal: number }[] = [];
    let nextProcedurePartyOrdinal = 1;

    if (intake.client && intake.ourStanding) {
      const clientParty = await tx.party.create({
        data: {
          matterId: m.id,
          role: "CLIENT_PARTY",
          standing: intake.ourStanding,
          ordinal: 1,
          name: intake.client.name,
          partyType: clientTypeToPartyType(intake.client.type),
          idNumber: intake.client.type === "INDIVIDUAL" ? (decryptIdNumber(intake.client.idNumber) || null) : null,
          phone: intake.client.phone,
          address: intake.client.address,
          legalRep: intake.client.legalRep,
          contactName: intake.contactName,
          enterpriseSocialCode: intake.client.type === "INDIVIDUAL" ? null : (decryptIdNumber(intake.client.idNumber) || null),
          enterpriseName: intake.client.type === "INDIVIDUAL" ? null : intake.client.name,
          notes: "由收案委托方自动带入首程序"
        },
        select: { id: true }
      });
      procedurePartyRows.push({
        partyId: clientParty.id,
        standing: intake.ourStanding,
        ordinal: nextProcedurePartyOrdinal++
      });
    }

    for (const p of intake.parties) {
      const party = await tx.party.create({
        data: {
          matterId: m.id,
          role: p.role,
          standing: p.standing,
          ordinal: p.ordinal,
          name: p.name,
          partyType: p.partyType,
          idType: p.idType,
          idNumber: p.idNumber,
          phone: p.phone,
          address: p.address,
          legalRep: p.legalRep,
          contactName: p.contactName,
          enterpriseSocialCode: p.enterpriseSocialCode,
          enterpriseName: p.enterpriseName,
          notes: p.notes
        },
        select: { id: true }
      });
      if (p.standing) {
        procedurePartyRows.push({
          partyId: party.id,
          standing: p.standing,
          ordinal: nextProcedurePartyOrdinal++
        });
      }
    }

    const firstProcedure = await tx.matterProcedure.create({
      data: {
        matterId: m.id,
        type: firstProcedureType,
        engagement: "ENGAGED",
        order: 1,
        status: "IN_PROGRESS",
        handlingAgency: intake.firstAgency,
        // 程序级信息从收案带入首程序（原先丢失）
        jurisdiction: intake.jurisdiction,
        ourStanding: intake.ourStanding
      },
      select: { id: true }
    });

    if (procedurePartyRows.length > 0) {
      await tx.procedureParty.createMany({
        data: procedurePartyRows.map((row) => ({
          procedureId: firstProcedure.id,
          partyId: row.partyId,
          standing: row.standing,
          ordinal: row.ordinal
        })),
        skipDuplicates: true
      });
    }

    // 律师费 → Billing
    if (intake.feeAmount && intake.feeType) {
      const feeTypeLabel: Record<string, string> = {
        FIXED: "固定收费",
        CONTINGENCY: "风险代理"
      };
      await tx.billing.create({
        data: {
          matterId: m.id,
          title: `委托代理合同 - ${feeTypeLabel[intake.feeType] ?? intake.feeType}`,
          contractAmount: intake.feeAmount,
          schedule: intake.feeSchedule,
          status: "ACTIVE"
        }
      });
    }

    // 把 Intake 上传的合同回填 matterId（保留 intakeId 溯源），并归入首程序的第一个环节
    // （2026-09-16 用户确认：委托代理合同等收案材料应直接出现在「代理授权 / 委托手续」环节，而不是只在总览可见）
    if (intake.documents.length > 0) {
      const firstStageName = defaultStageNamesForProcedure(firstProcedureType)[0] ?? null;
      await tx.document.updateMany({
        where: { intakeId: intake.id },
        data: {
          matterId: m.id,
          procedureId: firstProcedure.id,
          ...(firstStageName ? { tags: { push: `阶段:${firstStageName}` } } : {})
        }
      });
    }

    await tx.intake.update({
      where: { id: intake.id },
      data: { status: "CONVERTED" }
    });

    await recordTimelineEvent(tx, {
        matterId: m.id,
        eventType: "MATTER_CREATED",
        title: `案件已创建（来自 Intake）`,
        occurredAt: new Date()
      });

    // v0.8: 默认卷宗
    await seedDefaultFolders(tx, m.id, intake.category);

    return m;
  });

  await audit({
    userId: session.user.id,
    action: "INTAKE_CONVERT",
    targetType: "Intake",
    targetId: intake.id,
    detail: { matterId: matter.id, internalCode }
  });

  revalidatePath("/intakes");
  revalidatePath("/approvals");
  revalidatePath(`/intakes/${intake.id}`);
  revalidatePath("/matters");
  return { ok: true, matterId: matter.id, internalCode };
}
