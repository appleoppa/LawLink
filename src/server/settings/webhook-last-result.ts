/**
 * 最近一次到期提醒扫描与群机器人推送结果（SystemSetting 单 K-V，无迁移）。
 *
 * 由 scan-due-reminders 每次扫描结束后写入，管理后台「提醒维护」页读取展示，
 * 让配置推送的人不必翻审计日志就能看到上次扫描概况与 webhook 投递是否成功。
 * key 命名沿用 notifyWebhook 的「单 key + 类型化读写」范式。
 */
import { prisma } from "@/lib/prisma";

const LAST_RESULT_KEY = "reminder-webhook-last-result";

export interface ReminderWebhookLastResult {
  /** 扫描时间（ISO 字符串） */
  at: string;
  /** webhook 是否发送成功（skipped 时为 false） */
  ok: boolean;
  /** 是否跳过推送（未启用/未配置，或本次无新提醒） */
  skipped: boolean
  /** 是否已入队待投递（P1-1：扫描后由队列 worker 实际外发） */
  queued?: boolean;
  /** 跳过原因（中文，供界面直接展示） */
  skipReason?: string;
  /** 发送失败原因 */
  error?: string;
  /** 本次新提醒总数（= 群汇总消息条数） */
  reminderCount: number;
  deadlineScanned: number;
  deadlineNotified: number;
  hearingScanned: number;
  hearingNotified: number;
  preservationScanned: number;
  preservationNotified: number;
  preservationExpired: number;
  suppressed: number;
  /** v1.x P1 收尾：逾期档升级给团队负责人的送达数 */
  escalationSent?: number;
  /** 本次扫描覆盖的期限偏移档（含由 remindDays 并集出的自定义提前档） */
  deadlineOffsets: number[];
}

function toValue(
  result: ReminderWebhookLastResult
): Record<string, string | number | boolean | number[]> {
  // Prisma Json 字段不接受 undefined，可选项仅在存在时写入
  const value: Record<string, string | number | boolean | number[]> = {
    at: result.at,
    ok: result.ok,
    skipped: result.skipped,
    reminderCount: result.reminderCount,
    deadlineScanned: result.deadlineScanned,
    deadlineNotified: result.deadlineNotified,
    hearingScanned: result.hearingScanned,
    hearingNotified: result.hearingNotified,
    preservationScanned: result.preservationScanned,
    preservationNotified: result.preservationNotified,
    preservationExpired: result.preservationExpired,
    suppressed: result.suppressed,
    deadlineOffsets: result.deadlineOffsets
  };
  if (result.skipReason !== undefined) value.skipReason = result.skipReason;
  if (result.queued !== undefined) value.queued = result.queued;
  if (result.error !== undefined) value.error = result.error;
  if (result.escalationSent !== undefined) value.escalationSent = result.escalationSent;
  return value;
}

function toNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function saveWebhookLastResult(
  result: ReminderWebhookLastResult
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: LAST_RESULT_KEY },
    create: { key: LAST_RESULT_KEY, value: toValue(result) },
    update: { value: toValue(result) }
  });
}

/** 读取最近一次扫描与推送结果；无记录或数据损坏时返回 null，按"暂无"展示 */
export async function getWebhookLastResult(): Promise<ReminderWebhookLastResult | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: LAST_RESULT_KEY }
  });
  const v = row?.value as Partial<ReminderWebhookLastResult> | null | undefined;
  if (!v || typeof v.at !== "string") return null;
  return {
    at: v.at,
    ok: v.ok === true,
    skipped: v.skipped === true,
    queued: v.queued === true,
    skipReason: typeof v.skipReason === "string" ? v.skipReason : undefined,
    error: typeof v.error === "string" ? v.error : undefined,
    reminderCount: toNumber(v.reminderCount),
    deadlineScanned: toNumber(v.deadlineScanned),
    deadlineNotified: toNumber(v.deadlineNotified),
    hearingScanned: toNumber(v.hearingScanned),
    hearingNotified: toNumber(v.hearingNotified),
    preservationScanned: toNumber(v.preservationScanned),
    preservationNotified: toNumber(v.preservationNotified),
    preservationExpired: toNumber(v.preservationExpired),
    suppressed: toNumber(v.suppressed),
    escalationSent: toNumber(v.escalationSent),
    deadlineOffsets: Array.isArray(v.deadlineOffsets)
      ? v.deadlineOffsets.filter((n): n is number => typeof n === "number")
      : []
  };
}
