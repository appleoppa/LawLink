import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveRoleUser } from "@/lib/roles/service";
import { audit } from "@/server/audit";
import { verifyLoginSecondFactor } from "@/server/auth/totp-actions";

// v1.x P0-3: 登录失败锁定参数（连续 5 次失败锁 15 分钟；成功登录清零）
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional()
});

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // 12h
  pages: {
    signIn: "/login"
  },
  providers: [
    CredentialsProvider({
      name: "邮箱密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" }
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, name: true, email: true, passwordHash: true, active: true, role: true, systemRole: true, sessionVersion: true, avatar: true, failedLoginAttempts: true, lockedUntil: true, totpEnabled: true, totpEnforced: true }
        });
        if (!user || !user.active) {
          // 失败原因区分「账号不存在」与「已停用」，但都不回给前端，避免账号枚举
          await audit({
            userId: user?.id ?? null,
            action: "LOGIN_FAILED",
            targetType: "User",
            targetId: user?.id,
            detail: { email: parsed.data.email, reason: user ? "INACTIVE" : "NO_SUCH_USER" }
          });
          return null;
        }

        // v1.x P0-3: 登录失败锁定——锁定期间直接拒绝（不比较密码，不给爆破窗口）
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await audit({
            userId: user.id,
            action: "LOGIN_LOCKED_REJECT",
            targetType: "User",
            targetId: user.id,
            detail: { email: parsed.data.email, lockedUntil: user.lockedUntil.toISOString() }
          });
          return null;
        }

        const matches = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!matches) {
          // 连续失败累计，达到阈值锁定 15 分钟（成功登录清零）
          const attempts = user.failedLoginAttempts + 1;
          const lock = attempts >= LOGIN_LOCKOUT_THRESHOLD;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              ...(lock ? { lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60_000) } : {})
            }
          });
          await audit({
            userId: user.id,
            action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
            targetType: "User",
            targetId: user.id,
            detail: { email: parsed.data.email, reason: "BAD_PASSWORD", attempts, locked: lock }
          });
          return null;
        }

        if (!(await resolveRoleUser(user.id, user.role)).enabled) return null;

        // v1.x P1 收尾 c: 管理端强制开启——enforced 且未绑定时拒绝登录（提示先绑定）。
        // 密码已验明才走到这里：不计入失败锁定（凭据无误，是策略拦截而非爆破）。
        if (user.totpEnforced && !user.totpEnabled) {
          await audit({
            userId: user.id,
            action: "LOGIN_TOTP_ENFORCED_REJECT",
            targetType: "User",
            targetId: user.id,
            detail: { email: parsed.data.email, hint: "BIND_TOTP_FIRST" }
          });
          return null;
        }

        // v1.x P1: 双步验证——已开启者必须提供动态码或恢复码（恒拒绝空码）
        if (user.totpEnabled) {
          const code = (parsed.data as { totpCode?: string }).totpCode?.trim() ?? "";
          if (!code || !(await verifyLoginSecondFactor(user.id, code))) {
            await audit({
              userId: user.id,
              action: "LOGIN_TOTP_FAILED",
              targetType: "User",
              targetId: user.id,
              detail: { email: parsed.data.email }
            });
            return null;
          }
        }

        // 更新最后登录时间 + 失败计数清零（异步，不阻塞）
        prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }
        }).catch(() => {
          // 忽略更新失败
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          systemRole: user.systemRole,
          sessionVersion: user.sessionVersion,
          avatar: user.avatar
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.systemRole = user.systemRole;
        token.avatar = user.avatar;
        token.sessionVersion = user.sessionVersion;
      }
      if (token.id) {
        const current = await prisma.user.findUnique({ where: { id: token.id },
          select: { active: true, role: true, systemRole: true, sessionVersion: true, name: true, email: true, avatar: true } });
        if (!current?.active || current.sessionVersion !== (token.sessionVersion ?? 0)) {
          token.id = "";
        } else {
          token.role = current.role;
          token.systemRole = current.systemRole;
          token.name = current.name;
          token.email = current.email;
          token.avatar = current.avatar;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.id) {
        delete (session as { user?: unknown }).user;
        return session;
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.systemRole = token.systemRole as string;
        session.user.avatar = token.avatar as string | null;
        const access = await resolveRoleUser(session.user.id, session.user.role);
        if (!access.enabled) {
          delete (session as { user?: unknown }).user;
          return session;
        }
        session.user.roleName = access.roleName;
        session.user.rolePermissions = access.rolePermissions;
      }
      return session;
    }
  },
  // AGENTS.md §六：AuditLog 必须记录登录/登出
  events: {
    async signIn({ user }) {
      await audit({
        userId: user.id,
        action: "LOGIN",
        targetType: "User",
        targetId: user.id
      });
    },
    async signOut({ token }) {
      const userId = token?.id as string | undefined;
      await audit({
        userId: userId ?? null,
        action: "LOGOUT",
        targetType: "User",
        targetId: userId
      });
    }
  }
};
