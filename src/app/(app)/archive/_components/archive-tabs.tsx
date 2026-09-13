"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  active: "pending" | "approved";
  pendingCount: number;
}

export function ArchiveTabs({ active, pendingCount }: Props) {
  return (
    <div className="border-b border-border/60 flex items-end gap-1 text-sm">
      <Tab href="/archive?tab=pending" active={active === "pending"}>
        待审批
        {pendingCount > 0 && (
          <span
            className={cn(
              "ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]",
              active === "pending"
                ? "bg-[#9B7BF7] text-white"
                : "bg-amber-500/20 text-amber-700"
            )}
          >
            {pendingCount}
          </span>
        )}
      </Tab>
      <Tab href="/archive" active={active === "approved"}>
        已归档
      </Tab>
    </div>
  );
}

function Tab({
  href,
  active,
  children
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "px-3 py-2 -mb-px border-b-2 transition-colors",
        active
          ? "border-[#9B7BF7] text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
