/**
 * 登录链二次因子校验（内部模块，故意不标 "use server"）。
 *
 * 2026-09-19 审计修复：此前 verifyLoginSecondFactor 导出于 "use server" 模块，
 * 成为可被未登录 RPC 直呼的端点——绕过登录路径对 6 位 TOTP 离线穷举、
 * 并可远程烧毁他人恢复码。迁出到本模块后仅由 authorize 内部引用。
 *
 * 同步修复：同一 TOTP 码 90 秒窗口内不得复用（重放防护）；恢复码核销改为
 * 数据库端原子 array_remove，并发使用同一恢复码只有一个能成功。
 */
import { prisma } from "@/lib/prisma";
import { encryptBuffer, decryptBuffer } from "@/lib/storage/crypto";
import { verifyTotpCounter, matchRecoveryCode } from "@/lib/auth/totp";

export function encryptSecret(secret: string): string {
  const enc = encryptBuffer(Buffer.from(secret, "utf8"));
  return [enc.iv.toString("base64"), enc.authTag.toString("base64"), enc.ciphertext.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, ct] = stored.split(".");
  return decryptBuffer(Buffer.from(ct, "base64"), iv, tag).toString("utf8");
}

// 重放防护：记录每账号最近一次已接受的 TOTP 计数器，计数器不前进即拒绝。
// 单实例自部署（单进程）用进程内记忆即可；重启后清空，最多重新暴露一个 30s 窗口。
const lastUsedCounter = new Map<string, number>();

/** 登录链二次因子校验：TOTP 或恢复码（恢复码命中即核销）。密码已过、锁定已查后调用 */
export async function verifyLoginSecondFactor(
  userId: string,
  code: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, recoveryCodeHashes: true }
  });
  if (!user?.totpSecret) return false;

  const counter = verifyTotpCounter(decryptSecret(user.totpSecret), code);
  if (counter !== null) {
    const last = lastUsedCounter.get(userId);
    if (last !== undefined && counter <= last) return false; // 已用过的码不得复用
    lastUsedCounter.set(userId, counter);
    if (lastUsedCounter.size > 5000) lastUsedCounter.clear(); // 防御性上限
    return true;
  }

  const hashes = user.recoveryCodeHashes ?? [];
  const idx = matchRecoveryCode(hashes, code);
  if (idx !== null) {
    const hash = hashes[idx];
    // 原子核销：WHERE 命中才移除，并发重放同一恢复码只有一方成功
    const updated = await prisma.$executeRaw`
      UPDATE "User"
      SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${hash})
      WHERE id = ${userId} AND ${hash} = ANY("recoveryCodeHashes")`;
    return updated > 0;
  }
  return false;
}
