"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  Search,
  ChevronDown,
  Plus,
  LogOut,
  User,
  Settings as SettingsIcon,
  Menu,
  LayoutGrid,
  Calculator,
  Package,
  FolderArchive,
  Contact,
  Compass,
  Megaphone,
  BookText
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { NotificationPopover } from "@/components/layout/notification-popover";
import { SearchDialog } from "@/components/layout/search-dialog";
import { ToolsDialog } from "@/components/layout/tools-dialog";
import { cn } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  ADMIN: "系统管理员",
  PRINCIPAL_LAWYER: "主办律师",
  LAWYER: "经办律师",
  ASSISTANT: "助理",
  FINANCE: "财务"
};

// 应用菜单聚合入口（v0.38：各分类拆回独立页；实务工具=全局弹窗；法律导航=外链）
// kind: "tools" 触发工具箱弹窗（不跳转）；"external" 新标签外链；其余 Link 跳独立页
const APP_ITEMS = [
  { label: "实务工具", icon: Calculator, kind: "tools" },
  { label: "快递跟踪", href: "/express", icon: Package, kind: "link" },
  { label: "律所文书", href: "/firm-resources", icon: FolderArchive, kind: "link" },
  { label: "法律导航", href: "https://yesen.cn", icon: Compass, kind: "external" },
  { label: "公告指引", href: "/announcements", icon: Megaphone, kind: "link" },
  { label: "制度规范", href: "/policy", icon: BookText, kind: "link" },
  { label: "通讯录", href: "/contacts", icon: Contact, kind: "link" }
] as const;

export function Topbar({ onMobileMenuToggle, userAvatar }: { onMobileMenuToggle?: () => void; userAvatar?: string | null }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const user = session?.user;
  const displayName = user?.name ?? "";
  const roleLabel = user?.role ? (roleLabels[user.role] ?? user.role) : "";
  const initial = displayName ? displayName.charAt(0) : "?";

  return (
    <header className="ll-material sticky top-0 z-20 flex h-12 items-center gap-2.5 border-b border-white/70 bg-[var(--glass-bg)] px-4 shadow-[0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-xl sm:px-5">
      {/* 移动端汉堡菜单 */}
      {onMobileMenuToggle && (
        <button
          onClick={onMobileMenuToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          aria-label="打开菜单"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}
      {/* 搜索 */}
      <button
        onClick={() => setSearchOpen(true)}
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-card/80 px-2.5 text-left sm:w-[300px] sm:flex-initial",
          "text-[13px] text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
        )}
        aria-label="全局搜索 (Cmd+K)"
      >
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="flex-1 truncate">搜索案件、客户、材料...</span>
        <kbd className="hidden h-4 items-center gap-0.5 rounded bg-muted/80 px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1 hidden sm:block" />

      {/* 工具按钮组 */}
      <div className="flex items-center gap-1.5">
        {/* 应用菜单（案件云式聚合入口）*/}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-card px-2.5 text-[13px] shadow-[var(--shadow-low)]",
                "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              )}
              title="应用"
            >
              <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.8} />
              <span className="hidden sm:inline">应用</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {APP_ITEMS.map((it) => {
              // 实务工具：打开全局工具箱弹窗，不跳转、不改路由
              if (it.kind === "tools") {
                return (
                  <DropdownMenuItem
                    key={it.label}
                    onSelect={(e) => {
                      e.preventDefault();
                      setToolsOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <it.icon className="mr-2 h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                    {it.label}
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem key={it.label} asChild>
                  {it.kind === "external" ? (
                    <a href={it.href} target="_blank" rel="noreferrer" className="cursor-pointer">
                      <it.icon className="mr-2 h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                      {it.label}
                    </a>
                  ) : (
                    <Link href={it.href} className="cursor-pointer">
                      <it.icon className="mr-2 h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                      {it.label}
                    </Link>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          onClick={() => router.push("/matters?tab=intake&new=1")}
          className="h-8 gap-1.5 px-2.5 text-[13px]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="hidden sm:inline">新建收案</span>
        </Button>

        <div className="mx-0.5 hidden h-6 w-px bg-border sm:block" />

        <NotificationPopover />
      </div>

      {/* 用户 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex h-[34px] items-center gap-2 rounded-full border border-input bg-card pl-1 pr-2.5 shadow-[var(--shadow-low)]",
              "transition-colors hover:bg-muted"
            )}
          >
            <Avatar className="h-6 w-6">
              {userAvatar ? <AvatarImage src={userAvatar} alt={displayName} /> : null}
              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-[13px] font-medium sm:inline">{displayName || "..."}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {displayName ? `${displayName} · ${roleLabel}` : "加载中..."}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/profile" className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              个人信息
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <SettingsIcon className="mr-2 h-4 w-4" />
              偏好设置
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              signOut({ callbackUrl: "/login" });
            }}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} />
    </header>
  );
}
