import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "./_components/change-password-form";
import { AvatarForm } from "./_components/avatar-form";
import { CalendarSubscription } from "./_components/calendar-subscription";
import { userRoleLabel } from "@/lib/enums";

export default async function ProfilePage() {
  const session = await getSession();
  const user = session!.user;
  // 从 DB 读最新头像（避免 JWT 缓存导致上传后不刷新）
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatar: true }
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-base font-semibold">个人信息</h2>
        <div className="mb-5">
          <AvatarForm name={user.name ?? ""} initialAvatar={dbUser?.avatar ?? null} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <Item label="姓名">{user.name}</Item>
          <Item label="邮箱" mono>{user.email}</Item>
          <Item label="角色">{userRoleLabel[user.role as keyof typeof userRoleLabel] ?? user.role}</Item>
        </dl>
      </section>

      <CalendarSubscription />

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-base font-semibold">修改密码</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}

function Item({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 ${mono ? "font-mono tabular" : ""}`}>{children}</dd>
    </div>
  );
}
