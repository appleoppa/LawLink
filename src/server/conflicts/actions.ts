"use server";
import { approvalTransaction } from "@/lib/approvals/service";
import { assertIntakeEditor, intakeState, intakeWorkflowReady, currentActor } from "@/server/intakes/workflow";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { matterAssociationFilter, intakeVisibilityFilter } from "@/lib/permissions";
import type { RoleGrant } from "@/lib/roles/catalog";
import { runConflictCheck, conflictHitKey, type IntakeInfoForHit, type MatterInfoForHit, type QueryItem } from "./algorithm";
import { ActionError } from "@/lib/action-error";

/** 收案对象级授权：正式检索与结论只能作用于自己可见的收案，防止向他人收案挂记录、改写他人结论 */
async function assertCanAccessIntake(userId: string, role: string, intakeId: string, grants?: RoleGrant[] | null) {
  const row = await prisma.intake.findFirst({
    where: { id: intakeId, ...intakeVisibilityFilter(userId, role, grants ?? undefined) },
    select: { id: true }
  });
  if (!row) throw new ActionError("收案不存在或无权访问");
}

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
  if (data.intakeId) {
    await assertCanAccessIntake(session.user.id, session.user.role, data.intakeId, session.user.rolePermissions);
  }

  // 清理 query（v0.4: 允许 name 为空，由 idNumber 兜底；role 缺省视为 OPPOSING_PARTY）
  const queries: QueryItem[] = data.queries.map((q) => ({
    role: q.role ?? "OPPOSING_PARTY",
    name: (q.name ?? "").trim(),
    idNumber: q.idNumber?.trim() || undefined
  }));

  const precheck = !data.intakeId;
  const {result,check}=await approvalTransaction(async db=>{
    await currentActor(db,session.user.id,'intakes.create');
    let subjectFingerprint:string|null=null;
    if(data.intakeId && await intakeWorkflowReady(db)){
      await assertIntakeEditor(db,session.user.id,data.intakeId,undefined,'intakes.create');
      const state=await intakeState(db,data.intakeId);queries.splice(0,queries.length,...state.queries);subjectFingerprint=state.subjectFingerprint;
    }
    const result=await runConflictCheck(queries,{excludeIntakeId:data.intakeId,db});
    const noHits=result.hits.length===0&&!precheck;
    const check=await db.conflictCheck.create({
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

    });
    if(subjectFingerprint)await db.$executeRaw`UPDATE "ConflictCheck" SET "subjectFingerprint"=${subjectFingerprint} WHERE id=${check.id}`;
    return {result,check};
  });
  const noHits=result.hits.length===0&&!precheck;
  const matterInfoByHit=new Map(result.hits.map(h=>[conflictHitKey(h),h.matterInfo]));
  const intakeInfoByHit=new Map(result.hits.map(h=>[conflictHitKey(h),h.intakeInfo]));
  const openableMatterIds=await getOpenableMatterIds(session.user.id,result.hits.filter(h=>h.targetType==='Matter').map(h=>h.targetId));

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
  if (!target) throw new ActionError("检索记录不存在");
  if (!target.intakeId) throw new ActionError("冲突预检仅供了解情况，不出检索结论；正式结论请在收案中给出");
  // 送审轮次已冻结结论（轮次只追加不覆盖）：PENDING_CONFIRMATION 期间改结论须先撤回
  await assertCanAccessIntake(session.user.id, session.user.role, target.intakeId, session.user.rolePermissions);

  const updated = await approvalTransaction(async roleDb => {
    await currentActor(roleDb,session.user.id,'intakes.create');
    if(await intakeWorkflowReady(roleDb)){
      await assertIntakeEditor(roleDb,session.user.id,target.intakeId!,['INTAKE','NEEDS_REVISION'],'intakes.create');
      const state=await intakeState(roleDb,target.intakeId!);
      const latest=await roleDb.conflictCheck.findFirst({where:{intakeId:target.intakeId},orderBy:{checkedAt:'desc'},select:{id:true}});
      const [meta]=await roleDb.$queryRaw<{subjectFingerprint:string|null}[]>`SELECT "subjectFingerprint" FROM "ConflictCheck" WHERE id=${data.checkId}`;
      if(latest?.id!==data.checkId||meta.subjectFingerprint!==state.subjectFingerprint)throw new ActionError('旧检索已失效，请重新检索');
      if(data.conclusion==='DIFFERENT'&&!data.note?.trim()&&await roleDb.conflictHit.count({where:{checkId:data.checkId}}))throw new ActionError('请填写排除冲突的复核理由');
    }
    return roleDb.conflictCheck.update({
    where: { id: data.checkId },
    data: {
      conclusion: data.conclusion,
      decidedById: session.user.id,
      decidedAt: new Date(),
      note: data.note || null
    },
    include: { intake: { select: { id: true } } }
  });
  });

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

