"use client";

/** 墨案 02 / 08：近 6 个月实收（teal 面积）与应收（灰虚线） */
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";

export function RevenueChart({ data, height = 196 }: { data: { month: string; received: number; receivable: number }[]; height?: number }) {
  const empty = data.every((d) => !d.received && !d.receivable);
  return (
    <div className="card flex h-full flex-col">
      <div className="panel-head">
        <div className="panel-title">
          <LineChartIcon className="ic" strokeWidth={1.8} />
          近 6 个月实收与应收
        </div>
        <div className="flex gap-3.5">
          <span className="t-xs t-mute flex items-center gap-[5px]"><span className="legend-line" style={{ background: "var(--teal)" }} />实收</span>
          <span className="t-xs t-mute flex items-center gap-[5px]"><span className="legend-line" style={{ background: "var(--t-faint)", opacity: 0.7 }} />应收</span>
        </div>
      </div>
      <div className="flex-1" style={{ padding: "14px 16px 16px", minHeight: height }}>
        {empty ? (
          <div className="empty mo-empty-compact h-full">
            <div className="mo-empty-title">近 6 个月暂无收付记录</div>
            <div className="mo-empty-desc">登记应收与到账后，这里显示实收与应收趋势。</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="mo-fill-teal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#007B7F" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="#007B7F" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" stroke="#E8ECEA" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#98A3AD", fontSize: 10.5, fontFamily: "SF Mono, ui-monospace, monospace" }} axisLine={false} tickLine={false} dy={6} />
              <YAxis tick={{ fill: "#98A3AD", fontSize: 10.5, fontFamily: "SF Mono, ui-monospace, monospace" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 1000)}K` : String(v))} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #DDE3E0", borderRadius: 10, fontSize: 12, boxShadow: "0 12px 32px -8px rgba(12,25,39,0.16)" }}
                formatter={(v) => `¥${Number(v).toLocaleString("zh-CN")}`}
              />
              <Area type="linear" dataKey="receivable" name="应收" stroke="#A8B2B8" strokeWidth={1.4} strokeDasharray="4 4" fill="none" />
              <Area type="linear" dataKey="received" name="实收" stroke="#007B7F" strokeWidth={2.2} fill="url(#mo-fill-teal)" dot={false} activeDot={{ r: 4, fill: "#007B7F" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
