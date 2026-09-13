"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  active: "pending" | "approved";
  pendingCount: number;
}

export function ArchiveTabs({ active, pendingCount }: Props) {
  return (
    <div className="ll-segmented w-fit">
      <Tab href="/archive?tab=pending" active={active === "pending"}>
        待审批
        {pendingCount > 0 && (
          <span
            className={cn(
              "ml-1 font-mono text-[11px] tabular opacity-60"
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
        "ll-seg shrink-0",
        active && "ll-seg-active text-primary"
      )}
    >
      {children}
    </Link>
  );
}
