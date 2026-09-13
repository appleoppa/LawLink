/**
 * 墨案 04 ② 信号条：固定四卡——最近期限 / 下次开庭 / 收费进度 / 本环节任务。
 * 无数据时保留卡位并给出空态说明，避免版面随数据跳动。
 * 配色纪律：红只属于 3 天内或已逾期的期限；开庭用蓝；收费 teal；任务琥珀。
 */
import { deadlineCategoryLabel } from "@/lib/enums";
import { deadlineRisk } from "@/lib/ui/moan-tones";
import { RiskLadder } from "@/components/patterns/moan";
import { cn } from "@/lib/utils";

type SignalProcedure = {
  deadlines: { id: string; title: string; category: keyof typeof deadlineCategoryLabel; dueAt: Date; completed: boolean; basis: string | null; confirmStatus?: string; sourceRuleId?: string | null }[];
  hearings: { id: string; title: string; startsAt: Date; room: string | null }[];
  stages: { status: string; tasks: { title: string; completed: boolean; dueAt: Date | null }[] }[];
};

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dayDiff(date: Date) {
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(date);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function MatterSignalStrip({
  procedures,
  allProcedures,
  finance,
  invoicePending
}: {
  /** 当前程序（信号以当前程序为准） */
  procedures: SignalProcedure[];
  allProcedures: SignalProcedure[];
  finance: { contractAmount: number; received: number; receivable: number; invoiced: number } | null;
  invoicePending: number;
}) {
  const deadlines = procedures
    .flatMap((p) => p.deadlines)
    .filter((d) => !d.completed)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const nearest = deadlines[0] ?? null;
  const nDays = nearest ? dayDiff(nearest.dueAt) : null;
  const risk = deadlineRisk(nDays);
  const pendingConfirm = allProcedures.flatMap((p) => p.deadlines).filter((d) => d.confirmStatus === "PENDING").length;

  const hearing = allProcedures
    .flatMap((p) => p.hearings)
    .filter((h) => new Date(h.startsAt).getTime() >= Date.now() - 2 * 3600_000)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;
  const hDays = hearing ? dayDiff(hearing.startsAt) : null;

  const tasks = procedures.flatMap((p) => p.stages.filter((s) => s.status !== "HIDDEN").flatMap((s) => s.tasks));
  const openTasks = tasks.filter((t) => !t.completed);
  const overdueTasks = openTasks.filter((t) => t.dueAt && dayDiff(t.dueAt) < 0);
  const nextTask = [...openTasks].sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))[0];

  const hot = nDays !== null && nDays <= 3;
  const percent = finance && finance.contractAmount > 0 ? Math.min(100, Math.round((finance.received / finance.contractAmount) * 100)) : 0;

  return (
    <div className="signal-strip">
      <div className={cn("card signal", hot && "hot")}>
        <div className="signal-label">
          <span className={cn("dot", nearest ? (risk.tone === "red" ? "dot-red dot-pulse-red" : risk.tone === "amber" ? "dot-amber" : "dot-blue") : "dot-slate")} />
          <span className="truncate">{nearest ? `${nearest.title}（${deadlineCategoryLabel[nearest.category] ?? "期限"}）` : "最近期限"}</span>
        </div>
        {nearest && nDays !== null ? (
          <>
            <div className="signal-main">
              <span className="signal-num" style={{ color: risk.tone === "red" ? "var(--red)" : risk.tone === "amber" ? "var(--amber)" : "var(--t-primary)" }}>
                {nDays < 0 ? Math.abs(nDays) : nDays}
              </span>
              <span className="signal-unit">
                {nDays < 0 ? "天 · 已逾期" : "天"} · {new Date(nearest.dueAt).getMonth() + 1}月{new Date(nearest.dueAt).getDate()}日 {hhmm(new Date(nearest.dueAt))}
              </span>
            </div>
            <div className="signal-sub truncate">
              {[nearest.confirmStatus === "PENDING" ? "规则推算 · 待确认" : nearest.sourceRuleId ? "规则推算" : null, nearest.basis, pendingConfirm > 1 ? `共 ${pendingConfirm} 项待确认` : null].filter(Boolean).join(" · ") || `未完成期限 ${deadlines.length} 项`}
            </div>
            <RiskLadder level={risk.level} tone={risk.tone} label={`期限紧迫度 ${risk.level}/4`} />
          </>
        ) : (
          <>
            <div className="signal-main">
              <span className="signal-num t-faint">—</span>
            </div>
            <div className="signal-sub">当前程序暂无未完成期限</div>
          </>
        )}
      </div>

      <div className="card signal">
        <div className="signal-label">
          <span className={cn("dot", hearing ? "dot-blue" : "dot-slate")} />
          下次开庭
        </div>
        {hearing && hDays !== null ? (
          <>
            <div className="signal-main">
              <span className="signal-num" style={{ color: "var(--blue)" }}>
                {new Date(hearing.startsAt).getMonth() + 1}-{new Date(hearing.startsAt).getDate()}
              </span>
              <span className="signal-unit">
                {WEEK[new Date(hearing.startsAt).getDay()]} {hhmm(new Date(hearing.startsAt))}
              </span>
            </div>
            <div className="signal-sub truncate">{[hearing.room, hearing.title].filter(Boolean).join(" · ")}</div>
            <RiskLadder level={hDays <= 3 ? 3 : hDays <= 7 ? 2 : 1} tone="blue" label={`距开庭 ${hDays} 天`} />
          </>
        ) : (
          <>
            <div className="signal-main">
              <span className="signal-num t-faint">—</span>
            </div>
            <div className="signal-sub">暂无排期</div>
          </>
        )}
      </div>

      <div className="card signal">
        <div className="signal-label">
          <span className="dot dot-teal" />
          收费进度
        </div>
        {finance ? (
          finance.contractAmount > 0 || finance.received > 0 ? (
            <>
              <div className="signal-main">
                <span className="signal-num">¥{finance.received.toLocaleString("zh-CN")}</span>
                <span className="signal-unit">/ ¥{finance.contractAmount.toLocaleString("zh-CN")}</span>
              </div>
              <div className="progress" style={{ marginTop: 2 }}>
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="signal-foot">{invoicePending > 0 ? `应收未开票 ¥${invoicePending.toLocaleString("zh-CN")}` : `回款 ${percent}%`}</div>
            </>
          ) : (
            <>
              <div className="signal-main">
                <span className="signal-num t-faint">—</span>
              </div>
              <div className="signal-sub">尚未登记合同收费</div>
            </>
          )
        ) : (
          <>
            <div className="signal-main">
              <span className="signal-num t-faint">—</span>
            </div>
            <div className="signal-sub">无财务查看权限</div>
          </>
        )}
      </div>

      <div className="card signal">
        <div className="signal-label">
          <span className={cn("dot", overdueTasks.length > 0 ? "dot-red" : "dot-amber")} />
          本环节任务
        </div>
        <div className="signal-main">
          <span className="signal-num" style={{ color: openTasks.length > 0 ? "var(--amber)" : "var(--t-faint)" }}>{openTasks.length}</span>
          <span className="signal-unit">项待办{overdueTasks.length > 0 ? ` · 逾期 ${overdueTasks.length}` : ""}</span>
        </div>
        <div className="signal-sub truncate">{nextTask ? nextTask.title : tasks.length > 0 ? "本程序任务均已完成" : "暂无任务"}</div>
        <div className="signal-foot">逾期任务自动进入工作台「今日行动」</div>
      </div>
    </div>
  );
}
