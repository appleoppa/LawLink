"use client";
import { useSession } from "next-auth/react";
import { hasCustomPermission, type PermissionKey } from "@/lib/roles/catalog";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { primaryNav, secondaryNav, type NavItem } from "./nav-config";

/** v0.42 项1: 侧栏品牌（可在设置 → 律所信息配置） */
export type FirmBrand = {
  name: string;
  subtitle: string;
  logoDataUrl: string | null;
};

/** 桌面侧边栏（md 以上显示） */
export function Sidebar({ firm }: { firm: FirmBrand }) {
  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[228px] flex-col border-r border-border bg-card md:flex">
      <NavContent firm={firm} />
    </aside>
  );
}

/** 导航内容 — 桌面侧边栏和移动 Sheet 共用 */
export function NavContent({ firm }: { firm: FirmBrand }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const keys: Record<string, PermissionKey> = { "/matters": "matters.read", "/clients": "clients.read", "/finance": "finance.read", "/archive": "archive.read", "/reports": "reports.read", "/inbox": "matters.read" };
  const visible = (item: NavItem) => !keys[item.href] || Boolean(session?.user && hasCustomPermission(session.user, keys[item.href]));

  return (
    <>
      <Link
        href="/"
        className="brand flex h-14 items-center gap-2.5 px-4 no-underline transition-colors hover:bg-muted/50"
        aria-label="返回工作台"
      >
        {firm.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firm.logoDataUrl}
            alt={firm.name}
            className="h-[30px] w-[30px] shrink-0 rounded-lg object-contain"
          />
        ) : (
          // 品牌兜底用正式标志（docs/BRAND.md：双立柱 + teal 连接件），不用天平等传统符号
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/brand/lawlink-mark.svg"
            alt={firm.name}
            className="h-[30px] w-[30px] shrink-0 rounded-lg"
          />
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-foreground">{firm.name}</span>
          {firm.subtitle ? (
            <span className="truncate text-[10px] text-muted-foreground">{firm.subtitle}</span>
          ) : null}
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <div className="nav-section-label">
          工作区
        </div>
        <div className="space-y-0.5">
          {primaryNav.filter(visible).map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>

      <div className="border-t border-border px-2 py-2">
        <div className="nav-section-label">资料</div>
        <div className="space-y-0.5">
          {secondaryNav.filter(visible).map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </div>
    </>
  );
}

function NavLink({
  item,
  active,
  onClick
}: {
  item: NavItem;
  active: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const Icon = item.icon;
  const isCourtSms = item.tone === "courtSms";
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[12.75px] transition-[background-color,color] [transition-duration:140ms]",
        isCourtSms
          ? active
            ? "bg-sky-500/12 text-sky-700 font-medium ring-1 ring-sky-500/20"
            : "text-sky-700/90 hover:bg-sky-500/10 hover:text-sky-800"
          : active
            ? "bg-[#E4F1F0] font-medium text-[#005054]"
            : "text-[#414E5A] hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-[15px] w-[15px] shrink-0",
          isCourtSms
            ? active
              ? "text-sky-700"
              : "text-sky-700/80 group-hover:text-sky-800"
            : active
              ? "text-primary"
              : "text-muted-foreground/70 group-hover:text-foreground"
        )}
        strokeWidth={active ? 2 : 1.6}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span
          className={cn(
            "ml-auto min-w-5 rounded-full px-1.5 py-0 text-center font-mono text-[10.5px] leading-[18px] tabular",
            active
              ? "bg-[rgba(0,123,127,0.14)] text-[#005054]"
              : "bg-[#E9EDEB] text-muted-foreground"
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
