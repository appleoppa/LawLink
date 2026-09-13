"use server";
import { roleMutation } from "@/lib/roles/service";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAssociateMatter } from "@/lib/permissions";
import { matterHrefById, revalidateMatter } from "@/server/matters/route";

const taskCreateSchema = z.object({
  matterId: z.string().cuid(),
  title: z.string().min(1, "事项标题必填").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  assigneeId: z.string().cuid().optional().or(z.literal("")),
  dueAt: z.coerce.date().optional(),
  priority: z.coerce.number().int().min(0).max(2).default(0),
  stageId: z.string().cuid().optional().or(z.literal(""))
});

const taskUpdateSchema = taskCreateSchema.extend({
  id: z.string().cuid()
});

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

async function assertTaskStage(matterId: string, stageId?: string) {
  if (!stageId) return;
  const stage = await prisma.matterStage.findFirst({
    where: { id: stageId, procedure: { matterId } },
    select: { id: true }
  });
  if (!stage) throw new Error("阶段不存在或不属于当前案件");
}

export async function createTask(input: TaskCreateInput) {
  const session = await requireSession("schedule.write");
  const data = taskCreateSchema.parse(input);
  await assertCanAssociateMatter(session.user.id, data.matterId);
  await assertMatterWritable(data.matterId);
  await assertTaskStage(data.matterId, data.stageId);

  const created = await roleMutation(session.user, "schedule.write", async roleDb => roleDb.task.create({
    data: {
      matterId: data.matterId,
      title: data.title,
      description: data.description || null,
      assigneeId: data.assigneeId || null,
      dueAt: data.dueAt,
      priority: data.priority,
      stageId: data.stageId || null
    }
  }));

  await audit({
    userId: session.user.id,
    action: "TASK_CREATE",
    targetType: "Task",
    targetId: created.id,
    detail: { matterId: data.matterId, title: created.title }
  });

  // v0.43 项4：写入案件动态时间线
  await roleMutation(session.user, "schedule.write", async roleDb => roleDb.timelineEvent.create({
    data: {
      matterId: data.matterId,
      eventType: "TASK_ADDED",
      title: `新增事项：${created.title}`,
      occurredAt: new Date(),
      refType: "Task",
      refId: created.id
    }
  }));

  // 通知被指派人（非创建者本人时）
  if (data.assigneeId && data.assigneeId !== session.user.id) {
    await createNotification({
      userId: data.assigneeId,
      type: "TASK_ASSIGNED",
      title: "您有新事项",
      content: `事项「${created.title}」已指派给您`,
      href: await matterHrefById(data.matterId),
      refType: "Task",
      refId: created.id
    });
  }

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function updateTask(input: TaskUpdateInput) {
  const session = await requireSession("schedule.write");
  const data = taskUpdateSchema.parse(input);
  const current = await prisma.task.findUnique({
    where: { id: data.id },
    select: { matterId: true }
  });
  if (!current || current.matterId !== data.matterId) throw new Error("事项不存在或不属于当前案件");
  await assertCanAssociateMatter(session.user.id, current.matterId);
  await assertMatterWritable(current.matterId);
  await assertTaskStage(current.matterId, data.stageId);
  const { id, matterId, ...rest } = data;

  await roleMutation(session.user, "schedule.write", async roleDb => roleDb.task.update({
    where: { id, matterId: current.matterId },
    data: {
      title: rest.title,
      description: rest.description || null,
      assigneeId: rest.assigneeId || null,
      dueAt: rest.dueAt,
      priority: rest.priority,
      stageId: rest.stageId || null
    }
  }));

  await audit({
    userId: session.user.id,
    action: "TASK_UPDATE",
    targetType: "Task",
    targetId: id
  });

  await revalidateMatter(matterId);
  return { ok: true };
}

export async function toggleTaskCompleted(id: string) {
  const session = await requireSession("schedule.write");
  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) return { ok: false };
  await assertCanAssociateMatter(session.user.id, current.matterId);
  await assertMatterWritable(current.matterId);

  const next = !current.completed;
  await roleMutation(session.user, "schedule.write", async roleDb => roleDb.task.update({
    where: { id },
    data: {
      completed: next,
      completedAt: next ? new Date() : null
    }
  }));

  await audit({
    userId: session.user.id,
    action: next ? "TASK_COMPLETE" : "TASK_REOPEN",
    targetType: "Task",
    targetId: id
  });

  await revalidateMatter(current.matterId);
  return { ok: true };
}

export async function deleteTask(id: string) {
  const session = await requireSession("schedule.write");
  const current = await prisma.task.findUnique({ where: { id } });
  if (!current) return { ok: false };
  await assertCanAssociateMatter(session.user.id, current.matterId);
  await assertMatterWritable(current.matterId);

  await roleMutation(session.user, "schedule.write", async roleDb => roleDb.task.delete({ where: { id } }));

  await audit({
    userId: session.user.id,
    action: "TASK_DELETE",
    targetType: "Task",
    targetId: id
  });

  await revalidateMatter(current.matterId);
  return { ok: true };
}
