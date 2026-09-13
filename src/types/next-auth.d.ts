import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      systemRole: string;
      roleName?: string;
      rolePermissions?: import("@/lib/roles/catalog").RoleGrant[];
      avatar: string | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    sessionVersion: number;
    role: string;
    systemRole: string;
    avatar: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    sessionVersion?: number;
    id: string;
    role: string;
    systemRole: string;
    avatar: string | null;
  }
}
