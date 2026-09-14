"use client";

/**
 * 管理后台页头（墨案 12 效果图 page-head）：面包屑「设置 › 分组 › 页面」+ 标题 + 说明 + 右侧操作。
 * 分组由当前路径在 adminNavigation 中反查，页面无需各自维护面包屑。
 */
import { usePathname } from "next/navigation";
import { adminNavigation } from "@/components/layout/admin-shell";
import { PageHeader } from "@/components/patterns/moan";

export function AdminPageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const group = adminNavigation.find((g) => g.items.some((i) => i.href !== "/admin" && (pathname === i.href || pathname.startsWith(`${i.href}/`))));
  return (
    <PageHeader
      className="!mb-0"
      breadcrumb={<>设置{group ? <> › {group.label}</> : null} › <b>{title}</b></>}
      title={title}
      sub={sub}
      actions={actions}
    />
  );
}
