import { nextSystemCounter } from "@/lib/system-counter";
import { shParts } from "@/lib/ui/sh-time";

/**
 * v0.39: 原子生成客户编号 KH-{YYYY}-{4位流水}
 *
 * 计数器存在 SystemSetting，key 形如 `client-code-counter-2026`。
 * Serializable 事务防并发冲突，序列化失败由共享计数器统一重试（P0-6）。
 */
export async function generateClientCode(): Promise<string> {
  // 2026-09-20 第五轮审计时区修复：编号年份按上海（元旦 0-8 点不再生成去年编号）
  const year = shParts(new Date()).y;
  const next = await nextSystemCounter(`client-code-counter-${year}`);
  const padded = String(next).padStart(4, "0");
  return `KH-${year}-${padded}`;
}
