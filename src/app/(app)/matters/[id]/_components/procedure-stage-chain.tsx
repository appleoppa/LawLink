/**
 * 程序链（墨案 04 效果图）：当前程序的环节横向节点链。
 * 节点态：✓ 已完成（teal，带完成日期）/ ● 当前环节（呼吸环）/ ! 当前环节存在逾期任务（琥珀）/ 序号 未来。
 * 展示型组件，不改环节选择；环节操作仍在下方工作台。
 */
import { cn } from "@/lib/utils";

type StageLike = {
  id: string;
  name: string;
  order: number;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  tasks: { dueAt: Date | null; completed: boolean }[];
};

function mmdd(d: Date | null) {
  if (!d) return "—";
  const date = new Date(d);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ProcedureStageChain({
  procedure
}: {
  procedure: { id: string; stages: StageLike[] } | null;
}) {
  if (!procedure) return null;
  const stages = [...procedure.stages]
    .filter((s) => s.status !== "HIDDEN")
    .sort((a, b) => a.order - b.order);
  // 单环节程序没有链式语义，隐藏（工作台内已有该环节内容）
  if (stages.length < 2) return null;

  const now = Date.now();
  const firstOpenIdx = stages.findIndex((s) => !s.completedAt);
  const hasOverdue = (s: StageLike) =>
    s.tasks.some((t) => t.dueAt && !t.completed && t.dueAt.getTime() < now);

  return (
    <section className="ll-surface overflow-hidden" aria-label="环节链">
      <div className="flex items-center gap-2 px-5 pb-1 pt-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          环节链
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">
          按顺序推进；当前环节的期限与任务在下方工作台处理
        </span>
      </div>
      <div className="overflow-x-auto px-5 pb-3.5 pt-1">
        <div className="chain min-w-fit">
          {stages.map((s, i) => {
            const done = firstOpenIdx >= 0 && i < firstOpenIdx;
            const current = i === firstOpenIdx;
            const risk = current && hasOverdue(s);
            return (
              <div key={s.id} className="contents">
                {i > 0 && <div className={cn("chain-line", done && "done")} />}
                <div
                  className={cn(
                    "chain-node",
                    done && "done",
                    current && (risk ? "risk" : "current")
                  )}
                >
                  <div className="chain-dot">
                    {done ? "✓" : current ? (risk ? "!" : "●") : i + 1}
                  </div>
                  <div className="chain-label" title={s.name}>
                    {s.name}
                  </div>
                  <div className="chain-date">{done ? mmdd(s.completedAt) : current ? mmdd(s.startedAt) : "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
