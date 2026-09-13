/**
 * 案件信号条（墨案 · MatterWorkspace 母版，对齐 docs/mockup/v4/04 信号条四卡式）。
 * 每个信号一张卡：标签 + 大数字（等宽）+ 副文案 + 风险阶梯四级条。
 * 配色纪律：红仅逾期/阻断（热卡浅红底）；绿仅"无风险"终态。
 */
import { BellRing, CircleDollarSign, Clock, Gavel, ListChecks } from "lucide-react";
import Link from "next/link";

export interface MatterSignal {
  kind: "overdue" | "pending-confirm" | "hearing-soon" | "approval" | "finance" | "tasks";
  /** 卡片标签（如"最近逾期期限"） */
  label: string;
  /** 大数字（天数/项数等）；缺省时仅显示文字卡 */
  count?: number;
  /** 金额型大数字（如 ¥1,188,000），优先于 count 展示 */
  amount?: string;
  /** 数字单位（天前 / 项 / 次等） */
  unit?: string;
  /** 副文案（案件内具体事项） */
  sub?: string;
  /** 回款进度 0-100（finance 卡渲染进度条） */
  progress?: number;
  href?: string;
}

/** 风险阶梯：四级紧迫度小条（红=逾期全亮 / 琥珀=临期 3 档 / 蓝=关注 2 档）；finance/tasks 非风险不带阶梯 */
function SignalLadder({ kind }: { kind: MatterSignal["kind"] }) {
  if (kind === "approval" || kind === "finance" || kind === "tasks") return null;
  const ladder: { cls: string; on: number }[] = [
    { cls: "l-red", on: 4 },
    { cls: "l-amber", on: 3 },
    { cls: "l-blue", on: 2 }
  ];
  const map: Record<Exclude<MatterSignal["kind"], "approval" | "finance" | "tasks">, number> = {
    overdue: 0,
    "pending-confirm": 1,
    "hearing-soon": 2
  };
  const { cls, on } = ladder[map[kind]];
  return (
    <span className={`ladder ${cls}`} aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <i key={i} className={i < on ? "on" : undefined} />
      ))}
    </span>
  );
}

const cardStyle: Record<
  MatterSignal["kind"],
  { color: string; hot?: boolean; icon: typeof Clock; dotPulse?: boolean }
> = {
  overdue: { color: "#B42318", hot: true, icon: Clock, dotPulse: true },
  "pending-confirm": { color: "#96650B", icon: BellRing, dotPulse: true },
  "hearing-soon": { color: "#1E56C8", icon: Gavel },
  approval: { color: "#96650B", icon: Clock },
  finance: { color: "#007B7F", icon: CircleDollarSign },
  tasks: { color: "#96650B", icon: ListChecks }
};

export function MatterSignalStrip({ signals }: { signals: MatterSignal[] }) {
  if (signals.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]"
           style={{ borderColor: "#C4E3CE", background: "#E7F3EA", color: "#1A7F45" }}>
        <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: "#1A7F45" }} />
        无风险信号：本案当前没有逾期期限、待确认期限与临近开庭
      </div>
    );
  }
  // 墨案 04 信号条固定四卡一行；风险卡由页面按优先级推入，超出四张截断（finance/tasks 排最后）
  const shown = signals.slice(0, 4);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {shown.map((s, i) => {
        const st = cardStyle[s.kind];
        const Icon = st.icon;
        const card = (
          <div
            className="ll-surface relative flex min-w-0 flex-col gap-2 overflow-hidden px-4 py-3"
            style={
              st.hot
                ? { borderColor: "#F0C6BF", background: "linear-gradient(180deg, #FFFFFF 55%, #FBECE9 165%)" }
                : undefined
            }
          >
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${st.dotPulse ? "ll-dot-pulse" : ""}`}
                style={{ background: st.color, ...(st.dotPulse ? { boxShadow: `0 0 0 3px ${st.color}29` } : {}) }}
              />
              <span className="truncate">{s.label}</span>
              <Icon className="ml-auto h-3.5 w-3.5 shrink-0" style={{ color: st.color }} strokeWidth={1.8} />
            </div>
            {s.amount ? (
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-mono text-[22px] font-semibold leading-none tabular"
                  style={{ color: st.color, letterSpacing: "-0.02em" }}
                >
                  {s.amount}
                </span>
                {s.unit ? <span className="font-mono text-[11px] text-muted-foreground tabular">{s.unit}</span> : null}
              </div>
            ) : typeof s.count === "number" ? (
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-mono text-[22px] font-semibold leading-none tabular"
                  style={{ color: st.color, letterSpacing: "-0.02em" }}
                >
                  {s.count}
                </span>
                {s.unit ? <span className="text-[11px] text-muted-foreground">{s.unit}</span> : null}
              </div>
            ) : null}
            {s.sub ? (
              <div className="truncate text-[11px] leading-relaxed text-muted-foreground" title={s.sub}>
                {s.sub}
              </div>
            ) : null}
            <div className="mt-auto">
              {s.kind === "finance" && typeof s.progress === "number" ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#EDF1EF]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, s.progress))}%`, background: "#007B7F" }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>回款进度</span>
                    <span className="font-mono tabular">{s.progress}%</span>
                  </div>
                </>
              ) : (
                <SignalLadder kind={s.kind} />
              )}
            </div>
          </div>
        );
        return s.href ? (
          <Link key={i} href={s.href} className="transition-opacity hover:opacity-85">{card}</Link>
        ) : (
          <div key={i}>{card}</div>
        );
      })}
    </div>
  );
}
