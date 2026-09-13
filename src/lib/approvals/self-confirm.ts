/**
 * 按事项审批·自确认清单（制度决策 4.3，2026-09-13 批准实施）。
 *
 * 语义：命中清单的低影响提交动作，由申请人自我确认即完成原审批环节，
 * 不进审批人队列；审计动作 *_SELF_CONFIRM 留痕。与审批规则同构
 * （操作 × 案件类别 × 印章范围），但独立存储于 SystemSetting。
 *
 * 硬排除（服务端不可配置）：归档、开票、盖章回填、法定代表人章
 * （含 requiresLegalRep 的章种）不得自确认——高风险动作永远走完整审批。
 * 本批接线域：文书送审（DOCUMENT_APPROVE）、用章申请（SEAL_APPROVE）；
 * INTAKE_APPROVE 清单可配但接线随收案专项（转化语义复杂）暂未启用。
 */
import type { ApprovalAction } from "@prisma/client";
import { Prisma } from "@prisma/client";

export const SELF_CONFIRM_SETTING_KEY = "approval-self-confirm-list";

export type SelfConfirmItem = {
  action: ApprovalAction;
  /** 空 = 全部案件类别 */
  categories?: string[];
  /** 空 = 全部印章（仅 SEAL_APPROVE 有意义） */
  sealTypes?: string[];
};

export type SelfConfirmList = { items: SelfConfirmItem[] };

export type ApprovalContextLike = {
  action: ApprovalAction;
  category: string | null;
  requesterId: string | null;
  sealType?: string | null;
  purposeId?: string | null;
} & { sealTypeBrand?: never };

/** 允许进入清单的操作（归档/开票/回填在判定处再硬排除兜底） */
export const SELF_CONFIRM_CONFIGURABLE_ACTIONS: ApprovalAction[] = [
  "INTAKE_APPROVE",
  "DOCUMENT_APPROVE",
  "SEAL_APPROVE"
];

/** 服务端硬排除：任何配置都不可自确认 */
const HARD_EXCLUDED_ACTIONS: ApprovalAction[] = ["ARCHIVE_APPROVE", "INVOICE_APPROVE", "SEAL_STAMP"];

type Db = Pick<Prisma.TransactionClient, "systemSetting" | "sealTypeConfig">;

export async function loadSelfConfirmList(db: Db): Promise<SelfConfirmList> {
  const row = await db.systemSetting.findUnique({ where: { key: SELF_CONFIRM_SETTING_KEY } });
  const value = row?.value as SelfConfirmList | null;
  if (!value || !Array.isArray(value.items)) return { items: [] };
  return {
    items: value.items.filter(
      (i): i is SelfConfirmItem =>
        !!i?.action && SELF_CONFIRM_CONFIGURABLE_ACTIONS.includes(i.action)
    )
  };
}

/** 配置校验（管理端保存前）：动作白名单 + 结构清洗，硬排除动作直接拒绝 */
export function sanitizeSelfConfirmList(raw: unknown): SelfConfirmList {
  const value = (raw ?? {}) as SelfConfirmList;
  const items = Array.isArray(value.items) ? value.items : [];
  const seen = new Set<string>();
  const clean: SelfConfirmItem[] = [];
  for (const item of items) {
    if (!item?.action || !SELF_CONFIRM_CONFIGURABLE_ACTIONS.includes(item.action)) continue;
    if (HARD_EXCLUDED_ACTIONS.includes(item.action)) continue;
    if (seen.has(item.action)) continue; // 同动作合并为一条
    seen.add(item.action);
    clean.push({
      action: item.action,
      categories: Array.isArray(item.categories) ? item.categories.filter(Boolean) : [],
      sealTypes: Array.isArray(item.sealTypes) ? item.sealTypes.filter(Boolean) : []
    });
  }
  return { items: clean };
}

/**
 * 自确认资格判定：命中返回 true（调用方跳过审批队列并直接完成 + 审计）。
 * 法定代表人章（或 requiresLegalRep 章种）恒为 false——查当前章种配置，
 * 不依赖清单配置。
 */
export async function selfConfirmEligible(
  context: ApprovalContextLike,
  db: Db
): Promise<boolean> {
  if (HARD_EXCLUDED_ACTIONS.includes(context.action)) return false;
  if (!SELF_CONFIRM_CONFIGURABLE_ACTIONS.includes(context.action)) return false;

  if (context.action === "SEAL_APPROVE" && context.sealType) {
    const config = await db.sealTypeConfig.findUnique({
      where: { type: context.sealType as never }
    });
    if (!config?.enabled) return false;
    if (config.requiresLegalRep || context.sealType === "LEGAL_REP_SEAL") return false;
  }

  const list = await loadSelfConfirmList(db);
  if (list.items.length === 0) return false;

  return list.items.some((item) => {
    if (item.action !== context.action) return false;
    if (item.categories && item.categories.length > 0) {
      if (!context.category || !item.categories.includes(context.category)) return false;
    }
    if (item.action === "SEAL_APPROVE" && item.sealTypes && item.sealTypes.length > 0) {
      if (!context.sealType || !item.sealTypes.includes(context.sealType)) return false;
    }
    return true;
  });
}
