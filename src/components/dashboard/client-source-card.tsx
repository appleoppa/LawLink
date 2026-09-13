import Link from "next/link";
import { Users } from "lucide-react";

/** 墨案 02：客户来源渠道分布（近 12 个月新建客户，P0-1 第三步） */
export function ClientSourceCard({ rows }: { rows: { source: string; count: number }[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = rows.slice(0, 5);
  const shades = ["#007B7F", "#33989B", "#7FBDBE", "#A9D2D2", "#C9E3E2"];
  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <Users className="ic" strokeWidth={1.8} />
          客户来源渠道分布
        </div>
        <span className="t-xs t-mute">近 12 个月 · 新收 {total}</span>
      </div>
      {total === 0 ? (
        <div className="empty mo-empty-compact">
          <div className="mo-empty-title">暂无新建客户</div>
          <div className="mo-empty-desc">建档时登记「客户来源」后，这里显示来源渠道分布。</div>
        </div>
      ) : (
        <div className="panel-body">
          {top.map((r, i) => (
            <div key={r.source} className="mini-bar">
              <span className="name truncate" title={r.source}>{r.source}</span>
              <span className="track"><span className="fill block" style={{ width: `${Math.max(4, (r.count / total) * 100)}%`, background: shades[i] }} /></span>
              <span className="val">{r.count} · {Math.round((r.count / total) * 100)}%</span>
            </div>
          ))}
          <Link href="/reports" className="t-xs t-mute mt-2 inline-block hover:text-[var(--teal-deep)]">查看所级来源报表 →</Link>
        </div>
      )}
    </div>
  );
}
