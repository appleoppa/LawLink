"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAccessMatter } from "@/lib/permissions";
import { revalidateMatter } from "@/server/matters/route";

const noteChannelSchema = z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]);

const noteCreateSchema = z.object({
  matterId: z.string().cuid(),
  channel: noteChannelSchema.default("OTHER"),
  withWhom: z.string().max(80).optional().or(z.literal("")),
  occurredAt: z.coerce.date().default(() => new Date()),
  content: z.string().min(1, "内容不能为空").max(5000),
  tags: z.array(z.string().max(20)).default([])
});

const noteUpdateSchema = noteCreateSchema.extend({
  id: z.string().cuid()
});

export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

export async function createNote(input: NoteCreateInput) {
  const session = await requireSession();
  const data = noteCreateSchema.parse(input);
  await assertCanAccessMatter(session.user.id, session.user.role, data.matterId);
  await assertMatterWritable(data.matterId);

  const created = await prisma.note.create({
    data: {
      matterId: data.matterId,
      authorId: session.user.id,
      channel: data.channel,
      withWhom: data.withWhom || null,
      occurredAt: data.occurredAt,
      content: data.content,
      tags: data.tags
    }
  });

  await audit({
    userId: session.user.id,
    action: "NOTE_CREATE",
    targetType: "Note",
    targetId: created.id,
    detail: { matterId: data.matterId, channel: data.channel }
  });

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function updateNote(input: NoteUpdateInput) {
  const session = await requireSession();
  const data = noteUpdateSchema.parse(input);

  const existing = await prisma.note.findUnique({ where: { id: data.id } });
  if (!existing) throw new Error("沟通记录不存在");
  if (existing.authorId !== session.user.id && session.user.role !== "ADMIN") {
    throw new Error("只能编辑自己的沟通记录");
  }
  await assertMatterWritable(existing.matterId);

  await prisma.note.update({
    where: { id: data.id },
    data: {
      channel: data.channel,
      withWhom: data.withWhom || null,
      occurredAt: data.occurredAt,
      content: data.content,
      tags: data.tags
    }
  });

  await audit({
    userId: session.user.id,
    action: "NOTE_UPDATE",
    targetType: "Note",
    targetId: data.id
  });

  await revalidateMatter(existing.matterId);
  return { ok: true };
}

export async function deleteNote(id: string) {
  const session = await requireSession();
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing) return { ok: false };
  if (existing.authorId !== session.user.id && session.user.role !== "ADMIN") {
    throw new Error("只能删除自己的沟通记录");
  }
  await assertMatterWritable(existing.matterId);

  await prisma.note.update({
    where: { id },
    data: { deletedAt: new Date() }
  });

  await audit({
    userId: session.user.id,
    action: "NOTE_DELETE",
    targetType: "Note",
    targetId: id
  });

  await revalidateMatter(existing.matterId);
  return { ok: true };
}

export async function listNotes(matterId: string) {
  const session = await requireSession();
  await assertCanAccessMatter(session.user.id, session.user.role, matterId);
  return prisma.note.findMany({
    where: { matterId, deletedAt: null },
    orderBy: { occurredAt: "desc" },
    include: { author: { select: { id: true, name: true } } }
  });
}
