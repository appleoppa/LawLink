"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAccessMatter, assertCanAssociateMatter, assertCanLeadMatter } from "@/lib/permissions";
import { assertAgencyAllowedForProcedure, normalizeJurisdictionForAgency } from "@/lib/china-regions";
import {
  defaultStageNamesForProcedure,
  normalizeProcedureStageName,
  stagePresetForName
} from "@/lib/procedure-stage-defaults";
import {
  procedureCreateSchema,
  procedureUpdateSchema,
  procedureStageCreateSchema,
  procedureStageRemoveSchema,
  deadlineCreateSchema,
  hearingCreateSchema,
  type ProcedureCreateInput,
  type ProcedureUpdateInput,
  type ProcedureStageCreateInput,
  type ProcedureStageRemoveInput,
  type DeadlineCreateInput,
  type HearingCreateInput
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" ? null : v;
  }
  return out as T;
}

// ============ Procedure ============

export async function addProcedure(input: ProcedureCreateInput) {
  const session = await requireSession();
  const data = procedureCreateSchema.parse(input);
  await assertCanAccessMatter(session.user.id, session.user.role, data.matterId);
  await assertMatterWritable(data.matterId);
  assertAgencyAllowedForProcedure(data.handlingAgency, data.type);

  const lastOrder = await prisma.matterProcedure.findFirst({
    where: { matterId: data.matterId },
    orderBy: { order: "desc" },
    select: { order: true }
  });

  const created = await prisma.matterProcedure.create({
    data: {
      matterId: data.matterId,
      type: data.type,
      customLabel: data.customLabel || null,
      engagement: data.engagement,
      order: (lastOrder?.order ?? 0) + 1,
      caseNumber: data.caseNumber || null,
      jurisdiction: normalizeJurisdictionForAgency(data.handlingAgency, data.jurisdiction),
      handlingAgency: data.handlingAgency || null,
      panel: data.panel || null,
      handler: data.handler || null,
      acceptedAt: data.acceptedAt,
      leadLawyerId: data.isExternalLead ? null : (data.leadLawyerId || null),
      isExternalLead: data.isExternalLead,
      status: data.engagement === "INFORMATIONAL" ? "CONCLUDED" : "IN_PROGRESS"
    }
  });

  await prisma.timelineEvent.create({
    data: {
      matterId: data.matterId,
      eventType: "PROCEDURE_ADDED",
      title: `新增程序：${created.customLabel ?? created.type}`,
      occurredAt: new Date(),
      refType: "MatterProcedure",
      refId: created.id
    }
  });

  await audit({
    userId: session.user.id,
    action: "PROCEDURE_CREATE",
    targetType: "MatterProcedure",
    targetId: created.id,
    detail: { matterId: data.matterId, type: data.type }
  });

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function updateProcedure(input: ProcedureUpdateInput) {
  const session = await requireSession();
  const data = procedureUpdateSchema.parse(input);
  const { id, ...rest } = data;

  const existing = await prisma.matterProcedure.findUnique({
    where: { id },
    select: { matterId: true, type: true, jurisdiction: true, handlingAgency: true }
  });
  if (!existing) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, existing.matterId);
  await assertMatterWritable(existing.matterId);
  assertAgencyAllowedForProcedure(rest.handlingAgency ?? existing.handlingAgency, rest.type ?? existing.type);

  const normalizedRest = {
    ...rest
  };
  if (rest.jurisdiction !== undefined || rest.handlingAgency !== undefined) {
    normalizedRest.jurisdiction = normalizeJurisdictionForAgency(
      rest.handlingAgency ?? existing.handlingAgency,
      rest.jurisdiction ?? existing.jurisdiction
    ) ?? "";
  }

  const updated = await prisma.matterProcedure.update({
    where: { id },
    data: emptyToNull(normalizedRest)
  });

  await audit({
    userId: session.user.id,
    action: "PROCEDURE_UPDATE",
    targetType: "MatterProcedure",
    targetId: id
  });

  await revalidateMatter(updated.matterId);
  return { ok: true };
}

export async function deleteProcedure(id: string) {
  const session = await requireSession();
  const procedure = await prisma.matterProcedure.findUnique({ where: { id } });
  if (!procedure) return { ok: false };

  await assertCanAccessMatter(session.user.id, session.user.role, procedure.matterId);
  await assertMatterWritable(procedure.matterId);
  await assertCanLeadMatter(session.user.id, procedure.matterId, "仅案件主办/协办可以删除程序");

  await prisma.matterProcedure.delete({ where: { id } });
  await audit({
    userId: session.user.id,
    action: "PROCEDURE_DELETE",
    targetType: "MatterProcedure",
    targetId: id,
    detail: { matterId: procedure.matterId }
  });

  await revalidateMatter(procedure.matterId);
  return { ok: true };
}

// ============ Procedure Stage ============

async function materializeProcedureStage(
  input: ProcedureStageCreateInput,
  options: { allowExisting: boolean }
) {
  const session = await requireSession();
  const data = procedureStageCreateSchema.parse(input);

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true, type: true }
  });
  if (!procedure) throw new Error("程序不存在");

  await assertCanAssociateMatter(session.user.id, procedure.matterId);
  await assertMatterWritable(procedure.matterId);

  const targetName = data.name.trim();
  const normalizedTarget = normalizeProcedureStageName(targetName);
  const result = await prisma.$transaction(async (tx) => {
    const existingStages = await tx.matterStage.findMany({
      where: { procedureId: data.procedureId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, order: true, status: true }
    });
    const existing = existingStages.find((stage) => normalizeProcedureStageName(stage.name) === normalizedTarget);

    if (existing) {
      // v0.48: 隐藏的环节重新添加时恢复为 ACTIVE（数据未删，直接复用）
      if (existing.status === "HIDDEN") {
        const revived = await tx.matterStage.update({
          where: { id: existing.id },
          data: { status: "ACTIVE" },
          select: { id: true, name: true, order: true }
        });
        return { stage: revived, created: false, revived: true, materializedCount: 0 };
      }
      if (options.allowExisting) {
        return { stage: existing, created: false, revived: false, materializedCount: 0 };
      }
      throw new Error("该环节已存在");
    }

    if (existingStages.length === 0) {
      const names = [...defaultStageNamesForProcedure(procedure.type)];
      if (!names.some((name) => normalizeProcedureStageName(name) === normalizedTarget)) {
        const insertionIndex = insertionIndexForNames(names, data);
        names.splice(insertionIndex, 0, targetName);
      }

      let targetStage: { id: string; name: string; order: number } | null = null;
      let order = 0;
      for (const name of names) {
        order += 1;
        const created = await tx.matterStage.create({
          data: {
            procedureId: data.procedureId,
            name,
            description: normalizeProcedureStageName(name) === normalizedTarget ? data.description || null : null,
            order
          },
          select: { id: true, name: true, order: true }
        });
        if (normalizeProcedureStageName(name) === normalizedTarget) {
          targetStage = created;
        }
      }

      if (!targetStage) throw new Error("环节创建失败");
      return { stage: targetStage, created: true, revived: false, materializedCount: names.length };
    }

    const insertOrder = nextStageOrder(existingStages, data);
    await tx.matterStage.updateMany({
      where: { procedureId: data.procedureId, order: { gte: insertOrder } },
      data: { order: { increment: 1 } }
    });

    const created = await tx.matterStage.create({
      data: {
        procedureId: data.procedureId,
        name: targetName,
        description: data.description || null,
        order: insertOrder
      },
      select: { id: true, name: true, order: true }
    });
    return { stage: created, created: true, revived: false, materializedCount: 1 };
  });

  if (result.created || result.revived) {
    await prisma.timelineEvent.create({
      data: {
        matterId: procedure.matterId,
        eventType: "STAGE_ADDED",
        title: result.revived ? `恢复环节：${result.stage.name}` : `新增环节：${result.stage.name}`,
        occurredAt: new Date(),
        refType: "MatterStage",
        refId: result.stage.id
      }
    });

    await audit({
      userId: session.user.id,
      action: "MATTER_STAGE_CREATE",
      targetType: "MatterStage",
      targetId: result.stage.id,
      detail: {
        matterId: procedure.matterId,
        procedureId: data.procedureId,
        materializedCount: result.materializedCount
      }
    });

    await revalidateMatter(procedure.matterId);
  }

  return { ok: true, id: result.stage.id, created: result.created };
}

export async function createProcedureStage(input: ProcedureStageCreateInput) {
  return materializeProcedureStage(input, { allowExisting: false });
}

export async function ensureProcedureStage(input: ProcedureStageCreateInput) {
  return materializeProcedureStage(input, { allowExisting: true });
}

function insertionIndexForNames(names: string[], data: ProcedureStageCreateInput) {
  if (data.insertPosition === "START") return 0;
  if (data.insertPosition !== "AFTER") return names.length;
  const afterName = data.insertAfterStageName?.trim();
  if (!afterName) return names.length;
  const normalizedAfterName = normalizeProcedureStageName(afterName);
  const afterIndex = names.findIndex((name) => normalizeProcedureStageName(name) === normalizedAfterName);
  return afterIndex >= 0 ? afterIndex + 1 : names.length;
}

function nextStageOrder(
  stages: { id: string; name: string; order: number; status?: string }[],
  data: ProcedureStageCreateInput
) {
  if (data.insertPosition === "START") return 1;
  if (data.insertPosition === "AFTER") {
    const afterStage = data.insertAfterStageId
      ? stages.find((stage) => stage.id === data.insertAfterStageId)
      : stages.find(
          (stage) =>
            data.insertAfterStageName &&
            normalizeProcedureStageName(stage.name) === normalizeProcedureStageName(data.insertAfterStageName)
        );
    if (afterStage) return afterStage.order + 1;
  }
  return (stages[stages.length - 1]?.order ?? 0) + 1;
}

export async function removeProcedureStage(input: ProcedureStageRemoveInput) {
  const session = await requireSession();
  const data = procedureStageRemoveSchema.parse(input);

  const stage = await prisma.matterStage.findUnique({
    where: { id: data.id },
    include: {
      procedure: { select: { matterId: true, type: true } },
      _count: { select: { tasks: true } }
    }
  });
  if (!stage) return { ok: false };

  await assertCanAssociateMatter(session.user.id, stage.procedure.matterId);
  await assertMatterWritable(stage.procedure.matterId);

  const preset = stagePresetForName(stage.procedure.type, stage.name);
  if (preset?.kind === "required") {
    throw new Error("必备环节不能移除");
  }

  // v0.48: 关联材料按 stageId 外键统计（标签仅作展示），环节改名不再影响判定
  const linkedDocuments = await prisma.document.count({
    where: { stageId: stage.id, deletedAt: null }
  });
  const preservationRecords = stage.name.includes("保全")
    ? await prisma.preservationCase.count({ where: { matterId: stage.procedure.matterId } })
    : 0;
  const hasContent = stage._count.tasks > 0 || linkedDocuments > 0 || preservationRecords > 0;

  if (hasContent) {
    // 有任务/材料/专项记录：置 HIDDEN 保留数据，重新添加同名环节时可恢复
    await prisma.$transaction(async (tx) => {
      await tx.matterStage.update({
        where: { id: stage.id },
        data: { status: "HIDDEN" }
      });
      await tx.timelineEvent.create({
        data: {
          matterId: stage.procedure.matterId,
          eventType: "STAGE_REMOVED",
          title: `隐藏环节：${stage.name}（数据保留）`,
          occurredAt: new Date(),
          refType: "MatterStage",
          refId: stage.id
        }
      });
    });

    await audit({
      userId: session.user.id,
      action: "MATTER_STAGE_HIDE",
      targetType: "MatterStage",
      targetId: stage.id,
      detail: {
        matterId: stage.procedure.matterId,
        procedureId: stage.procedureId,
        tasks: stage._count.tasks,
        documents: linkedDocuments,
        preservationRecords
      }
    });

    await revalidateMatter(stage.procedure.matterId);
    return { ok: true, hidden: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.matterStage.delete({ where: { id: stage.id } });
    await tx.matterStage.updateMany({
      where: { procedureId: stage.procedureId, order: { gt: stage.order } },
      data: { order: { decrement: 1 } }
    });
    await tx.timelineEvent.create({
      data: {
        matterId: stage.procedure.matterId,
        eventType: "STAGE_REMOVED",
        title: `移除环节：${stage.name}`,
        occurredAt: new Date(),
        refType: "MatterStage",
        refId: stage.id
      }
    });
  });

  await audit({
    userId: session.user.id,
    action: "MATTER_STAGE_REMOVE",
    targetType: "MatterStage",
    targetId: stage.id,
    detail: { matterId: stage.procedure.matterId, procedureId: stage.procedureId }
  });

  await revalidateMatter(stage.procedure.matterId);
  return { ok: true, hidden: false };
}

// ============ Deadline ============

export async function addDeadline(input: DeadlineCreateInput) {
  const session = await requireSession();
  const data = deadlineCreateSchema.parse(input);

  const procedureForGuard = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });
  if (!procedureForGuard) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, procedureForGuard.matterId);
  await assertMatterWritable(procedureForGuard.matterId);

  const created = await prisma.deadline.create({
    data: {
      procedureId: data.procedureId,
      title: data.title,
      category: data.category,
      dueAt: data.dueAt,
      basis: data.basis || null,
      remindDays: data.remindDays
    }
  });

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });

  if (procedure) {
    await audit({
      userId: session.user.id,
      action: "DEADLINE_CREATE",
      targetType: "Deadline",
      targetId: created.id,
      detail: { matterId: procedure.matterId, procedureId: data.procedureId }
    });
    // v0.43 项4：写入案件动态时间线
    await prisma.timelineEvent.create({
      data: {
        matterId: procedure.matterId,
        eventType: "DEADLINE_ADDED",
        title: `新增期限：${data.title}`,
        occurredAt: new Date(),
        refType: "Deadline",
        refId: created.id
      }
    });
    await revalidateMatter(procedure.matterId);
  }

  return { ok: true, id: created.id };
}

export async function toggleDeadlineCompleted(id: string) {
  const session = await requireSession();
  const current = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanAccessMatter(session.user.id, session.user.role, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  const next = !current.completed;
  await prisma.deadline.update({
    where: { id },
    data: {
      completed: next,
      completedAt: next ? new Date() : null
    }
  });

  await audit({
    userId: session.user.id,
    action: next ? "DEADLINE_COMPLETE" : "DEADLINE_REOPEN",
    targetType: "Deadline",
    targetId: id
  });

  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

export async function deleteDeadline(id: string) {
  const session = await requireSession();
  const current = await prisma.deadline.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanAccessMatter(session.user.id, session.user.role, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  await prisma.deadline.delete({ where: { id } });
  await audit({
    userId: session.user.id,
    action: "DEADLINE_DELETE",
    targetType: "Deadline",
    targetId: id
  });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

// ============ Hearing ============

export async function addHearing(input: HearingCreateInput) {
  const session = await requireSession();
  const data = hearingCreateSchema.parse(input);

  const procedureForGuard = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });
  if (!procedureForGuard) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, procedureForGuard.matterId);
  await assertMatterWritable(procedureForGuard.matterId);

  const created = await prisma.hearing.create({
    data: {
      procedureId: data.procedureId,
      title: data.title,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      room: data.room || null,
      address: data.address || null,
      judge: data.judge || null,
      contact: data.contact || null,
      notes: data.notes || null
    }
  });

  const procedure = await prisma.matterProcedure.findUnique({
    where: { id: data.procedureId },
    select: { matterId: true }
  });

  if (procedure) {
    await prisma.timelineEvent.create({
      data: {
        matterId: procedure.matterId,
        eventType: "HEARING_SCHEDULED",
        title: `开庭：${data.title}`,
        occurredAt: data.startsAt,
        refType: "Hearing",
        refId: created.id
      }
    });

    await audit({
      userId: session.user.id,
      action: "HEARING_CREATE",
      targetType: "Hearing",
      targetId: created.id,
      detail: { matterId: procedure.matterId, procedureId: data.procedureId }
    });
    await revalidateMatter(procedure.matterId);
  }

  return { ok: true, id: created.id };
}

export async function deleteHearing(id: string) {
  const session = await requireSession();
  const current = await prisma.hearing.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanAccessMatter(session.user.id, session.user.role, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  await prisma.hearing.delete({ where: { id } });
  await audit({
    userId: session.user.id,
    action: "HEARING_DELETE",
    targetType: "Hearing",
    targetId: id
  });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

// ============ ProcedureMemo（v0.42 备忘录）============

export async function addProcedureMemo(input: {
  procedureId: string;
  content: string;
}) {
  const session = await requireSession();
  const content = input.content.trim();
  if (!content) throw new Error("备忘内容不能为空");
  if (content.length > 1000) throw new Error("备忘内容过长（≤1000字）");

  const proc = await prisma.matterProcedure.findUnique({
    where: { id: input.procedureId },
    select: { matterId: true }
  });
  if (!proc) throw new Error("程序不存在");
  await assertCanAccessMatter(session.user.id, session.user.role, proc.matterId);
  await assertMatterWritable(proc.matterId);

  const created = await prisma.procedureMemo.create({
    data: {
      procedureId: input.procedureId,
      content,
      createdById: session.user.id
    }
  });
  await revalidateMatter(proc.matterId);
  return { ok: true, id: created.id };
}

export async function toggleProcedureMemo(id: string) {
  const session = await requireSession();
  const current = await prisma.procedureMemo.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanAccessMatter(session.user.id, session.user.role, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  const next = !current.done;
  await prisma.procedureMemo.update({
    where: { id },
    data: { done: next, doneAt: next ? new Date() : null }
  });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}

export async function deleteProcedureMemo(id: string) {
  const session = await requireSession();
  const current = await prisma.procedureMemo.findUnique({
    where: { id },
    include: { procedure: { select: { matterId: true } } }
  });
  if (!current) return { ok: false };
  await assertCanAccessMatter(session.user.id, session.user.role, current.procedure.matterId);
  await assertMatterWritable(current.procedure.matterId);

  await prisma.procedureMemo.delete({ where: { id } });
  await revalidateMatter(current.procedure.matterId);
  return { ok: true };
}
