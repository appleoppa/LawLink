"use server";
import { roleMutation } from "@/lib/roles/service";

import { scopeFor, type RoleUser } from "@/lib/roles/catalog";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSystemAdmin } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAssociateMatter, matterAssociationFilter } from "@/lib/permissions";
import { trackExpress, detectCompany } from "@/lib/express/track";
import {
  saveExpressSettings as saveSettings,
  readPublicExpressSettings
} from "@/lib/express/settings";
import {
  expressCreateSchema,
  expressListFilterSchema,
  expressIdSchema,
  expressSettingsSaveSchema
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 列表 / 查询
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function listExpress(input?: z.input<typeof expressListFilterSchema>) {
  const session = await requireSession("express.manage");
  const filter = expressListFilterSchema.parse(input ?? {});

  const accessWhere: Prisma.ExpressTrackingWhereInput = session.user.role === "CUSTOM" && scopeFor(session.user, "express.manage") === "ALL" ? {} : {
    OR: [
      { matter: { deletedAt: null, ...matterAssociationFilter(session.user.id) } },
      { matterId: null, createdById: session.user.id }
    ]
  };
  const where: Prisma.ExpressTrackingWhereInput = { AND: [accessWhere] };
  if (filter.scope === "mine") where.createdById = session.user.id;
  if (filter.direction !== "ALL") where.direction = filter.direction;
  if (filter.matterId) where.matterId = filter.matterId;
  if (filter.search) {
    where.AND = [
      accessWhere,
      {
        OR: [
          { trackingNo: { contains: filter.search, mode: "insensitive" } },
          { purpose: { contains: filter.search, mode: "insensitive" } },
          { recipient: { contains: filter.search, mode: "insensitive" } },
          { matter: { internalCode: { contains: filter.search, mode: "insensitive" } } },
          { matter: { title: { contains: filter.search, mode: "insensitive" } } }
        ]
      }
    ];
  }

  return prisma.expressTracking.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      createdBy: { select: { id: true, name: true } }
    }
  });
}

export async function getExpress(id: string) {
  const session = await requireSession("express.manage");
  await assertCanAccessExpressRecord(session.user.id, id, session.user);
  return prisma.expressTracking.findUnique({
    where: { id },
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      createdBy: { select: { id: true, name: true } }
    }
  });
}

async function assertCanAccessExpressRecord(userId: string, id: string, user?: RoleUser) {
  const record = await prisma.expressTracking.findUnique({
    where: { id },
    select: { id: true, matterId: true, createdById: true }
  });
  if (!record) throw new ActionError("快递记录不存在");
  if (user?.role === "CUSTOM" && scopeFor(user, "express.manage") === "ALL") return record;
  if (record.matterId) {
    await assertCanAssociateMatter(userId, record.matterId);
    return record;
  }
  if (record.createdById !== userId) throw new ActionError("无权操作此快递记录");
  return record;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 创建 + 首次查询
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function createExpress(input: z.infer<typeof expressCreateSchema>) {
  const session = await requireSession("express.manage");
  const data = expressCreateSchema.parse(input);

  // 自动识别公司（如未指定）
  let companyCode = data.companyCode?.trim() || null;
  if (!companyCode) companyCode = detectCompany(data.trackingNo);

  if (data.matterId) {
    const m = await prisma.matter.findUnique({
      where: { id: data.matterId },
      select: { id: true }
    });
    if (!m) throw new ActionError("关联案件不存在");
    await assertCanAssociateMatter(session.user.id, data.matterId);
    await assertMatterWritable(data.matterId);
  }

  // 先尝试一次跟踪（失败不阻塞）
  let lastState: string | null = null;
  let tracesJson: Prisma.InputJsonValue | undefined = undefined;
  let lastUpdateAt: Date | null = null;
  try {
    if (companyCode) {
      const r = await trackExpress({ trackingNo: data.trackingNo, companyCode });
      lastState = r.state;
      tracesJson = r.traces as unknown as Prisma.InputJsonValue;
      lastUpdateAt = new Date();
    }
  } catch {
    // 静默：用户可以稍后手动刷新
  }

  const created = await roleMutation(session.user, "express.manage", async roleDb => roleDb.expressTracking.create({
    data: {
      trackingNo: data.trackingNo.trim(),
      companyCode,
      direction: data.direction,
      matterId: data.matterId ?? null,
      purpose: data.purpose.trim(),
      recipient: data.recipient?.trim() || null,
      recipientPhone: data.recipientPhone?.trim() || null,
      lastState,
      tracesJson,
      lastUpdateAt,
      createdById: session.user.id
    },
    select: { id: true, matterId: true }
  }));

  await audit({
    userId: session.user.id,
    action: "EXPRESS_CREATE",
    targetType: "ExpressTracking",
    targetId: created.id,
    detail: { trackingNo: data.trackingNo, direction: data.direction }
  });

  revalidatePath("/express");
  if (created.matterId) await revalidateMatter(created.matterId);
  return { ok: true, id: created.id, firstState: lastState };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 刷新
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function refreshExpress(input: z.infer<typeof expressIdSchema>) {
  const session = await requireSession("express.manage");
  const data = expressIdSchema.parse(input);

  await assertCanAccessExpressRecord(session.user.id, data.id, session.user);
  const e = await prisma.expressTracking.findUniqueOrThrow({
    where: { id: data.id },
    select: { id: true, trackingNo: true, companyCode: true, matterId: true }
  });

  const r = await trackExpress({
    trackingNo: e.trackingNo,
    companyCode: e.companyCode ?? undefined
  });

  await roleMutation(session.user, "express.manage", async roleDb => roleDb.expressTracking.update({
    where: { id: data.id },
    data: {
      companyCode: r.companyName,
      lastState: r.state,
      tracesJson: r.traces as unknown as Prisma.InputJsonValue,
      lastUpdateAt: new Date()
    }
  }));

  await audit({
    userId: session.user.id,
    action: "EXPRESS_REFRESH",
    targetType: "ExpressTracking",
    targetId: data.id,
    detail: { state: r.state, provider: r.provider }
  });

  revalidatePath("/express");
  if (e.matterId) await revalidateMatter(e.matterId);
  return { ok: true, state: r.state, provider: r.provider, traces: r.traces };
}

export async function deleteExpress(input: z.infer<typeof expressIdSchema>) {
  const session = await requireSession("express.manage");
  const data = expressIdSchema.parse(input);

  const e = await assertCanAccessExpressRecord(session.user.id, data.id, session.user);

  await roleMutation(session.user, "express.manage", async roleDb => roleDb.expressTracking.delete({ where: { id: data.id } }));

  await audit({
    userId: session.user.id,
    action: "EXPRESS_DELETE",
    targetType: "ExpressTracking",
    targetId: data.id
  });

  revalidatePath("/express");
  if (e.matterId) await revalidateMatter(e.matterId);
  return { ok: true };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 接入配置（仅系统超级管理员）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getExpressSettingsPublic() {
  await requireSystemAdmin();
  return readPublicExpressSettings();
}

export async function saveExpressSettingsAction(input: z.infer<typeof expressSettingsSaveSchema>) {
  const session = await requireSystemAdmin();
  const data = expressSettingsSaveSchema.parse(input);

  await saveSettings({
    kdniaoEbusinessId: data.kdniaoEbusinessId?.trim() || undefined,
    kdniaoAppKey: data.kdniaoAppKey?.trim() || undefined,
    kdniaoClearKey: data.kdniaoClearKey,
    kuaidi100Customer: data.kuaidi100Customer?.trim() || undefined,
    kuaidi100Key: data.kuaidi100Key?.trim() || undefined,
    kuaidi100ClearKey: data.kuaidi100ClearKey
  });

  await audit({
    userId: session.user.id,
    action: "EXPRESS_SETTINGS_SAVE",
    targetType: "SystemSetting",
    targetId: "expressSettings"
  });

  return { ok: true };
}
