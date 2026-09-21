"use server";
import {approvalTransaction} from "@/lib/approvals/service";
import {changeWorkTx,readWorkRows,responsibilityReady} from "@/server/reminders/responsibility";
import { roleMutation } from "@/lib/roles/service";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { createNotification } from "@/server/notifications/create";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAssociateMatter } from "@/lib/permissions";
import { matterHrefById, revalidateMatter } from "@/server/matters/route";
import { recordTimelineEvent } from "@/server/timeline/record";

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
  await roleMutation(session.user, "schedule.write", async roleDb => recordTimelineEvent(roleDb, {
      matterId: data.matterId,
      eventType: "TASK_ADDED",
      title: `新增事项：${created.title}`,
      occurredAt: new Date(),
      refType: "Task",
      refId: created.id
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
    select: { matterId: true, assigneeId: true }
  });
  if (!current || current.matterId !== data.matterId) throw new Error("事项不存在或不属于当前案件");
  await assertCanAssociateMatter(session.user.id, current.matterId);
  await assertMatterWritable(current.matterId);
  await assertTaskStage(current.matterId, data.stageId);
  if(await responsibilityReady(prisma)&&data.assigneeId!==current.assigneeId)throw new Error("变更责任人请从事项责任面板发起交接，接收后生效");
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

  if(await responsibilityReady(prisma)){
    if(current.completed)throw new Error("重新办理请从事项责任面板填写原因");
    await approvalTransaction(async db=>{const w=(await readWorkRows(db)).find(w=>w.kind==='Task'&&w.targetId===id);if(!w)throw new Error('事项责任缺失');await changeWorkTx(db,session.user.id,{id:w.id,revision:w.revision,action:'COMPLETE',reason:'经办通过完成操作确认已办结'});});
    await revalidateMatter(current.matterId);return {ok:true};
  }
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

/**
 * M-3b（2026-09-20 D 批）：批量人工办结低风险运营任务。仅 Task 类型（期限/开庭/保全天然
 * 不经此入口），逐项走与单条完成相同的责任链（COMPLETE + 原因），必须填写统一处置结果；
 * 单条失败不阻断其余，结果逐条返回。
 */
export async function completeTasksBatch(input: { ids: string[]; reason: string }) {
  const session = await requireSession("schedule.write");
  const reason = input.reason.trim();
  if (!reason) throw new Error("请填写批量办结的统一处置结果或原因");
  if (!input.ids.length) throw new Error("请先选择要办结的任务");
  // 2026-09-20 P3 修复：超过单批上限直接报错引导分批（此前静默截断到 100，被丢条目无提示）
  if (input.ids.length > 100) throw new Error(`单次批量办结最多 100 条（已选 ${input.ids.length} 条），请分批处理`);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of input.ids) {
    try {
      const current = await prisma.task.findUnique({ where: { id } });
      if (!current) throw new Error("任务不存在");
      if (current.completed) { results.push({ id, ok: true }); continue; }
      await assertCanAssociateMatter(session.user.id, current.matterId);
      await assertMatterWritable(current.matterId);
      if (await responsibilityReady(prisma)) {
        await approvalTransaction(async db => {
          const w = (await readWorkRows(db)).find(w => w.kind === "Task" && w.targetId === id);
          if (!w) throw new Error("事项责任缺失");
          await changeWorkTx(db, session.user.id, { id: w.id, revision: w.revision, action: "COMPLETE", reason });
        });
      } else {
        await roleMutation(session.user, "schedule.write", async roleDb => roleDb.task.update({
          where: { id },
          data: { completed: true, completedAt: new Date() }
        }));
      }
      await audit({ userId: session.user.id, action: "TASK_COMPLETE", targetType: "Task", targetId: id, detail: { batch: true, reason } });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "失败" });
    }
  }
  revalidatePath("/schedule");
  return { ok: true, results };
}

export async function deleteTask(id: string) {
  if(await responsibilityReady(prisma))throw new Error("请在事项责任面板取消任务并填写原因，原记录保留");
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
