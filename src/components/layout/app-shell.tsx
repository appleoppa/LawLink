"use client";

import { useState } from "react";
import { Sidebar, type FirmBrand } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";
import { ToolsDialog } from "./tools-dialog";
import { TopbarActionProvider } from "./topbar-action";

export function AppShell({
  children,
  banner,
  firm,
  userAvatar
}: {
  children: React.ReactNode;
  /** v0.27: 顶部公告 banner（服务端渲染好后注入） */
  banner?: React.ReactNode;
  /** v0.42 项1: 侧栏品牌（律所名 / 副标题 / Logo） */
  firm: FirmBrand;
  /** v0.43: 当前用户头像（服务端读最新，供顶栏显示） */
  userAvatar?: string | null;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <TopbarActionProvider>
      <div className="min-h-screen bg-[var(--bg-canvas)]">
        <Sidebar firm={firm} onOpenTools={() => setToolsOpen(true)} />
        <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} firm={firm} onOpenTools={() => setToolsOpen(true)} />
        <div className="md:pl-[228px]">
          <Topbar onMobileMenuToggle={() => setMobileNavOpen(true)} userAvatar={userAvatar ?? null} />
          {banner}
          {/* 墨案 .content：20px 24px 48px，最宽 1440 */}
          <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-5 sm:px-6">{children}</main>
        </div>
        <ToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} />
      </div>
    </TopbarActionProvider>
  );
}
