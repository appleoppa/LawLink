"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Scale } from "lucide-react";
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
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[208px] flex-col border-r border-border bg-sidebar md:flex">
      <NavContent firm={firm} />
    </aside>
  );
}

/** 导航内容 — 桌面侧边栏和移动 Sheet 共用 */
export function NavContent({ firm }: { firm: FirmBrand }) {
  const pathname = usePathname();

  return (
    <>
      <Link
        href="/"
        className="flex h-12 items-center gap-2.5 px-3.5 transition-colors hover:bg-muted/50"
        aria-label="返回工作台"
      >
        {firm.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firm.logoDataUrl}
            alt={firm.name}
            className="h-[26px] w-[26px] shrink-0 rounded-md object-contain"
          />
        ) : (
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
            <Scale className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </div>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[12.5px] font-semibold">{firm.name}</span>
          {firm.subtitle ? (
            <span className="truncate text-[10px] text-muted-foreground">{firm.subtitle}</span>
          ) : null}
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground/70">
          工作区
        </div>
        <div className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>

      <div className="border-t border-border px-2 py-2">
        <div className="space-y-0.5">
          {secondaryNav.map((item) => (
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
        "group relative flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-[12.5px] transition-[background-color,color,transform] [transition-duration:var(--motion-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-colors",
        isCourtSms
          ? active
            ? "bg-sky-500/12 text-sky-700 font-medium ring-1 ring-sky-500/20"
            : "text-sky-700/90 hover:bg-sky-500/10 hover:text-sky-800"
          : active
            ? "bg-accent text-primary font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
            "rounded-sm px-1.5 py-px text-[10px] font-medium tabular",
            active
              ? "bg-accent text-primary"
              : "bg-muted text-muted-foreground"
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
