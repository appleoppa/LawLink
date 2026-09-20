"use server";
import { roleMutation } from "@/lib/roles/service";

/**
 * v0.27: 服务中心 - 律所公告
 *
 * - 主任律师或具备自定义授权的岗位可发布、编辑、置顶、归档
 * - 所有登录用户可读
 * - pinned + 未过期 + 未归档的公告显示为顶部 banner
 */
import { customOrLegacy, type RoleUser } from "@/lib/roles/catalog";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";
import { audit } from "@/server/audit";

function assertCanManage(user: RoleUser) {
  if (!customOrLegacy(user, "announcements.manage", isManager(user))) {
    throw new Error("仅合伙人、获业务管理权或获授权岗位可发布公告");
  }
}

const announcementCreateSchema = z.object({
  title: z.string().min(1, "标题必填").max(120),
  content: z.string().min(1, "内容必填").max(20000),
  pinned: z.boolean().default(false),
  expiresAt: z.coerce.date().optional().nullable()
});

const announcementUpdateSchema = announcementCreateSchema.extend({
  id: z.string().cuid()
});

export async function listAnnouncements({
  includeArchived = false
}: { includeArchived?: boolean } = {}) {
  await requireSession("personal");
  return prisma.announcement.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    include: {
      author: { select: { id: true, name: true } }
    }
  });
}

/**
 * 顶部 banner：pinned + 未归档 + 未过期
 */
export async function listActiveBanners() {
  await requireSession("personal");
  const now = new Date();
  return prisma.announcement.findMany({
    where: {
      pinned: true,
      archivedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true, content: true, publishedAt: true }
  });
}

export async function createAnnouncement(input: z.infer<typeof announcementCreateSchema>) {
  const session = await requireSession("announcements.manage");
  assertCanManage(session.user);
  const data = announcementCreateSchema.parse(input);

  const created = await roleMutation(session.user, "announcements.manage", async roleDb => roleDb.announcement.create({
    data: {
      title: data.title.trim(),
      content: data.content,
      pinned: data.pinned,
      expiresAt: data.expiresAt ?? null,
      authorId: session.user.id
    }
  }));

  await audit({
    userId: session.user.id,
    action: "ANNOUNCEMENT_CREATE",
    targetType: "Announcement",
    targetId: created.id,
    detail: { title: created.title, pinned: created.pinned }
  });

  revalidatePath("/announcements");
  revalidatePath("/", "layout"); // banner 在全站布局
  return created;
}

export async function updateAnnouncement(input: z.infer<typeof announcementUpdateSchema>) {
  const session = await requireSession("announcements.manage");
  assertCanManage(session.user);
  const data = announcementUpdateSchema.parse(input);

  const updated = await roleMutation(session.user, "announcements.manage", async roleDb => roleDb.announcement.update({
    where: { id: data.id },
    data: {
      title: data.title.trim(),
      content: data.content,
      pinned: data.pinned,
      expiresAt: data.expiresAt ?? null
    }
  }));

  await audit({
    userId: session.user.id,
    action: "ANNOUNCEMENT_UPDATE",
    targetType: "Announcement",
    targetId: data.id,
    detail: { title: updated.title, pinned: updated.pinned }
  });

  revalidatePath("/announcements");
  revalidatePath("/", "layout");
  return updated;
}

export async function archiveAnnouncement(id: string) {
  const session = await requireSession("announcements.manage");
  assertCanManage(session.user);

  await roleMutation(session.user, "announcements.manage", async roleDb => roleDb.announcement.update({
    where: { id },
    data: { archivedAt: new Date() }
  }));

  await audit({
    userId: session.user.id,
    action: "ANNOUNCEMENT_ARCHIVE",
    targetType: "Announcement",
    targetId: id
  });

  revalidatePath("/announcements");
  revalidatePath("/", "layout");
}
