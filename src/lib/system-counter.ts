/**
 * SystemSetting 原子计数器（serializable 防并发冲突）+ 序列化失败重试。
 *
 * PostgreSQL 的 Serializable 隔离要求应用侧处理序列化冲突（错误码 40001，
 * Prisma 抛 P2034）并重试整个事务——此前发号器没有重试路径，并发建档时
 * 偶发冲突会直接把错误抛给用户（报告 P0-6 验证项发现）。
 * 这里统一为带重试的事务计数器，client / matters 发号器共用；
 * 重试次数有限并带抖动退避，避免恢复瞬间请求风暴。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const SERIALIZATION_RETRY = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 25
});

function isSerializationConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

export async function nextSystemCounter(key: string): Promise<number> {
  let attempt = 0;
  for (;;) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.systemSetting.findUnique({ where: { key } });
          const current = (existing?.value as { value?: number })?.value ?? 0;
          const incremented = current + 1;
          await tx.systemSetting.upsert({
            where: { key },
            update: { value: { value: incremented } },
            create: { key, value: { value: incremented } }
          });
          return incremented;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err) {
      if (!isSerializationConflict(err) || ++attempt >= SERIALIZATION_RETRY.maxAttempts) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 25);
      await new Promise((r) => setTimeout(r, SERIALIZATION_RETRY.baseDelayMs * 2 ** attempt + jitter));
    }
  }
}
