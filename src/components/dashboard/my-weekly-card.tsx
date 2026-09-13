import { Briefcase, CheckCircle2, Archive, Wallet } from "lucide-react";
import type { LawyerWeeklyDigest } from "@/server/reports/weekly";

export function MyWeeklyCard({ digest }: { digest: LawyerWeeklyDigest }) {
  const items = [
    { label: "新收", value: digest.newIntake, color: "#1E56C8", Icon: Briefcase },
    { label: "已结", value: digest.closed, color: "#1A7F45", Icon: CheckCircle2 },
    { label: "已归档", value: digest.archived, color: "#6C3FC5", Icon: Archive },
    {
      label: "收款（元）",
      value: digest.receivedAmount.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
      color: "#96650B",
      Icon: Wallet
    }
  ];

  return (
    <section className="card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium">{digest.userName} · 本周摘要</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{digest.period.label}</span>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(({ label, value, color, Icon }) => (
          <div key={label} className="rounded border border-border bg-background px-2 py-2">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Icon className="h-3 w-3" style={{ color }} strokeWidth={1.8} />
              {label}
            </div>
            <div className="mt-1 font-mono text-base tabular text-foreground">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
