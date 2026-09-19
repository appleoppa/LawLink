import type { LucideIcon } from "lucide-react";
import {
  House,
  Folder,
  SquareCheck,
  CalendarDays,
  Users,
  CreditCard,
  ChartColumn,
  Inbox,
  Calculator,
  Package,
  FolderArchive,
  Contact,
  Compass,
  Megaphone,
  BookText
} from "lucide-react";
import type { NavCounts } from "@/server/layout/nav-counts";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  countKey?: keyof NavCounts;
};

/**
 * 侧栏两组（2026-09-18 用户确认）：
 * 「办案」＝跟着具体案件走的动线，「经营」＝跟所、客户、钱走的事。
 * 判断归属看新功能是围绕某一件案件，还是围绕律所整体。工具抽屉「更多应用」不在导航列表里，固定在底部。
 */
export const caseNav: NavItem[] = [
  { label: "工作台", href: "/", icon: House },
  { label: "案件", href: "/matters", icon: Folder, countKey: "matters" },
  { label: "审批", href: "/approvals", icon: SquareCheck, countKey: "approvals" },
  { label: "日程", href: "/schedule", icon: CalendarDays },
  { label: "法院短信", href: "/inbox", icon: Inbox }
];

export const firmNav: NavItem[] = [
  { label: "客户", href: "/clients", icon: Users, countKey: "clients" },
  { label: "财务", href: "/finance", icon: CreditCard },
  { label: "报表", href: "/reports", icon: ChartColumn }
];

// 原顶栏「应用」聚合入口：实务工具=全局弹窗；法律导航=外链；其余为独立页
export const APP_ITEMS: { label: string; icon: LucideIcon; kind: "tools" | "link" | "external"; href?: string }[] = [
  { label: "实务工具", icon: Calculator, kind: "tools" },
  { label: "快递跟踪", href: "/express", icon: Package, kind: "link" },
  { label: "律所文书", href: "/firm-resources", icon: FolderArchive, kind: "link" },
  { label: "公告指引", href: "/announcements", icon: Megaphone, kind: "link" },
  { label: "制度规范", href: "/policy", icon: BookText, kind: "link" },
  { label: "通讯录", href: "/contacts", icon: Contact, kind: "link" },
  { label: "法律导航", href: "https://yesen.cn", icon: Compass, kind: "external" }
];
