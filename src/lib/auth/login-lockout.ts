import { prisma } from "@/lib/prisma";

/**
 * 登录失败锁定（v1.x P0-3）——数据库端原子实现。
 *
 * 2026-09-19 审计修复：此前为「读出 failedLoginAttempts → JS 加一 → 写回」，
 * 并发请求读到同一旧值各自写回，计数永远停在 1，锁定阈值可被并行请求绕过。
 * 现改为单条 UPDATE 原子递增并在达到阈值时置锁，返回递增后的失败次数供审计。
 */
export async function recordLoginFailure(
  userId: string,
  threshold: number,
  lockMinutes: number
): Promise<number> {
  const rows = await prisma.$queryRaw<{ attempts: number }[]>`
    UPDATE "User"
    SET "failedLoginAttempts" = "failedLoginAttempts" + 1,
        "lockedUntil" = CASE
          WHEN "failedLoginAttempts" + 1 >= ${threshold}
            THEN now() + (${lockMinutes} * interval '1 minute')
          ELSE "lockedUntil"
        END
    WHERE id = ${userId}
    RETURNING "failedLoginAttempts"`;
  return Number(rows[0]?.attempts ?? 0);
}
