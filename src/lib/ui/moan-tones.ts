/**
 * 墨案（docs/mockup/v4）颜色纪律的集中映射。
 * teal 只表达品牌与当前交互；blue 进行中；green 完成终态；
 * red 只表达风险或阻断；amber 临期/待办；bronze 归档金线。
 * 页面只取语义色调，不自行判断颜色。
 */
import type { DocumentSourceOrigin, MatterStatus } from "@prisma/client";

export type MoanTone = "teal" | "blue" | "green" | "amber" | "red" | "violet" | "slate" | "bronze";

/** 案卷脊：案件状态 → 脊线色（逾期风险优先于状态） */
export function matterSpineTone(status: MatterStatus, overdue = false): MoanTone {
  if (overdue && status !== "CLOSED" && status !== "ARCHIVED") return "red";
  switch (status) {
    case "PENDING_ACCEPTANCE":
      return "amber";
    case "IN_PROGRESS":
      return "blue";
    case "ON_HOLD":
      return "slate";
    case "CLOSED":
      return "green";
    case "ARCHIVED":
      return "bronze";
  }
}

export function matterStatusTone(status: MatterStatus): MoanTone {
  return matterSpineTone(status);
}

/**
 * 风险阶梯：剩余天数 → 档位与色调。
 * 正常(1) → 关注(2, ≤30 天) → 临期(3, ≤7 天) → 逾期(4)；红永远只属于最后一格与 3 天内的法定期限。
 */
export function deadlineRisk(daysLeft: number | null | undefined): { level: 0 | 1 | 2 | 3 | 4; tone: MoanTone } {
  if (daysLeft === null || daysLeft === undefined) return { level: 0, tone: "slate" };
  if (daysLeft < 0) return { level: 4, tone: "red" };
  if (daysLeft <= 3) return { level: 3, tone: "red" };
  if (daysLeft <= 7) return { level: 3, tone: "amber" };
  if (daysLeft <= 30) return { level: 2, tone: "blue" };
  return { level: 1, tone: "blue" };
}

/** 倒计时 chip 色调（.cd-urgent / .cd-soon / .cd-normal） */
export function countdownTone(daysLeft: number): "urgent" | "soon" | "normal" {
  if (daysLeft <= 3) return "urgent";
  if (daysLeft <= 7) return "soon";
  return "normal";
}

export function countdownLabel(daysLeft: number): string {
  if (daysLeft < 0) return `逾期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天";
  if (daysLeft === 1) return "明天";
  return `${daysLeft} 天`;
}

/** 材料来源 chip（.src-chip.party / court / ai / self） */
export const documentSourceChip: Record<DocumentSourceOrigin, { label: string; kind: "party" | "court" | "ai" | "self" | "team" }> = {
  CLIENT_PROVIDED: { label: "当事人提供", kind: "party" },
  COURT_SERVED: { label: "法院送达", kind: "court" },
  AI_EXTRACTED: { label: "AI 识别", kind: "ai" },
  SELF_COLLECTED: { label: "自行调取", kind: "self" },
  TEAM_PRODUCED: { label: "团队产出", kind: "team" }
};

/** 头像底色：同名稳定取色，避免同屏全部同色 */
const AVATAR_TONES = ["teal", "navy", "violet", "amber", "green", "slate"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];
export function avatarTone(seed: string | null | undefined): AvatarTone {
  if (!seed) return "slate";
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** 审批事项 → 徽章色调 */
export function approvalActionTone(action: string): MoanTone {
  if (action.includes("INTAKE") || action.includes("MATTER")) return "amber";
  if (action.includes("SEAL")) return "amber";
  if (action.includes("INVOICE")) return "teal";
  if (action.includes("ARCHIVE")) return "slate";
  if (action.includes("DOCUMENT")) return "violet";
  return "slate";
}
