"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSystemAdmin } from "@/lib/auth/session";
import {
  ARCHIVE_POLICY_SETTING_KEY,
  UNCONFIGURED_ARCHIVE_POLICY,
  archivePolicySchema,
  type ArchivePolicyView
} from "@/lib/archive/policy";
import { ActionError } from "@/lib/action-error";

const saveArchivePolicySchema = z.object({
  name: z.string().trim().min(1, "请填写制度名称").max(120),
  version: z.string().trim().min(1, "请填写制度版本").max(60),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择生效日期"),
  sourceFileId: z.string().cuid("请选择制度原文")
});

export async function getArchivePolicy(): Promise<ArchivePolicyView> {
  // 制度元数据对全部登录用户开放（归档申请人须能看到制度依据），但不得未登录可读
  await requireSession("personal");
  const row = await prisma.systemSetting.findUnique({
    where: { key: ARCHIVE_POLICY_SETTING_KEY },
    select: { value: true }
  });
  const parsed = archivePolicySchema.safeParse(row?.value);
  if (!parsed.success) return UNCONFIGURED_ARCHIVE_POLICY;

  const source = await prisma.firmFile.findUnique({
    where: { id: parsed.data.sourceFileId },
    select: { id: true, name: true, sha256: true, archivedAt: true }
  });
  if (!source || source.archivedAt || !source.sha256) {
    return {
      ...UNCONFIGURED_ARCHIVE_POLICY,
      name: parsed.data.name,
      version: parsed.data.version,
      effectiveAt: parsed.data.effectiveAt
    };
  }
  return {
    configured: true,
    name: parsed.data.name,
    version: parsed.data.version,
    effectiveAt: parsed.data.effectiveAt,
    sourceFileId: source.id,
    sourceFileName: source.name,
    sourceFileSha256: source.sha256
  };
}

export async function getArchivePolicySettings() {
  await requireSystemAdmin();
  const [policy, files] = await Promise.all([
    getArchivePolicy(),
    prisma.firmFile.findMany({
      where: { category: "POLICY", archivedAt: null, supersedes: { none: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, sha256: true, createdAt: true }
    })
  ]);
  return { policy, files: files.filter((file) => !!file.sha256) };
}

export async function saveArchivePolicy(input: z.input<typeof saveArchivePolicySchema>) {
  const session = await requireSystemAdmin();
  const data = saveArchivePolicySchema.parse(input);
  const source = await prisma.firmFile.findFirst({
    where: { id: data.sourceFileId, category: "POLICY", archivedAt: null },
    select: { id: true, name: true, sha256: true }
  });
  if (!source?.sha256) throw new ActionError("制度原文不存在或缺少内容校验值");

  const value = {
    schemaVersion: 1 as const,
    configured: true as const,
    ...data,
    confirmedAt: new Date().toISOString(),
    confirmedById: session.user.id
  };
  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: ARCHIVE_POLICY_SETTING_KEY },
      create: { key: ARCHIVE_POLICY_SETTING_KEY, value },
      update: { value }
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "ARCHIVE_POLICY_SAVE",
        targetType: "SystemSetting",
        targetId: ARCHIVE_POLICY_SETTING_KEY,
        detail: {
          name: data.name,
          version: data.version,
          effectiveAt: data.effectiveAt,
          sourceFileId: source.id,
          sourceFileName: source.name,
          sourceFileSha256: source.sha256
        }
      }
    });
  });
  revalidatePath("/admin/archive-policy");
  revalidatePath("/admin/archive-policy");
  revalidatePath("/approvals");
  return { ok: true };
}
