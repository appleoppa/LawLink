"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { getWorkflowToggles, saveWorkflowToggles } from "./workflow-toggles";

const saveSchema = z.object({
  externalContactReview: z.boolean()
});

async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "ADMIN") {
    throw new Error("仅管理员可修改工作流开关");
  }
  return session;
}

export async function saveWorkflowTogglesAction(input: z.infer<typeof saveSchema>) {
  const session = await requireAdmin();
  const data = saveSchema.parse(input);
  await saveWorkflowToggles(data);
  await audit({
    userId: session.user.id,
    action: "WORKFLOW_TOGGLES_SAVE",
    targetType: "SystemSetting",
    targetId: "workflowToggles",
    detail: data
  });
  revalidatePath("/settings/firm-profile");
  return { ok: true };
}

export async function getWorkflowTogglesAction() {
  await requireAdmin();
  return getWorkflowToggles();
}
