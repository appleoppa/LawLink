import { redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace, isSystemAdmin } from "@/lib/auth/system-role";
import { prisma } from "@/lib/prisma";
import { getFirmProfile } from "@/server/settings/firm-profile";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const systemAdmin = isSystemAdmin(session.user);
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");

  const [profile, currentUser] = await Promise.all([
    getFirmProfile(),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { avatar: true } })
  ]);

  return (
    <AdminShell
      firmName={profile.firmName}
      user={{
        name: session.user.name ?? "当前用户",
        roleName: session.user.roleName ?? "当前岗位",
        avatar: currentUser?.avatar ?? null
      }}
      isSystemAdmin={systemAdmin}
    >
      {children}
    </AdminShell>
  );
}
