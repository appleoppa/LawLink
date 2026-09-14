import Link from "next/link";
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/patterns/moan";

export default async function SettingsLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <PageHeader className="!mb-0" title="个人设置" sub="个人资料、登录安全与身份信息；修改联系方式不会影响历史案件归属。" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <nav className="lg:col-span-1">
          <ul className="space-y-0.5 ll-surface p-2">
            <SettingsNavLink
              href="/settings/profile"
              icon={<KeyRound className="h-3.5 w-3.5" />}
            >
              个人资料与安全
            </SettingsNavLink>
          </ul>
        </nav>

        <div className="lg:col-span-4">{children}</div>
      </div>
    </div>
  );
}

function SettingsNavLink({
  href,
  icon,
  children
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-popover hover:text-foreground"
      >
        {icon}
        {children}
      </Link>
    </li>
  );
}
