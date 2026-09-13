"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

type CategoryItem = { name: string; value: number; code: string; color: string };

export function CategoryChart({ data }: { data: CategoryItem[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="ll-surface flex h-full min-h-[280px] flex-col">
      <header className="ll-panel-head">
        <h2 className="ll-panel-title">案件类型分布</h2>
      </header>

      <div className="grid flex-1 grid-cols-5 items-center gap-3 p-4">
        <div className="relative col-span-2 h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={3}
                stroke="hsl(var(--card))"
                strokeWidth={3}
              >
                {data.map((entry) => (
                  <Cell key={entry.code} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="ll-stat text-[2rem] leading-none text-foreground">
              {total}
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">总数</span>
          </div>
        </div>

        <ul className="col-span-3 space-y-0">
          {data.map((cat) => {
            const pct = Math.round((cat.value / total) * 100);
            return (
              <li
                key={cat.code}
                className="ll-row flex items-center gap-2.5 rounded-md px-2.5 py-1.5"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="flex-1 truncate text-[0.82rem]">{cat.name}</span>
                <span className="font-mono text-xs tabular text-muted-foreground">
                  {cat.value}
                </span>
                <span className="w-9 text-right font-mono text-xs tabular text-muted-subtle">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
