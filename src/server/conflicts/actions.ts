"use server";
import { roleMutation } from "@/lib/roles/service";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { matterAssociationFilter } from "@/lib/permissions";
import { runConflictCheck, conflictHitKey, type MatterInfoForHit, type QueryItem } from "./algorithm";

function serializeMatterInfo(info: MatterInfoForHit | undefined, canViewMatter: boolean) {
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
 * 如果 intakeId 在，则把 ConflictCheck 挂在该 Intake 上；否则单独存（targetType=Intake 为空）。
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

  const result = await runConflictCheck(queries);
  const noHits = result.hits.length === 0;
  const matterInfoByHit = new Map(result.hits.map((h) => [conflictHitKey(h), h.matterInfo]));
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
      hitCount: result.hits.length,
      sameNameClientCount: result.sameNameClients.length,
      autoConclusion: noHits ? "DIFFERENT" : "PENDING"
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
        targetId: h.targetType === "Matter" && !canViewMatter ? "" : h.targetId,
        matterInfo: serializeMatterInfo(matterInfoByHit.get(conflictHitKey(h)), canViewMatter)
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
