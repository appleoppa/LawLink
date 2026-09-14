"use client";

/**
 * 管理后台页头（墨案 12 效果图 page-head）：面包屑「设置 › 分组 › 页面」+ 标题 + 说明 + 右侧操作。
 * 分组按标题在 adminNavigation 中反查（页面标题与导航名称保持一致），页面无需各自维护面包屑。
 */
import { adminNavigation } from "@/components/layout/admin-shell";
import { PageHeader } from "@/components/patterns/moan";

export function AdminPageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  const group = adminNavigation.find((g) => g.label !== "概览" && g.items.some((i) => i.label === title));
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
