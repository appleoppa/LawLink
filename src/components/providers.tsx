"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppMotionProvider } from "@/components/patterns/app-motion-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppMotionProvider>
        {/*
          delayDuration：首次悬停延迟，防止扫过工具栏时误触发。
          skipDelayDuration：一个 tooltip 关闭后的这段时间内，相邻 tooltip 立即打开，
          让整条工具栏「跟手」，同时不牺牲首次延迟的防误触作用。
        */}
        <TooltipProvider delayDuration={300} skipDelayDuration={200}>
          {children}
        </TooltipProvider>
        <Toaster />
      </AppMotionProvider>
    </SessionProvider>
  );
}
