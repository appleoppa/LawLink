"use client";

import { useState } from "react";
import { Scale, Coins, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { CourtFeeCalc } from "./court-fee-calc";
import { LateInterestCalc } from "./late-interest-calc";
import { DaysCalc } from "./days-calc";
import { PageHeader } from "@/components/patterns/moan";

type Tab = "courtFee" | "lateInterest" | "days";

const TABS: { key: Tab; label: string; icon: typeof Scale }[] = [
  { key: "courtFee", label: "诉讼费", icon: Scale },
  { key: "lateInterest", label: "迟延履行金", icon: Coins },
  { key: "days", label: "天数计算", icon: CalendarDays }
];

export function CalcView({ hideHeader }: { hideHeader?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>("courtFee");

  return (
    <div className="space-y-5">
      {/* 标题（应用页内嵌时由 tab 标注，隐藏）*/}
      {!hideHeader && (
        <PageHeader className="!mb-0" title="实务工具" sub="诉讼费 / 迟延履行金 / 天数 —— 纯前端速算，无需联网" />
      )}

      {/* Tab */}
      <div className="border-b border-border">
        <div className="flex gap-5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 pb-2.5 pt-1 text-[13px] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t.label}
                {active && (
                  <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* tab 切换是高频操作，入场动画只会让它显得迟钝，故不加动效 */}
      <div key={tab} className="max-w-3xl">
        {tab === "courtFee" && <CourtFeeCalc />}
        {tab === "lateInterest" && <LateInterestCalc />}
        {tab === "days" && <DaysCalc />}
      </div>
    </div>
  );
}
