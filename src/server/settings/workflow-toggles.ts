/**
 * v1.0: 工作流开关（ROADMAP 伪需求清单的落地形式——不删功能，改默认值）。
 *
 * 单 SystemSetting key `workflowToggles`：
 * - externalContactReview：外部联系人审核流。小所是信任环境，默认关闭
 *   （新增联系人直接通过）；需要管控的所可打开。
 * 沿用 firm-profile 的「单 key + 类型化读写」范式。
 */
import { prisma } from "@/lib/prisma";

const TOGGLES_KEY = "workflowToggles";

export interface WorkflowToggles {
  externalContactReview: boolean;
}

export const WORKFLOW_TOGGLE_DEFAULTS: WorkflowToggles = {
  externalContactReview: false
};

export async function getWorkflowToggles(): Promise<WorkflowToggles> {
  const row = await prisma.systemSetting.findUnique({ where: { key: TOGGLES_KEY } });
  const s = (row?.value as Partial<WorkflowToggles> | null) ?? {};
  return {
    externalContactReview:
      s.externalContactReview ?? WORKFLOW_TOGGLE_DEFAULTS.externalContactReview
  };
}

export async function saveWorkflowToggles(next: WorkflowToggles): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: TOGGLES_KEY },
    create: { key: TOGGLES_KEY, value: { ...next } },
    update: { value: { ...next } }
  });
}
