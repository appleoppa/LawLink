"use server";

/**
 * TOTP 双步验证服务端动作（P1 §五）。
 * secret 以 AES-GCM（复用附件密钥）加密存 User.totpSecret，格式 iv.authTag.ct（base64）；
 * 恢复码只存 sha256 哈希，核销即从数组移除。
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { revalidatePath } from "next/cache";
import { encryptBuffer, decryptBuffer } from "@/lib/storage/crypto";
import {
  generateTotpSecret, verifyTotp, otpauthUri,
  generateRecoveryCodes, matchRecoveryCode
} from "@/lib/auth/totp";

function encryptSecret(secret: string): string {
  const enc = encryptBuffer(Buffer.from(secret, "utf8"));
  return [enc.iv.toString("base64"), enc.authTag.toString("base64"), enc.ciphertext.toString("base64")].join(".");
}
function decryptSecret(stored: string): string {
  const [iv, tag, ct] = stored.split(".");
  return decryptBuffer(Buffer.from(ct, "base64"), iv, tag).toString("utf8");
}

/** 登录页预检：该账号是否已开启双步验证（仅返回布尔，防枚举只暴露 TOTP 开关） */
export async function checkLoginRequiresTotp(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { totpEnabled: true }
  });
  return user?.totpEnabled ?? false;
}

/**
 * 登录页预检（收尾 c）：账号是否被管理员强制双步验证且尚未绑定。
 * 为 true 时登录将被拒绝，登录页应提示"该账号已被要求开启双步验证，请先完成绑定"。
 * 仅返回布尔，不暴露其他账号信息。
 */
export async function checkLoginTotpEnforcement(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { totpEnforced: true, totpEnabled: true }
  });
  return (user?.totpEnforced && !user.totpEnabled) ?? false;
}

/** 开始绑定：生成待确认 secret（未启用前仅暂存），返回 otpauth URI 供手输/扫码 */
export async function enrollStartTotp(): Promise<{ secret: string; uri: string }> {
  const session = await requireSession("personal");
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { totpSecret: encryptSecret(secret), totpEnabled: false }
  });
  return { secret, uri: otpauthUri({ secret, account: session.user.email ?? session.user.id, issuer: "LawLink" }) };
}

/** 确认绑定：首验通过即启用并一次性发放 8 枚恢复码 */
export async function enrollConfirmTotp(input: { code: string }): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; message: string }> {
  const session = await requireSession("personal");
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, "请输入 6 位动态码") }).parse(input);

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { totpSecret: true, totpEnabled: true } });
  if (!user?.totpSecret) return { ok: false, message: "请先生成绑定密钥" };
  if (user.totpEnabled) return { ok: false, message: "双步验证已开启" };

  const secret = decryptSecret(user.totpSecret);
  if (!verifyTotp(secret, code)) return { ok: false, message: "动态码不正确，请确认时间同步后重试" };

  const { codes, hashes } = generateRecoveryCodes();
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { totpEnabled: true, recoveryCodeHashes: hashes }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "USER_TOTP_ENABLE",
      targetType: "User",
      targetId: session.user.id
    });
  });
  revalidatePath("/settings/profile");
  return { ok: true, recoveryCodes: codes };
}

/** 关闭双步验证：需当前动态码或一枚恢复码；被管理员强制开启的不可自行关闭 */
export async function disableTotp(input: { code: string }): Promise<{ ok: boolean; message?: string }> {
  const session = await requireSession("personal");
  const { code } = z.object({ code: z.string().min(6).max(16) }).parse(input);

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { totpSecret: true, totpEnabled: true, totpEnforced: true, recoveryCodeHashes: true } });
  if (!user?.totpEnabled) return { ok: false, message: "双步验证未开启" };
  if (user.totpEnforced) return { ok: false, message: "管理员已要求该账号开启双步验证，无法自行关闭；如需调整请联系系统管理员" };

  const secret = user.totpSecret ? decryptSecret(user.totpSecret) : null;
  const recoveryIdx = matchRecoveryCode(user.recoveryCodeHashes ?? [], code);
  if (!secret || !verifyTotp(secret, code)) {
    if (recoveryIdx === null) return { ok: false, message: "验证失败：动态码或恢复码不正确" };
    const remaining = (user.recoveryCodeHashes ?? []).filter((_, i) => i !== recoveryIdx);
    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: session.user.id },
        data: { totpEnabled: false, totpSecret: null, recoveryCodeHashes: remaining }
      });
      await auditTx(tx, { userId: session.user.id, action: "USER_TOTP_DISABLE", targetType: "User", targetId: session.user.id, detail: { via: "recovery-code" } });
    });
    revalidatePath("/settings/profile");
    return { ok: true };
  }
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { totpEnabled: false, totpSecret: null, recoveryCodeHashes: [] }
    });
    await auditTx(tx, { userId: session.user.id, action: "USER_TOTP_DISABLE", targetType: "User", targetId: session.user.id, detail: { via: "totp-code" } });
  });
  revalidatePath("/settings/profile");
  return { ok: true };
}

/** 登录链二次因子校验：TOTP 或恢复码（恢复码核销后落库）。密码已过、锁定已查后调用 */
export async function verifyLoginSecondFactor(
  userId: string,
  code: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, recoveryCodeHashes: true }
  });
  if (!user?.totpSecret) return false;

  if (verifyTotp(decryptSecret(user.totpSecret), code)) return true;

  const idx = matchRecoveryCode(user.recoveryCodeHashes ?? [], code);
  if (idx !== null) {
    await prisma.user.update({
      where: { id: userId },
      data: { recoveryCodeHashes: (user.recoveryCodeHashes ?? []).filter((_, i) => i !== idx) }
    });
    return true;
  }
  return false;
}
