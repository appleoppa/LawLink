"use client";

/**
 * 墨案侧栏（docs/mockup/v4 02–10 页 .sidebar）：
 * 品牌（律所名 + LawLink）/ 工作区·业务·知识·资料 四段导航（带计数）/ 底部用户卡。
 * 计数经 getNavCounts 按当前账号权限异步获取，失败不显示；路由切换后刷新。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ChevronsUpDown, LogOut, ShieldCheck, Settings as SettingsIcon, LayoutGrid } from "lucide-react";
import { customOrLegacy, hasCustomPermission, roleDisplayName, type PermissionKey } from "@/lib/roles/catalog";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { getNavCounts, type NavCounts } from "@/server/layout/nav-counts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { primaryNav, APP_ITEMS, type NavItem } from "./nav-config";

/** v0.42 项1: 侧栏品牌（可在管理后台 → 律所信息配置） */
export type FirmBrand = {
  name: string;
  subtitle: string;
  logoDataUrl: string | null;
};

const PERMISSION_BY_HREF: Record<string, PermissionKey> = {
  "/matters": "matters.read",
  "/intakes": "matters.read",
  "/clients": "clients.read",
  "/finance": "finance.read",
  "/archive": "archive.read",
  "/reports": "reports.read",
  "/inbox": "matters.read"
};

/** 桌面侧边栏（md 以上显示） */
export function Sidebar({ firm, onOpenTools }: { firm: FirmBrand; onOpenTools?: () => void }) {
  return (
    <aside className="sidebar fixed left-0 top-0 z-30 hidden w-[228px] md:flex">
      <NavContent firm={firm} onOpenTools={onOpenTools} />
    </aside>
  );
}

export function BrandMark({ logoDataUrl, name, size = 30 }: { logoDataUrl?: string | null; name: string; size?: number }) {
  if (logoDataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoDataUrl} alt={name} className="shrink-0 rounded-lg object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 16 16" fill="none">
        <rect x="3" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
        <rect x="8.4" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
        <rect x="3" y="6.8" width="8.1" height="2.4" rx="1.1" fill="#00A6A6" />
      </svg>
    </span>
  );
}

/** 导航内容 — 桌面侧边栏和移动 Sheet 共用 */
export function NavContent({ firm, onOpenTools }: { firm: FirmBrand; onOpenTools?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const user = session?.user;
  const [counts, setCounts] = useState<NavCounts | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    getNavCounts()
      .then((c) => alive && setCounts(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user, pathname]);

  const visible = (item: NavItem) => {
    if (!PERMISSION_BY_HREF[item.href]) return true;
    if (!user) return false;
    // 报表页按页面同口径判定（内置岗位仅主任律师可进入），避免入口可见但点进去被重定向回工作台
    if (item.href === "/reports") return customOrLegacy(user, "reports.read", user.role === "PRINCIPAL_LAWYER" || user.managerAuthorized === true);
    return hasCustomPermission(user, PERMISSION_BY_HREF[item.href]);
  };
  const countOf = (item: NavItem): { n: number; alert?: boolean } | null => {
    if (!counts || !item.countKey) return null;
    const n = counts[item.countKey];
    if (n === null || n === undefined || n === 0) return null;
    return { n, alert: item.countKey === "approvals" };
  };

  const displayName = user?.name ?? "";
  const roleLabel = user?.role ? roleDisplayName(user) : "";
  const systemLabel = user?.systemRole === "SUPER_ADMIN" ? "超级管理员" : "";

  const navList = primaryNav.filter(visible);

  return (
    <div className="flex h-full w-full flex-col">
      <Link href="/" className="brand no-underline hover:bg-[var(--bg-hover)]" aria-label="返回工作台">
        <BrandMark logoDataUrl={firm.logoDataUrl} name={firm.name} />
        <div className="min-w-0">
          <div className="brand-name truncate text-[var(--t-primary)]">{firm.name}</div>
          <div className="brand-sub truncate">{firm.subtitle || "LawLink 案件管理"}</div>
        </div>
      </Link>

      <nav className="nav overflow-y-auto">
        {navList.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} count={countOf(item)} />
        ))}
      </nav>

      {/* 工具抽屉不是导航项：固定在底部用户卡上方 */}
      <div className="nav-tools">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn("nav-item w-full border-0 bg-transparent text-left font-[inherit]", APP_ITEMS.some((a) => a.href && pathname.startsWith(a.href)) && "active")}>
              <LayoutGrid className="ic" strokeWidth={1.8} />
              更多应用
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-44">
            {APP_ITEMS.map((it) => {
              const Icon = it.icon;
              if (it.kind === "tools") {
                return (
                  <DropdownMenuItem key={it.label} onSelect={() => onOpenTools?.()} className="cursor-pointer">
                    <Icon className="text-[var(--t-muted)]" strokeWidth={1.8} />
                    {it.label}
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem key={it.label} asChild>
                  {it.kind === "external" ? (
                    <a href={it.href} target="_blank" rel="noreferrer" className="cursor-pointer">
                      <Icon className="text-[var(--t-muted)]" strokeWidth={1.8} />
                      {it.label}
                    </a>
                  ) : (
                    <Link href={it.href!} className="cursor-pointer">
                      <Icon className="text-[var(--t-muted)]" strokeWidth={1.8} />
                      {it.label}
                    </Link>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="nav-bottom">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="user-card w-full border-0 bg-transparent text-left font-[inherit]">
              <span className="avatar av-teal">{displayName.charAt(0) || "?"}</span>
              <span className="user-meta">
                <span className="user-name block truncate text-[var(--t-primary)]">{displayName || "…"}</span>
                <span className="user-role block truncate">{[roleLabel, systemLabel].filter(Boolean).join(" · ")}</span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--t-faint)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuLabel className="text-xs font-normal text-[var(--t-muted)]">
              {displayName ? `${displayName} · ${roleLabel}` : "加载中…"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/profile" className="cursor-pointer">
                <SettingsIcon />
                个人设置
              </Link>
            </DropdownMenuItem>
            {canEnterAdminWorkspace(user) ? (
              <DropdownMenuItem asChild>
                <a href="/admin" target="_blank" rel="noopener" className="cursor-pointer">
                  <ShieldCheck />
                  管理后台
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })} className="cursor-pointer text-[var(--red)] focus:text-[var(--red)]">
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NavLink({ item, active, count }: { item: NavItem; active: boolean; count: { n: number; alert?: boolean } | null }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className={cn("nav-item no-underline", active && "active")} aria-current={active ? "page" : undefined}>
      <Icon className="ic" strokeWidth={1.8} />
      <span className="truncate">{item.label}</span>
      {count ? <span className={cn("count", count.alert && !active && "alert")}>{count.n > 99 ? "99+" : count.n}</span> : null}
    </Link>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
