"use server";

/**
 * 自确认清单管理动作（4.3，仅超级管理员）。
 * 硬排除动作（归档/开票/回填/法代章）在 sanitize 层拒绝，不可经任何入口写入。
 */
import { prisma } from "@/lib/prisma";
import { requireSystemAdmin } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { revalidatePath } from "next/cache";
import {
  SELF_CONFIRM_SETTING_KEY,
  sanitizeSelfConfirmList,
  loadSelfConfirmList,
  type SelfConfirmList
} from "@/lib/approvals/self-confirm";

export async function getSelfConfirmListAdmin(): Promise<SelfConfirmList> {
  await requireSystemAdmin();
  return loadSelfConfirmList(prisma);
}

export async function saveSelfConfirmListAdmin(input: unknown): Promise<{ ok: true; items: number }> {
  const session = await requireSystemAdmin();
  const clean = sanitizeSelfConfirmList(input);

  await prisma.$transaction(async tx => {
    await tx.systemSetting.upsert({
      where: { key: SELF_CONFIRM_SETTING_KEY },
      create: { key: SELF_CONFIRM_SETTING_KEY, value: clean },
      update: { value: clean }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "APPROVAL_SELF_CONFIRM_LIST_SAVE",
      targetType: "SystemSetting",
      targetId: SELF_CONFIRM_SETTING_KEY,
      detail: { items: clean.items }
    });
  });

  revalidatePath("/admin/approval-permissions");
  return { ok: true, items: clean.items.length };
}
