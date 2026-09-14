"use server";
import { roleMutation } from "@/lib/roles/service";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { matterAssociationFilter } from "@/lib/permissions";
import { runConflictCheck, conflictHitKey, type IntakeInfoForHit, type MatterInfoForHit, type QueryItem } from "./algorithm";

function serializeIntakeInfo(info: IntakeInfoForHit | null | undefined) {
  if (!info) return null;
  // 在办收案命中只披露名称、登记人、状态、登记日期与命中角色；不返回收案 ID
  const { intakeId: _intakeId, ...rest } = info;
  void _intakeId;
  return { ...rest, receivedAt: info.receivedAt.toISOString() };
}

function serializeMatterInfo(info: MatterInfoForHit | null | undefined, canViewMatter: boolean) {
  if (!info) return null;
  return {
    ...info,
    matterId: canViewMatter ? info.matterId : null,
    canViewMatter,
    intakeDate: info.intakeDate ? info.intakeDate.toISOString() : null
  };
}

async function getOpenableMatterIds(userId: string, matterIds: string[]) {
  const uniqueIds = Array.from(new Set(matterIds));
  if (uniqueIds.length === 0) return new Set<string>();

  const rows = await prisma.matter.findMany({
    where: {
      id: { in: uniqueIds },
      deletedAt: null,
      ...matterAssociationFilter(userId)
    },
    select: { id: true }
  });

  return new Set(rows.map((row) => row.id));
}

const queryItemSchema = z
  .object({
    // v0.4: 角色可选（顶栏快查不需要），server 端默认 OPPOSING_PARTY
    role: z
      .enum([
        "CLIENT_PARTY",
        "OPPOSING_PARTY",
        "THIRD_PARTY",
        "CO_LITIGANT",
        "AGENT",
        "WITNESS",
        "OTHER"
      ])
      .optional(),
    name: z.string().max(120).optional().or(z.literal("")),
    idNumber: z.string().max(50).optional().or(z.literal(""))
  })
  .refine((q) => (q.name && q.name.trim()) || (q.idNumber && q.idNumber.trim()), {
    message: "姓名或证件号至少填写一项"
  });

const runCheckSchema = z.object({
  intakeId: z.string().cuid().optional(),
  queries: z.array(queryItemSchema).min(1)
}).superRefine((data, ctx) => {
  if (data.intakeId) data.queries.forEach((query, index) => {
    if (!query.role) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["queries", index, "role"], message: "收案检索必须包含当事人身份，请从收案页面重新检索" });
  });
});

/**
 * 跑一次冲突检索并落库。
 * - 带 intakeId：收案正式检索，挂在该收案上；未命中时系统自动给出「未命中」结论，供审批与转案件把关。
 * - 不带 intakeId：工作区「冲突预检」，律师自行了解本所记录。只留存检索记录与审计，
 *   不出任何结论（conclusion 恒为 PENDING），也不能被收案引用（2026-09-14 用户确认）。
 */
export async function runCheckAndSave(input: z.infer<typeof runCheckSchema>) {
  const session = await requireSession("intakes.create");
  const data = runCheckSchema.parse(input);

  // 清理 query（v0.4: 允许 name 为空，由 idNumber 兜底；role 缺省视为 OPPOSING_PARTY）
  const queries: QueryItem[] = data.queries.map((q) => ({
    role: q.role ?? "OPPOSING_PARTY",
    name: (q.name ?? "").trim(),
    idNumber: q.idNumber?.trim() || undefined
  }));

  const result = await runConflictCheck(queries, { excludeIntakeId: data.intakeId });
  const precheck = !data.intakeId;
  const noHits = result.hits.length === 0 && !precheck;
  const matterInfoByHit = new Map(result.hits.map((h) => [conflictHitKey(h), h.matterInfo]));
  const intakeInfoByHit = new Map(result.hits.map((h) => [conflictHitKey(h), h.intakeInfo]));
  const openableMatterIds = await getOpenableMatterIds(
    session.user.id,
    result.hits.filter((h) => h.targetType === "Matter").map((h) => h.targetId)
  );

  const check = await roleMutation(session.user, "intakes.create", async roleDb => roleDb.conflictCheck.create({
    data: {
      intakeId: data.intakeId,
      queryPayload: {
        queries,
        sameNameClients: result.sameNameClients,
        idMatchedClients: result.idMatchedClients
      } as object,
      conclusion: noHits ? "DIFFERENT" : "PENDING",
      decidedById: noHits ? session.user.id : null,
      decidedAt: noHits ? new Date() : null,
      note: noHits ? "系统自动标记：未命中历史案件冲突。" : null,
      hits: {
        create: result.hits.map((h) => ({
          hitType: h.hitType,
          targetType: h.targetType,
          targetId: h.targetId,
          matchedName: h.matchedName,
          matchedField: h.matchedField,
          matchedValue: h.matchedValue,
          matchedRatio: h.matchedRatio,
          severity: h.severity,
          reason: h.reason
        }))
      }
    },
    include: { hits: true }
  }));

  await audit({
    userId: session.user.id,
    action: "CONFLICT_CHECK_RUN",
    targetType: "ConflictCheck",
    targetId: check.id,
    detail: {
      intakeId: data.intakeId,
      kind: precheck ? "PRECHECK" : "INTAKE",
      hitCount: result.hits.length,
      sameNameClientCount: result.sameNameClients.length,
      autoConclusion: precheck ? null : noHits ? "DIFFERENT" : "PENDING"
    }
  });

  if (data.intakeId) {
    revalidatePath(`/intakes/${data.intakeId}`);
  }
  return {
    ok: true,
    checkId: check.id,
    hits: check.hits.map((h) => {
      const canViewMatter = h.targetType === "Matter" && openableMatterIds.has(h.targetId);
      return {
        ...h,
        targetId: h.targetType === "Matter" && canViewMatter ? h.targetId : "",
        matterInfo: serializeMatterInfo(matterInfoByHit.get(conflictHitKey(h)), canViewMatter),
        intakeInfo: serializeIntakeInfo(intakeInfoByHit.get(conflictHitKey(h)))
      };
    }),
    sameNameClients: result.sameNameClients,
    idMatchedClients: result.idMatchedClients
  };
}

const conclusionSchema = z.object({
  checkId: z.string().cuid(),
  conclusion: z.enum(["PENDING", "SAME_SUBJECT", "DIFFERENT", "NEED_INFO"]),
  note: z.string().max(500).optional().or(z.literal(""))
});

export async function setConflictConclusion(input: z.infer<typeof conclusionSchema>) {
  const session = await requireSession("intakes.create");
  const data = conclusionSchema.parse(input);
  const target = await prisma.conflictCheck.findUnique({ where: { id: data.checkId }, select: { intakeId: true } });
  if (!target) throw new Error("检索记录不存在");
  if (!target.intakeId) throw new Error("冲突预检仅供了解情况，不出检索结论；正式结论请在收案中给出");

  const updated = await roleMutation(session.user, "intakes.create", async roleDb => roleDb.conflictCheck.update({
    where: { id: data.checkId },
    data: {
      conclusion: data.conclusion,
      decidedById: session.user.id,
      decidedAt: new Date(),
      note: data.note || null
    },
    include: { intake: { select: { id: true } } }
  }));

  await audit({
    userId: session.user.id,
    action: "CONFLICT_CONCLUSION_SET",
    targetType: "ConflictCheck",
    targetId: updated.id,
    detail: { conclusion: data.conclusion }
  });

  if (updated.intake) {
    revalidatePath(`/intakes/${updated.intake.id}`);
  }
  return { ok: true };
}

/**
 * 工作区「既往预检记录」：仅列当前账号本人发起、未挂收案的预检（以 CONFLICT_CHECK_RUN 审计为准），
 * 不跨人展示他人检索的主体名称——检索对象本身可能是尚未签约的潜在客户。
 */
export async function listMyRecentConflictChecks(limit = 8) {
  const session = await requireSession("intakes.create");
  const logs = await prisma.auditLog.findMany({
    where: { userId: session.user.id, action: "CONFLICT_CHECK_RUN", targetType: "ConflictCheck" },
    orderBy: { createdAt: "desc" },
    take: limit * 4,
    select: { targetId: true }
  });
  const ids = logs.map((l) => l.targetId).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];
  const checks = await prisma.conflictCheck.findMany({
    where: { id: { in: ids }, intakeId: null },
    select: {
      id: true,
      checkedAt: true,
      conclusion: true,
      queryPayload: true,
      intake: { select: { id: true, title: true } },
      _count: { select: { hits: true } }
    }
  });
  const byId = new Map(checks.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, limit)
    .map((c) => {
      const payload = (c.queryPayload ?? {}) as { queries?: { name?: string }[] };
      const names = (payload.queries ?? []).map((q) => q.name ?? "").filter(Boolean);
      return {
        id: c.id,
        checkedAt: c.checkedAt.toISOString(),
        conclusion: c.conclusion,
        hitCount: c._count.hits,
        intake: c.intake,
        subjectSummary: names.slice(0, 2).join("、") + (names.length > 2 ? ` 等 ${names.length} 个主体` : ""),
        runnerName: session.user.name ?? ""
      };
    });
}
