/** 墨案 02：案件类型分布（环形图 + 图例），纯 SVG */
type CategoryItem = { name: string; value: number; code: string; color: string };

const PALETTE = ["#007B7F", "#1E56C8", "#8A6B3E", "#96650B", "#6C3FC5", "#4A5560", "#1A7F45", "#B4BFB9"];

export function CategoryChart({ data }: { data: CategoryItem[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const C = 2 * Math.PI * 44;
  let offset = 0;
  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>案件类型分布</div>
        <span className="t-xs t-mute">在办 {total} 件</span>
      </div>
      {total === 0 ? (
        <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无在办案件</div></div>
      ) : (
        <div style={{ padding: "12px 16px 14px", display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="92" height="92" viewBox="0 0 120 120" style={{ flexShrink: 0 }} role="img" aria-label={`在办 ${total} 件`}>
            <circle cx="60" cy="60" r="44" fill="none" stroke="#E9EDEB" strokeWidth="13" />
            {data.map((d, i) => {
              const len = (d.value / total) * C;
              const el = (
                <circle key={d.code} cx="60" cy="60" r="44" fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="13" strokeDasharray={`${Math.max(0, len - 1)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />
              );
              offset += len;
              return el;
            })}
            <text x="60" y="58" textAnchor="middle" fontFamily="SF Mono, ui-monospace, monospace" fontSize="21" fontWeight="600" fill="#0C1927">{total}</text>
            <text x="60" y="73" textAnchor="middle" fontSize="9" fill="#68747F">在办</text>
          </svg>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            {data.map((d, i) => (
              <div key={d.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="t-sm truncate" style={{ flex: 1 }}>{d.name}</span>
                <span className="num-sm t-mute">{d.value} · {Math.round((d.value / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
