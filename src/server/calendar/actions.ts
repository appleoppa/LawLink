"use server";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";

function newToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * v0.50: 获取（没有则生成）当前用户的日历订阅 token。
 * URL 即凭证：任何拿到 URL 的日历客户端都能读到该用户可见的日程，
 * 泄露时用 regenerateCalendarToken 作废旧链接。
 */
export async function getCalendarToken() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { calendarToken: true }
  });
  if (user?.calendarToken) return { token: user.calendarToken };

  const token = newToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { calendarToken: token }
  });
  await audit({
    userId: session.user.id,
    action: "CALENDAR_TOKEN_CREATE",
    targetType: "User",
    targetId: session.user.id
  });
  return { token };
}

export async function regenerateCalendarToken() {
  const session = await requireSession();
  const token = newToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { calendarToken: token }
  });
  await audit({
    userId: session.user.id,
    action: "CALENDAR_TOKEN_REGENERATE",
    targetType: "User",
    targetId: session.user.id
  });
  return { token };
}
