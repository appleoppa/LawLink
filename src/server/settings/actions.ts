"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ProcedureType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";

const stepSchema = z.object({
  name: z.string().min(1).max(40),
  order: z.number().int().min(1).max(50),
  defaultTasks: z.array(z.string().max(120)).default([])
});

const templateUpdateSchema = z.object({
  procedureType: z.string(),
  name: z.string().min(1).max(40),
  steps: z.array(stepSchema).min(1)
});

export type StepInput = z.infer<typeof stepSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

export async function listStageTemplates() {
  await requireSystemAdmin();
  return prisma.stageTemplate.findMany({
    orderBy: { procedureType: "asc" }
  });
}

export async function upsertStageTemplate(input: TemplateUpdateInput) {
  const session = await requireSystemAdmin();
  const data = templateUpdateSchema.parse(input);
  const id = `default-${data.procedureType}`;

  await prisma.stageTemplate.upsert({
    where: { id },
    update: {
      name: data.name,
      steps: data.steps as unknown as object
    },
    create: {
      id,
      procedureType: data.procedureType as ProcedureType,
      name: data.name,
      isDefault: true,
      steps: data.steps as unknown as object
    }
  });

  await audit({
    userId: session.user.id,
    action: "STAGE_TEMPLATE_UPDATE",
    targetType: "StageTemplate",
    targetId: id,
    detail: { procedureType: data.procedureType, stepCount: data.steps.length }
  });

  revalidatePath("/admin/templates");
  revalidatePath("/admin/templates");
  return { ok: true };
}

const auditQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().cuid().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export async function listAuditLogs(input: Partial<AuditQuery> = {}) {
  await requireSystemAdmin();
  const query = auditQuerySchema.parse(input);
  const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: since },
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
    ...(query.userId ? { userId: query.userId } : {})
  };

  const [items, distinctActions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: { user: { select: { id: true, name: true } } }
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: since } },
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
      take: 200
    })
  ]);

  return { items, distinctActions: distinctActions.map((a) => a.action) };
}
