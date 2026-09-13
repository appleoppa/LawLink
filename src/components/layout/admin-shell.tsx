"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ArrowLeft,
  BellRing,
  BookOpenCheck,
  Bot,
  Building2,
  FileUp,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Package,
  ScrollText,
  ShieldCheck,
  Users
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

const navigation: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: "概览",
    items: [{ href: "/admin", label: "管理概览", icon: LayoutDashboard }]
  },
  {
    label: "组织与人员",
    items: [
      { href: "/admin/firm-profile", label: "律所信息", icon: Building2, adminOnly: true },
      { href: "/admin/users", label: "用户管理", icon: Users, adminOnly: true },
      { href: "/admin/roles", label: "岗位角色", icon: KeyRound, adminOnly: true },
      { href: "/admin/teams", label: "律师团队", icon: Users, adminOnly: true }
    ]
  },
  {
    label: "业务规则",
    items: [
      { href: "/admin/approval-permissions", label: "审批权限", icon: ShieldCheck, adminOnly: true },
      { href: "/admin/archive-policy", label: "归档制度", icon: BookOpenCheck, adminOnly: true },
      { href: "/admin/templates", label: "阶段模板", icon: Layers, adminOnly: true },
      { href: "/admin/custom-fields", label: "自定义字段", icon: ListChecks, adminOnly: true }
    ]
  },
  {
    label: "系统接入",
    items: [
      { href: "/admin/ai", label: "AI 与元典", icon: Bot, adminOnly: true },
      { href: "/admin/express", label: "快递接入", icon: Package, adminOnly: true },
      { href: "/admin/reminders", label: "提醒维护", icon: BellRing },
      { href: "/admin/import", label: "批量导入", icon: FileUp }
    ]
  },
  {
    label: "安全与审计",
    items: [{ href: "/admin/audit", label: "审计日志", icon: ScrollText, adminOnly: true }]
  }
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;
}

export function AdminShell({
  children,
  firmName,
  user,
  isSystemAdmin
}: {
  children: React.ReactNode;
  firmName: string;
  user: { name: string; roleName: string; avatar?: string | null };
  isSystemAdmin: boolean;
}) {
  const pathname = usePathname();
  const visibleNavigation = navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => isSystemAdmin || !item.adminOnly) }))
    .filter((group) => group.items.length > 0);
  const initial = user.name.charAt(0) || "?";

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-border bg-card md:flex">
        <div className="border-b border-border px-4 py-4">
          <Link href="/admin" className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-foreground">{firmName}</span>
              <span className="block text-[11px] text-muted-foreground">LawLink 管理后台</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="管理后台导航">
          {visibleNavigation.map((group) => (
            <section key={group.label} className="mb-5 last:mb-0">
              <h2 className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground">{group.label}</h2>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-[background-color,color,transform] duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.98] motion-reduce:transform-none",
                        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <Avatar className="h-8 w-8">
              {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{user.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{user.roleName}</div>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full justify-start">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              返回业务系统
            </Link>
          </Button>
        </div>
      </aside>

      <div className="md:pl-[232px]">
        <header className="sticky top-0 z-20 border-b border-border bg-[var(--glass-bg)] backdrop-blur-xl">
          <div className="flex h-12 items-center justify-between gap-3 px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-[13px] font-semibold">系统管理模式</span>
              <span className="hidden text-[12px] text-muted-foreground sm:inline">配置变更将影响全所</span>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="md:hidden">
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  返回业务
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="hidden text-muted-foreground sm:inline-flex"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-border/70 px-3 py-2 md:hidden" aria-label="移动端管理后台导航">
            {visibleNavigation.flatMap((group) => group.items).map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px]",
                    active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-5">{children}</main>
      </div>
    </div>
  );
}
