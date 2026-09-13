import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderOpen,
  FolderInput,
  Users,
  Wallet,
  Calendar,
  ClipboardCheck,
  Inbox,
  Archive,
  Settings,
  BarChart3,
  ScanSearch
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  tone?: "courtSms";
};

// 墨案 02 效果图侧栏信息架构：工作区 / 业务 / 知识 三段 + 底部资料
// v0.4 曾把收案并入案件、冲突检索移顶栏；按效果图恢复一级入口（顶栏冲突入口保留）
export const primaryNav: NavItem[] = [
  { label: "概览", href: "/", icon: LayoutDashboard },
  { label: "案件", href: "/matters", icon: FolderOpen },
  { label: "收案", href: "/intakes", icon: FolderInput },
  { label: "审批", href: "/approvals", icon: ClipboardCheck },
  { label: "冲突检索", href: "/conflicts", icon: ScanSearch },
  { label: "日程", href: "/schedule", icon: Calendar }
];

export const businessNav: NavItem[] = [
  { label: "客户", href: "/clients", icon: Users },
  { label: "财务", href: "/finance", icon: Wallet }
];

export const knowledgeNav: NavItem[] = [
  { label: "归档", href: "/archive", icon: Archive },
  { label: "报表", href: "/reports", icon: BarChart3 }
];

export const secondaryNav: NavItem[] = [
  { label: "法院短信", href: "/inbox", icon: Inbox, tone: "courtSms" },
  { label: "个人设置", href: "/settings", icon: Settings }
];
