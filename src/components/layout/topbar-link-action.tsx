"use client";

/** 服务端页面注册顶栏主操作（跳转型），如客户详情「为此客户新建收案」。 */
import { useRouter } from "next/navigation";
import { useTopbarAction } from "./topbar-action";

export function TopbarLinkAction({ label, href }: { label: string; href: string | null }) {
  const router = useRouter();
  useTopbarAction(href ? { label, onClick: () => router.push(href) } : "none", [label, href]);
  return null;
}
