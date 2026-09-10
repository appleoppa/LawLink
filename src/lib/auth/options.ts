import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
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
          where: { email: parsed.data.email }
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

        const matches = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!matches) {
          await audit({
            userId: user.id,
            action: "LOGIN_FAILED",
            targetType: "User",
            targetId: user.id,
            detail: { email: parsed.data.email, reason: "BAD_PASSWORD" }
          });
          return null;
        }

        // 更新最后登录时间（异步，不阻塞）
        prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() }
        }).catch((err: unknown) => {
          console.error("[auth] lastLoginAt 更新失败:", err);
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
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
        token.avatar = user.avatar;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.avatar = token.avatar as string | null;
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
