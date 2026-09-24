/**
 * 墨案跨页面模式（docs/mockup/v4/design-system.css 的 React 形态）。
 * 只承载视觉结构，不含业务判断；色调由 `@/lib/ui/moan-tones` 映射后传入。
 */
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AvatarTone, MoanTone } from "@/lib/ui/moan-tones";

/* ---------------- 页头 ---------------- */
export function PageHeader({
  title,
  sub,
  actions,
  back,
  breadcrumb,
  className
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mo-page-head", className)}>
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mo-back">
            <ChevronLeft className="h-3.5 w-3.5" />
            {back.label}
          </Link>
        ) : null}
        {breadcrumb ? <div className="mo-crumb">{breadcrumb}</div> : null}
        <h1 className="mo-ph-title">{title}</h1>
        {sub ? <div className="mo-ph-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="mo-ph-actions">{actions}</div> : null}
    </div>
  );
}

/* ---------------- 面板 ---------------- */
export function Panel({
  title,
  icon: Icon,
  count,
  extra,
  footer,
  children,
  className,
  bodyClassName,
  flush,
  as: As = "section",
  id
}: {
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  count?: React.ReactNode;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 内容区不加内边距（列表/表格直接贴边） */
  flush?: boolean;
  as?: "section" | "div" | "aside";
  id?: string;
}) {
  return (
    <As id={id} className={cn("card", className)}>
      {title !== undefined || extra ? (
        <div className="panel-head">
          <div className="panel-title min-w-0">
            {Icon ? <Icon className="ic" /> : null}
            <span className="truncate">{title}</span>
            {count !== undefined && count !== null ? <span className="mo-count">{count}</span> : null}
          </div>
          {extra ? <div className="flex shrink-0 items-center gap-2">{extra}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? (
        <div className={cn(flush ? "" : "panel-body", bodyClassName)}>{children}</div>
      ) : null}
      {footer ? <div className="panel-foot">{footer}</div> : null}
    </As>
  );
}

export function PanelLink({ href, children, onClick }: { href?: string; children: React.ReactNode; onClick?: () => void }) {
  if (href) {
    return (
      <Link href={href} className="mo-panel-link">
        {children}
        <ChevronRight className="h-3 w-3" />
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="mo-panel-link">
      {children}
      <ChevronRight className="h-3 w-3" />
    </button>
  );
}

/* ---------------- 分段控制器 ---------------- */
export type SegmentItem<K extends string> = { key: K; label: React.ReactNode; count?: number | null; href?: string };

export function Segmented<K extends string>({
  items,
  value,
  onChange,
  className,
  size = "md"
}: {
  items: SegmentItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div role="tablist" className={cn("segmented", size === "lg" && "mo-seg-lg", className)}>
      {items.map((it) => {
        const active = it.key === value;
        const inner = (
          <>
            {it.label}
            {typeof it.count === "number" ? <span className="count">{it.count}</span> : null}
          </>
        );
        if (it.href) {
          return (
            <Link key={it.key} href={it.href} role="tab" aria-selected={active} className={cn("seg", active && "active")}>
              {inner}
            </Link>
          );
        }
        return (
          <button key={it.key} type="button" role="tab" aria-selected={active} onClick={() => onChange?.(it.key)} className={cn("seg", active && "active")}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/* 下划线页签（.tabs / .tab） */
export function UnderlineTabs<K extends string>({
  items,
  value,
  onChange,
  className
}: {
  items: SegmentItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("tabs", className)}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button key={it.key} type="button" role="tab" aria-selected={active} onClick={() => onChange(it.key)} className={cn("tab", active && "active")}>
            {it.label}
            {typeof it.count === "number" ? <span className="mo-tab-count">{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 徽章 / 状态 ---------------- */
export function Tag({
  tone = "slate",
  dot,
  children,
  className,
  title
}: {
  tone?: MoanTone | "white" | "outline-red";
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={cn("badge", `b-${tone}`, className)}>
      {dot ? <span className="bdot" /> : null}
      {children}
    </span>
  );
}

export function Dot({ tone, pulse, className }: { tone: MoanTone; pulse?: boolean; className?: string }) {
  const t = tone === "bronze" ? "amber" : tone;
  return <span aria-hidden className={cn("dot", `dot-${t}`, pulse && (t === "red" || t === "amber" || t === "teal") && `dot-pulse-${t}`, className)} />;
}

/* ---------------- 签名母版 ---------------- */
/** 风险阶梯：四格递增，level 0–4 */
export function RiskLadder({ level, tone, className, label }: { level: number; tone: MoanTone; className?: string; label?: string }) {
  const lt = tone === "red" || tone === "amber" || tone === "blue" || tone === "green" ? tone : "blue";
  return (
    <span role="img" aria-label={label ?? `风险等级 ${level}/4`} className={cn("ladder", `l-${lt}`, className)}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= level ? "on" : undefined} />
      ))}
    </span>
  );
}

export type ChainNode = {
  key: string;
  label: string;
  date?: string | null;
  state: "done" | "current" | "risk" | "blocked" | "todo";
  onClick?: () => void;
};

/** 程序链：环节横向推进，当前环节 teal 呼吸环 */
export function ProcedureChain({ nodes, className }: { nodes: ChainNode[]; className?: string }) {
  return (
    <div className={cn("chain mo-chain", className)}>
      {nodes.map((n, i) => (
        <React.Fragment key={n.key}>
          {i > 0 ? <div className={cn("chain-line", nodes[i - 1].state === "done" && (n.state === "done" || n.state === "current") && "done")} /> : null}
          <button
            type="button"
            onClick={n.onClick}
            disabled={!n.onClick}
            className={cn("chain-node", n.state !== "todo" && n.state)}
            aria-current={n.state === "current" ? "step" : undefined}
          >
            <span className="chain-dot">
              {n.state === "done" ? "✓" : n.state === "current" ? <span className="mo-chain-core" /> : n.state === "risk" || n.state === "blocked" ? "!" : i + 1}
            </span>
            <span className="chain-label">{n.label}</span>
            <span className="chain-date">{n.date || "—"}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

/** 审阅印：审批终局与用印回填的收口意象 */
export function ReviewSeal({ top = "审", bottom = "毕", tone = "teal", className }: { top?: string; bottom?: string; tone?: "teal" | "red"; className?: string }) {
  return (
    <span aria-hidden className={cn("seal", tone === "teal" && "teal", "mo-seal-sm", className)}>
      <span className="seal-star">★</span>
      <span>
        {top}
        {bottom}
      </span>
    </span>
  );
}

/* ---------------- 头像 ---------------- */
export function InitialAvatar({ name, tone, size = 27, className }: { name?: string | null; tone: AvatarTone; size?: number; className?: string }) {
  return (
    <span
      className={cn("avatar", `av-${tone}`, className)}
      style={size !== 27 ? { width: size, height: size, fontSize: Math.round(size * 0.39) } : undefined}
      aria-hidden
    >
      {(name ?? "?").trim().charAt(0) || "?"}
    </span>
  );
}

/* ---------------- 倒计时 chip ---------------- */
export function Countdown({ tone, children, className }: { tone: "urgent" | "soon" | "normal"; children: React.ReactNode; className?: string }) {
  return <span className={cn("mo-cd", `mo-cd-${tone}`, className)}>{children}</span>;
}

/* ---------------- 材料 ---------------- */
export function SourceChip({ kind, children }: { kind: "party" | "court" | "ai" | "self" | "team" | "plain"; children: React.ReactNode }) {
  return <span className={cn("src-chip", kind !== "plain" && kind !== "team" && kind, kind === "team" && "self")}>{children}</span>;
}

export function DocIcon({ tone = "red" }: { tone?: "red" | "violet" | "blue" | "slate" }) {
  const color = { red: "var(--red)", violet: "var(--violet)", blue: "var(--blue)", slate: "var(--t-muted)" }[tone];
  return (
    <span className="doc-ic" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
    </span>
  );
}

/* ---------------- 空态 ---------------- */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("empty", compact && "mo-empty-compact", className)}>
      {Icon ? (
        <div className="empty-ic">
          <Icon />
        </div>
      ) : null}
      <div className="mo-empty-title">{title}</div>
      {description ? <div className="mo-empty-desc">{description}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ---------------- 字段 ---------------- */
export function FieldGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  return <dl className={cn("mo-field-grid", `mo-field-grid-${cols}`, className)}>{children}</dl>;
}

export function FieldItem({ label, children, wide, grow, mono }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; /** 同一行内占更大比例（内容通常较长的字段） */ grow?: boolean; mono?: boolean }) {
  return (
    <div className={cn("mo-field", wide && "mo-field-wide", grow && "mo-field-grow")}>
      <dt className="mo-field-k">{label}</dt>
      <dd className={cn("mo-field-v", mono && "mono")}>{children ?? <span className="t-faint">—</span>}</dd>
    </div>
  );
}

/* ---------------- 分页 ---------------- */
export function Pager({
  page,
  totalPages,
  summary,
  hrefFor,
  onChange
}: {
  page: number;
  totalPages: number;
  summary?: React.ReactNode;
  hrefFor?: (page: number) => string;
  onChange?: (page: number) => void;
}) {
  const pages = pagerWindow(page, totalPages);
  const btn = (p: number, label: React.ReactNode, key: string, disabled = false, active = false) => {
    const cls = cn("mo-pg", active && "active", disabled && "disabled");
    if (disabled) return <span key={key} className={cls} aria-disabled>{label}</span>;
    if (hrefFor) return <Link key={key} href={hrefFor(p)} className={cls} aria-current={active ? "page" : undefined}>{label}</Link>;
    return <button key={key} type="button" className={cls} onClick={() => onChange?.(p)} aria-current={active ? "page" : undefined}>{label}</button>;
  };
  return (
    <div className="mo-pager">
      <span className="mo-pager-sum">{summary}</span>
      {totalPages > 1 ? (
        <div className="mo-pager-btns">
          {btn(page - 1, "‹", "prev", page <= 1)}
          {pages.map((p, i) => (p === "…" ? <span key={`e${i}`} className="mo-pg disabled">…</span> : btn(p, p, `p${p}`, false, p === page)))}
          {btn(page + 1, "›", "next", page >= totalPages)}
        </div>
      ) : null}
    </div>
  );
}

function pagerWindow(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

/* ---------------- 行动卡 / 指标卡 ---------------- */
export function ActionTile({
  href,
  tone,
  icon: Icon,
  value,
  label,
  onClick
}: {
  href?: string;
  tone: "red" | "amber" | "blue" | "bronze" | "teal" | "green";
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("mo-action-ic", `mo-ai-${tone}`)}>
        <Icon />
      </span>
      <span className="min-w-0">
        <span className={cn("mo-action-num", `mo-tx-${tone}`)}>{value}</span>
        <span className="mo-action-label">{label}</span>
      </span>
      <ChevronRight className="mo-action-arrow" />
    </>
  );
  if (href) return <Link href={href} className="card card-hover mo-action-tile">{body}</Link>;
  return <button type="button" onClick={onClick} className="card card-hover mo-action-tile text-left">{body}</button>;
}

export function MetricCard({
  label,
  value,
  sub,
  trend,
  hot,
  children,
  className
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: { tone: "up" | "warn" | "down" | "info"; text: React.ReactNode } | null;
  hot?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card kpi mo-metric", hot && "mo-metric-hot", className)}>
      <div className="mo-metric-top">
        <span className="kpi-label">{label}</span>
        {trend ? <span className={cn("trend", `t-${trend.tone}`)}>{trend.text}</span> : null}
      </div>
      <div className={cn("mo-metric-num", hot && "t-red")}>{value}</div>
      {sub ? <div className={cn("mo-metric-sub", hot && "t-red")}>{sub}</div> : null}
      {children}
    </div>
  );
}

/* ---------------- 筛选按钮 ---------------- */
export function FilterChipStatic({ label, value, on, onClear, children }: { label: string; value?: React.ReactNode; on?: boolean; onClear?: () => void; children?: React.ReactNode }) {
  return (
    <span className={cn("mo-filter-btn", on && "on")}>
      {label}
      {value ? <span className="fv">{value}</span> : null}
      {children}
      {on && onClear ? (
        <button type="button" aria-label={`清除${label}筛选`} onClick={onClear} className="x">
          ×
        </button>
      ) : null}
    </span>
  );
}
