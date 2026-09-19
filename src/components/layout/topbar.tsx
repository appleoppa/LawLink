"use client";

/**
 * 墨案顶栏（docs/mockup/v4 .topbar）：⌘K 搜索框 / 通知 / 按页主操作 / 用户胶囊。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Search, ChevronDown, Plus, LogOut, User, Settings as SettingsIcon, Menu, ShieldCheck, ScanSearch } from "lucide-react";
import { roleDisplayName } from "@/lib/roles/catalog";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { NotificationPopover } from "@/components/layout/notification-popover";
import { SmsPopover } from "@/components/layout/sms-popover";
import { SearchDialog } from "@/components/layout/search-dialog";
import { useTopbarActionValue } from "./topbar-action";
import { hasCustomPermission } from "@/lib/roles/catalog";

export function Topbar({ onMobileMenuToggle, userAvatar }: { onMobileMenuToggle?: () => void; userAvatar?: string | null }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const pageAction = useTopbarActionValue();
  const user = session?.user;
  const displayName = user?.name ?? "";
  const roleLabel = user?.role ? roleDisplayName(user) : "";

  const canCreateIntake = user ? hasCustomPermission(user as Parameters<typeof hasCustomPermission>[0], "intakes.create") : false;
  const canReadMatters = user ? hasCustomPermission(user as Parameters<typeof hasCustomPermission>[0], "matters.write") : false;
  const action = pageAction === "none" ? null : pageAction ?? (canCreateIntake ? { label: "新建收案", onClick: () => router.push("/matters?tab=intake&new=1") } : null);

  return (
    <header className="topbar ll-material">
      {onMobileMenuToggle ? (
        <button onClick={onMobileMenuToggle} className="btn btn-secondary btn-icon md:hidden" aria-label="打开菜单">
          <Menu strokeWidth={1.8} />
        </button>
      ) : null}

      <button type="button" onClick={() => setSearchOpen(true)} className="searchbox min-w-0 flex-1 text-left font-[inherit] sm:flex-initial" aria-label="全局搜索（⌘K）">
        <Search className="h-[15px] w-[15px] shrink-0" strokeWidth={1.8} />
        <span className="flex-1 truncate">搜索案件、客户、材料正文…</span>
        <span className="kbd hidden sm:inline-flex">⌘K</span>
      </button>

      <div className="hidden flex-1 sm:block" />

      <NotificationPopover />
      {canReadMatters ? <SmsPopover /> : null}

      {/* 收案动线：先预检再建案——预检为次级按钮，与主操作同高、同圆角，靠拢成一组 */}
      {canCreateIntake || action ? (
        <div className="tb-actions">
          {canCreateIntake ? (
            <Link href="/conflicts" className="btn btn-secondary" title="收案前查一查本所有没有相关记录" aria-label="冲突预检">
              <ScanSearch strokeWidth={1.9} />
              <span className="hidden lg:inline">冲突预检</span>
            </Link>
          ) : null}
          {action ? (
            <button type="button" onClick={action.onClick} disabled={action.disabled} className="btn btn-primary disabled:opacity-50" aria-label={action.label}>
              <Plus strokeWidth={2.2} />
              <span className="hidden sm:inline">{action.label}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ml-1 hidden h-[38px] items-center gap-2 rounded-full border border-[var(--bd-hair)] bg-card py-1 pl-1 pr-2.5 font-[inherit] shadow-[var(--sh-card)] transition-colors hover:bg-[var(--bg-hover)] sm:flex">
            {userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userAvatar} alt={displayName} className="h-[27px] w-[27px] rounded-full object-cover" />
            ) : (
              <span className="avatar av-teal">{displayName.charAt(0) || "?"}</span>
            )}
            <span className="text-[13px] font-semibold text-[var(--t-primary)]">{displayName || "…"}</span>
            <ChevronDown className="h-3 w-3 text-[var(--t-muted)]" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs font-normal text-[var(--t-muted)]">
            {displayName ? `${displayName} · ${roleLabel}` : "加载中…"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile" className="cursor-pointer">
              <User />
              个人信息
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
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

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
