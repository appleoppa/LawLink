/**
 * 外部调用台账（报告 P1：AI / 元典等外部服务的成本与失败可见性）。
 *
 * 记录每次外部服务调用（服务、动作、成败、耗时），失败不阻塞业务
 * （台账自身失败只记 console）。管理后台「AI 与元典」页汇总展示。
 * 不记录任何请求/响应正文——正文可能含案件内容，只记元数据。
 */
import { prisma } from "@/lib/prisma";

export interface ExternalCallLogInput {
  service: string; // 如 "ai-chat" / "ai-vision" / "yuandian" / "sms-ai"
  action?: string; // 如 "review-document" / "recognize-invoice"
  ok: boolean;
  durationMs: number;
  error?: string;
  userId?: string | null;
}

export async function logExternalCall(input: ExternalCallLogInput): Promise<void> {
  try {
    await prisma.externalCallLog.create({
      data: {
        service: input.service,
        action: input.action ?? null,
        ok: input.ok,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        error: input.error?.slice(0, 300) ?? null,
        userId: input.userId ?? null
      }
    });
  } catch (err) {
    console.error("[external-call-log] 写入失败：", err);
  }
}

/** 用耗时包装一个外部调用并落台账（不改变调用结果与异常行为） */
export async function withExternalCallLog<T>(
  input: Omit<ExternalCallLogInput, "ok" | "durationMs" | "error">,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await logExternalCall({ ...input, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    await logExternalCall({
      ...input,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}
