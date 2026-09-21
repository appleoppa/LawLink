/**
 * 最近一次个人邮件摘要（email-digest）投递结果（SystemSetting 单 K-V，无迁移）。
 *
 * 第六轮体检 P1-4：此前 SMTP 未配置时 worker 直接 return——「跳过」不留任何
 * 痕迹，部署方无从知道提醒没有站外出口。现由 worker 在跳过/成功/失败时都写入
 * 本台账，管理后台「提醒维护」页与工作台缺口警示据此展示；配置状态本身由
 * isEmailConfigured() 实时读取环境变量，不依赖台账。
 */
import { prisma } from "@/lib/prisma";

const LAST_RESULT_KEY = "reminder-email-last-result";

export interface ReminderEmailLastResult {
  /** 摘要任务执行时间（ISO 字符串） */
  at: string;
  /** 执行时 SMTP 是否已配置（配置状态可能事后变化，展示以实时 isEmailConfigured 为准） */
  configured: boolean;
  /** 是否跳过发送（未配置 SMTP / 当日无提醒） */
  skipped: boolean;
  /** 跳过原因（中文，供界面直接展示） */
  skipReason?: string;
  /** 发送失败原因 */
  error?: string;
  /** 本次实际发出邮件数 */
  sentCount: number;
  /** 当日有提醒、配置了邮箱的接收人数 */
  userCount: number;
}

function toValue(result: ReminderEmailLastResult): Record<string, string | number | boolean> {
  const value: Record<string, string | number | boolean> = {
    at: result.at,
    configured: result.configured,
    skipped: result.skipped,
    sentCount: result.sentCount,
    userCount: result.userCount
  };
  if (result.skipReason !== undefined) value.skipReason = result.skipReason;
  if (result.error !== undefined) value.error = result.error;
  return value;
}

export async function saveEmailLastResult(result: ReminderEmailLastResult): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: LAST_RESULT_KEY },
    create: { key: LAST_RESULT_KEY, value: toValue(result) },
    update: { value: toValue(result) }
  });
}

/** 读取最近一次邮件摘要结果；无记录或数据损坏时返回 null，按"暂无"展示 */
export async function getEmailLastResult(): Promise<ReminderEmailLastResult | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: LAST_RESULT_KEY }
  });
  const v = row?.value as Partial<ReminderEmailLastResult> | null | undefined;
  if (!v || typeof v.at !== "string") return null;
  const toNumber = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    at: v.at,
    configured: v.configured === true,
    skipped: v.skipped === true,
    skipReason: typeof v.skipReason === "string" ? v.skipReason : undefined,
    error: typeof v.error === "string" ? v.error : undefined,
    sentCount: toNumber(v.sentCount),
    userCount: toNumber(v.userCount)
  };
}
