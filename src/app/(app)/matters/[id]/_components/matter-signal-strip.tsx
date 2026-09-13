/**
 * 案件信号条（墨案 · MatterWorkspace 母版，批次③）。
 * 风险信号置顶：逾期期限（红·阻断）、待确认期限（琥珀）、近 7 天开庭（蓝）、
 * 待我处理审批（琥珀）。无信号时显示绿色"无风险信号"终态条。
 * 配色纪律：红仅逾期/阻断；绿仅"无风险"终态。
 */
import { AlertTriangle, BellRing, CircleCheck, Clock, Gavel } from "lucide-react";
import Link from "next/link";

export interface MatterSignal {
  kind: "overdue" | "pending-confirm" | "hearing-soon" | "approval";
  label: string;
  href?: string;
}

export function MatterSignalStrip({ signals }: { signals: MatterSignal[] }) {
  if (signals.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]"
           style={{ borderColor: "#C4E3CE", background: "#E7F3EA", color: "#1A7F45" }}>
        <CircleCheck className="h-4 w-4" />
        无风险信号：本案当前没有逾期期限、待确认期限与临近开庭
      </div>
    );
  }
  const style: Record<MatterSignal["kind"], { border: string; bg: string; color: string; icon: typeof Clock }> = {
    overdue: { border: "#F0C6BF", bg: "#FBECE9", color: "#B42318", icon: AlertTriangle },
    "pending-confirm": { border: "#EBD8AB", bg: "#FAF0DB", color: "#96650B", icon: BellRing },
    "hearing-soon": { border: "#C3D2F0", bg: "#E9EEFA", color: "#1E56C8", icon: Gavel },
    approval: { border: "#EBD8AB", bg: "#FAF0DB", color: "#96650B", icon: Clock }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {signals.map((s, i) => {
        const st = style[s.kind];
        const Icon = st.icon;
        const content = (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium"
            style={{ borderColor: st.border, background: st.bg, color: st.color }}
          >
            <Icon className="h-3.5 w-3.5" />
            {s.label}
          </span>
        );
        return s.href ? (
          <Link key={i} href={s.href} className="transition-opacity hover:opacity-80">{content}</Link>
        ) : (
          <span key={i}>{content}</span>
        );
      })}
    </div>
  );
}
