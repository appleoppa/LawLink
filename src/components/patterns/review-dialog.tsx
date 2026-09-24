"use client";

/**
 * 墨案 07 宽幅审阅窗口：顶部标题/状态/编号 + 摘要条（含首屏风险）/
 * 左侧页签与资料分区 / 右侧固定审批区（状态行、意见、核对、操作）。
 * 只组织资料与操作，权限和提交逻辑由调用方持有。
 */
import type { ReactNode } from "react";
import { AlertTriangle, SquareCheck } from "lucide-react";
import { DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDateTime } from "@/lib/utils";

export type ReviewTab = { id: string; label: string; icon?: ReactNode; count?: number; countTone?: "red" | "muted"; content: ReactNode };

export function ReviewDialogContent({
  title,
  description,
  eyebrow,
  status,
  summary,
  alert,
  onAlertClick,
  tabs,
  tab,
  onTabChange,
  sidebar,
  sidebarTitle,
  sidebarDescription,
  footer
}: {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  status?: ReactNode;
  /** 摘要条内容（ReviewSummaryItem 列表） */
  summary?: ReactNode;
  /** 首屏风险提示（摘要条右侧） */
  alert?: ReactNode;
  /** 点击首屏风险（通常切到冲突核查页签） */
  onAlertClick?: () => void;
  tabs: ReviewTab[];
  tab?: string;
  onTabChange?: (id: string) => void;
  sidebar: ReactNode;
  sidebarTitle: string;
  sidebarDescription?: string;
  /** 右侧底部固定操作（驳回 / 通过） */
  footer?: ReactNode;
}) {
  const controlled = tab !== undefined ? { value: tab, onValueChange: onTabChange } : { defaultValue: tabs[0]?.id };
  return (
    <DialogContent className="mo-approval flex h-[calc(100dvh-56px)] max-h-[980px] w-[calc(100%-32px)] max-w-[1120px] flex-col gap-0 overflow-hidden rounded-[16px] border-0 p-0">
      <div className="rv-head">
        <div className="rv-top">
          <div className="min-w-0 pr-8">
            {eyebrow ? <div className="t-xs t-mute mb-1 font-semibold">{eyebrow}</div> : null}
            <div className="flex flex-wrap items-center gap-2.5">
              <DialogTitle asChild>
                <span className="rv-title break-words">{title}</span>
              </DialogTitle>
              {status}
            </div>
            <DialogDescription asChild>
              <div className="rv-code flex flex-wrap gap-x-2">{description}</div>
            </DialogDescription>
          </div>
        </div>
        {summary || alert ? (
          <div className="rv-summary">
            {summary}
            {alert ? (
              onAlertClick ? (
                <button type="button" className="rv-alert border-0 bg-transparent p-0 font-[inherit] hover:underline" onClick={onAlertClick}>
                  {alert}
                </button>
              ) : (
                <div className="rv-alert">{alert}</div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rv-body">
        <Tabs {...controlled} className="rv-main flex min-h-0 flex-col">
          <TabsList aria-label="申请详情分区" className="tabs sticky top-0 z-[1] w-full justify-start rounded-none border-b-[var(--bd-hair)] bg-card">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="tab gap-1.5">
                {t.icon}
                {t.label}
                {t.count != null ? (
                  t.countTone === "red" && t.count > 0 ? (
                    <span className="badge b-red" style={{ fontSize: 9.5, padding: "0 6px", marginLeft: 2 }}>{t.count}</span>
                  ) : (
                    <span className="num-sm t-mute">{t.count}</span>
                  )
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.id} value={t.id} forceMount className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
              {t.content}
            </TabsContent>
          ))}
        </Tabs>

        <aside className="rv-side" aria-label={sidebarTitle}>
          <div className="rv-side-head">
            <SquareCheck className="h-[15px] w-[15px] text-[var(--teal)]" strokeWidth={1.8} />
            {sidebarTitle}
            {sidebarDescription ? <span className="t-xs t-mute ml-auto font-normal">{sidebarDescription}</span> : null}
          </div>
          <div className="rv-side-body">{sidebar}</div>
          {footer ? <div className="rv-side-foot">{footer}</div> : null}
        </aside>
      </div>
    </DialogContent>
  );
}

export function ReviewSummaryItem({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="s">
      <span className="k">{k}</span>
      <span className={cn("v", mono && "mono")}>{v}</span>
    </div>
  );
}

export function ReviewAlert({ children }: { children: ReactNode }) {
  return (
    <>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {children}
    </>
  );
}

export function ReviewSection({ title, icon, extra, children, className }: { title: ReactNode; icon?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rv-section", className)}>
      <div className="rv-sec-head">
        {icon ? <span className="flex text-[var(--teal)] [&_svg]:h-[14px] [&_svg]:w-[14px]">{icon}</span> : null}
        {title}
        {extra ? <span className="ml-auto flex items-center gap-2 text-[11px] font-[550]">{extra}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ReviewRow({ k, children, mono, trailing }: { k: ReactNode; children: ReactNode; mono?: boolean; trailing?: ReactNode }) {
  return (
    <div className="arow">
      <span className="k">{k}</span>
      <span className={cn("v min-w-0 whitespace-pre-wrap break-words", mono && "mono")}>{children}</span>
      {trailing}
    </div>
  );
}

export function ReviewFields({ fields, title = "申请资料", icon }: { fields: { label: string; value: string }[]; title?: string; icon?: ReactNode }) {
  if (!fields.length) return null;
  return (
    <ReviewSection title={title} icon={icon}>
      {fields.map((f, i) => (
        <ReviewRow key={`${f.label}-${i}`} k={f.label}>
          {f.value || <span className="t-faint">未填写</span>}
        </ReviewRow>
      ))}
    </ReviewSection>
  );
}

export function ReviewStatusLine({ tone = "amber", title, desc }: { tone?: "amber" | "teal" | "green" | "red" | "slate"; title: ReactNode; desc?: ReactNode }) {
  const palette: Record<string, { bg: string; line: string; t: string; d: string; dot: string }> = {
    amber: { bg: "var(--amber-bg)", line: "var(--amber-line)", t: "#7A5205", d: "#8A6B3E", dot: "dot-amber dot-pulse-amber" },
    teal: { bg: "var(--teal-soft)", line: "var(--teal-line)", t: "var(--teal-deep)", d: "var(--teal-deep)", dot: "dot-teal" },
    green: { bg: "var(--green-bg)", line: "var(--green-line)", t: "var(--green)", d: "var(--green)", dot: "dot-green" },
    red: { bg: "var(--red-bg)", line: "var(--red-line)", t: "var(--red)", d: "var(--red)", dot: "dot-red" },
    slate: { bg: "var(--bg-sunken)", line: "var(--bd-hair)", t: "var(--t-secondary)", d: "var(--t-muted)", dot: "dot-slate" }
  };
  const p = palette[tone];
  return (
    <div className="status-line" style={{ background: p.bg, borderColor: p.line }}>
      <span className={cn("dot shrink-0", p.dot)} />
      <div className="min-w-0">
        <div className="t" style={{ color: p.t }}>{title}</div>
        {desc ? <div className="d" style={{ color: p.d }}>{desc}</div> : null}
      </div>
    </div>
  );
}

export function ReviewEmpty({ icon, title, desc }: { icon?: ReactNode; title: string; desc?: string }) {
  return (
    <div className="rv-section">
      <div className="empty">
        {icon ? <div className="empty-ic">{icon}</div> : null}
        <div className="mo-empty-title">{title}</div>
        {desc ? <div className="mo-empty-desc">{desc}</div> : null}
      </div>
    </div>
  );
}

export function ReviewFileRow({ id, name, readable, meta }: { id: string; name: string; readable: boolean; meta?: string }) {
  return (
    <div className="doc-row">
      <span className="doc-ic" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="doc-name truncate">{name}</div>
        <div className="doc-meta">{meta ?? (readable ? "申请关联材料" : "当前无附件读取权限")}</div>
      </div>
      {readable ? (
        <a href={`/api/documents/${id}/download?inline=1`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" aria-label={`查看附件：${name}`}>
          查看
        </a>
      ) : null}
    </div>
  );
}

export function ReviewHistory({ items, emptyText, emptyDesc }: { items: { id: string; label: string; userName: string; at: Date | string; note?: string | null; decision?: string | boolean | null; legacy?: boolean }[]; emptyText: string; emptyDesc?: string }) {
  const dateText = (d: Date | string) => formatDateTime(d);
  if (!items.length) return <ReviewEmpty title={emptyText} desc={emptyDesc} />;
  return (
    <ReviewSection title="处理记录">
      <div className="panel-body">
        <div className="timeline">
          {items.map((h) => (
            <div key={h.id} className={cn("tl-item", h.decision && "done")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold">
                  {h.label} · {h.userName}
                </span>
                <span className="num-sm t-mute">{dateText(h.at)}</span>
              </div>
              {h.note || h.decision ? <div className="rec-note mt-1.5 whitespace-pre-wrap" style={{ background: "var(--bg-sunken)", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "var(--t-secondary)" }}>{h.note || "未记录审批意见"}</div> : null}
              {h.legacy ? <div className="t-xs t-faint mt-1">来自原业务记录</div> : null}
            </div>
          ))}
        </div>
      </div>
    </ReviewSection>
  );
}
