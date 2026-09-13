/**
 * 工作台行动入口（墨案批次④ · 02 效果图 action-grid）。
 * 四格：待我处理（红）/ 近 7 天期限（琥珀）/ 本周开庭（蓝）/ 逾期期限（红数）。
 * 配色纪律：红仅风险/阻断；blue 进行中；琥珀临近。
 */
import Link from "next/link";
import { CheckCircle2, Gavel, Timer, TriangleAlert, ChevronRight } from "lucide-react";

export interface DashboardActionTilesData {
  pendingSealCount: number;
  nearTermCount: number;
  weekHearingCount: number;
  overdueDeadlineCount: number;
}

const TILE_STYLE = {
  pending: { bg: "#FBECE9", color: "#B42318" },
  deadlines: { bg: "#FAF0DB", color: "#96650B" },
  hearings: { bg: "#E9EEFA", color: "#1E56C8" },
  overdue: { bg: "#FBECE9", color: "#B42318" }
} as const;

export function DashboardActionTiles({ data }: { data: DashboardActionTilesData }) {
  const tiles = [
    {
      href: "/seals",
      icon: CheckCircle2,
      style: TILE_STYLE.pending,
      num: String(data.pendingSealCount),
      label: "待审批用章"
    },
    {
      href: "/schedule",
      icon: Timer,
      style: TILE_STYLE.deadlines,
      num: String(data.nearTermCount),
      label: "近 7 天到期期限"
    },
    {
      href: "/schedule",
      icon: Gavel,
      style: TILE_STYLE.hearings,
      num: String(data.weekHearingCount),
      label: "本周开庭"
    },
    {
      href: "/schedule",
      icon: TriangleAlert,
      style: TILE_STYLE.overdue,
      num: String(data.overdueDeadlineCount),
      label: "逾期期限" + (data.overdueDeadlineCount > 0 ? " · 需立即处理" : "")
    }
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href}
            className="group/tile flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-shadow hover:shadow-md"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: t.style.bg, color: t.style.color }}
            >
              <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-xl leading-6 tabular" style={{ color: t.style.color }}>
                {t.num}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{t.label}</span>
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover/tile:translate-x-0.5" strokeWidth={2} />
          </Link>
        );
      })}
    </div>
  );
}
