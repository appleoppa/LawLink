import type { LucideIcon } from "lucide-react";
import {
  House,
  Folder,
  ArrowDownToLine,
  SquareCheck,
  Clock3,
  CalendarDays,
  Users,
  CreditCard,
  Archive,
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

// 墨案 02 效果图侧栏信息架构：工作区 / 业务 / 知识；效果图外的既有入口收在「资料」段
export const primaryNav: NavItem[] = [
  { label: "工作台", href: "/", icon: House },
  { label: "案件", href: "/matters", icon: Folder, countKey: "matters" },
  { label: "收案", href: "/intakes", icon: ArrowDownToLine, countKey: "intakes" },
  { label: "审批", href: "/approvals", icon: SquareCheck, countKey: "approvals" },
  { label: "冲突检索", href: "/conflicts", icon: Clock3 },
  { label: "日程", href: "/schedule", icon: CalendarDays }
];

export const businessNav: NavItem[] = [
  { label: "客户", href: "/clients", icon: Users, countKey: "clients" },
  { label: "财务", href: "/finance", icon: CreditCard }
];

export const knowledgeNav: NavItem[] = [
  { label: "归档", href: "/archive", icon: Archive },
  { label: "报表", href: "/reports", icon: ChartColumn }
];

export const resourceNav: NavItem[] = [{ label: "法院短信", href: "/inbox", icon: Inbox }];

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
