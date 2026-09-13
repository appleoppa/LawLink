import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "./_components/change-password-form";
import { TotpCard } from "./_components/totp-card";
import { AvatarForm } from "./_components/avatar-form";
import { ProfileBasicsForm } from "@/components/users/profile-basics-form";
import { IdentityForm } from "@/components/users/identity-form";
import { roleDisplayName } from "@/lib/roles/catalog";

export default async function ProfilePage() {
  const session = await requireSession("personal");
  const user = session.user;
  // 从 DB 读最新头像（避免 JWT 缓存导致上传后不刷新）
  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { avatar: true, name: true, email: true, phone: true, role: true, updatedAt: true, totpEnabled: true }
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-base font-semibold">个人信息</h2>
        <div className="mb-5">
          <AvatarForm name={dbUser.name} initialAvatar={dbUser?.avatar ?? null} />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">角色：{roleDisplayName(user)}</p>
        <ProfileBasicsForm key={dbUser.updatedAt.toISOString()} profile={{ name: dbUser.name, email: dbUser.email, phone: dbUser.phone, updatedAt: dbUser.updatedAt.toISOString() }} />
        <div className="mt-6"><IdentityForm key={`identity-${dbUser.updatedAt.toISOString()}`} /></div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-base font-semibold">修改密码</h2>
        <ChangePasswordForm />
        <TotpCard enabled={dbUser.totpEnabled} />
      </section>
    </div>
  );
}
