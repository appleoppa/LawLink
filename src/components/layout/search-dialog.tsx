"use client";

/**
 * 全局搜索（墨案 11 效果图 palette）。
 * 范围 chip 带计数、按类型分组、关键词高亮、材料页码 / 来源 chip / OCR 标识、
 * 「跳转案件」、键盘 ↑↓ 选择 · ↵ 打开 · Tab 切换范围；底部注明权限口径与识别失败数。
 * 数据与授权过滤全部在 server/search/actions.ts（候选逐条 canReadDocument）。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Building2, Clock, FileText, Folder, Inbox, Loader2, Lock, Search, Sparkle } from "lucide-react";
import { globalSearch, type GlobalSearchResult, type SearchResultItem } from "@/server/search/actions";
import { documentSourceChip } from "@/lib/ui/moan-tones";
import { cn } from "@/lib/utils";

type GroupKey = "documents" | "matters" | "clients" | "deadlines" | "intakes";
type Scope = "all" | GroupKey;

const GROUPS: { key: GroupKey; label: string; icon: typeof Folder; tone: string }[] = [
  { key: "documents", label: "材料正文", icon: FileText, tone: "gi-violet" },
  { key: "matters", label: "案件", icon: Folder, tone: "gi-blue" },
  { key: "clients", label: "客户", icon: Building2, tone: "gi-teal" },
  { key: "deadlines", label: "期限", icon: Clock, tone: "gi-amber" },
  { key: "intakes", label: "收案", icon: Inbox, tone: "gi-slate" }
];
const SCOPE_ORDER: Scope[] = ["all", "matters", "clients", "documents", "deadlines", "intakes"];
const ALL_SCOPE_LIMIT = 4;

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={k++}>{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return <>{parts}</>;
}

function dueLabel(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).replace("/", "-");
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const left = days < 0 ? `已逾期 ${-days} 天` : days === 0 ? "今天到期" : `剩余 ${days} 天`;
  return { date, left, urgent: days <= 3 };
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [sel, setSel] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Cmd+K / Ctrl+K 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onOpenChange]);

  // 防抖搜索
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await globalSearch(q);
        if (!cancelled) {
          setResults(r);
          setSel(0);
        }
      } catch {
        if (!cancelled) setResults(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const q = query.trim();
  const counts = useMemo(() => {
    const c = { documents: 0, matters: 0, clients: 0, deadlines: 0, intakes: 0 } as Record<GroupKey, number>;
    if (results) for (const g of GROUPS) c[g.key] = results[g.key].length;
    return c;
  }, [results]);

  // 当前范围下的可见分组与扁平列表（键盘选择用）
  const visible = useMemo(() => {
    if (!results) return [] as { group: (typeof GROUPS)[number]; items: SearchResultItem[]; start: number }[];
    let start = 0;
    return GROUPS.filter((g) => scope === "all" || g.key === scope)
      .map((g) => ({ group: g, items: scope === "all" ? results[g.key].slice(0, ALL_SCOPE_LIMIT) : results[g.key] }))
      .filter((g) => g.items.length > 0)
      .map((g) => {
        const out = { ...g, start };
        start += g.items.length;
        return out;
      });
  }, [results, scope]);
  const flat = useMemo(() => visible.flatMap((g) => g.items), [visible]);

  const go = useCallback(
    (href: string) => {
      if (!href) return;
      onOpenChange(false);
      setQuery("");
      setScope("all");
      router.push(href);
    },
    [router, onOpenChange]
  );

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      const item = flat[sel];
      if (item) {
        e.preventDefault();
        go(item.href);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const i = SCOPE_ORDER.indexOf(scope);
      setScope(SCOPE_ORDER[(i + (e.shiftKey ? SCOPE_ORDER.length - 1 : 1)) % SCOPE_ORDER.length]);
      setSel(0);
    }
  }

  const total = GROUPS.reduce((n, g) => n + counts[g.key], 0);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setScope("all");
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay-dim !z-50" />
        <DialogPrimitive.Content
          className="mo-search"
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
        >
          <div className="dialog palette mo-palette">
            <DialogPrimitive.Title className="sr-only">全局搜索</DialogPrimitive.Title>
            <div className="gs-input">
              {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
              <input
                className="q mo-gs-q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索案件、客户、材料正文、期限…"
                aria-label="搜索关键词"
                autoComplete="off"
              />
              <DialogPrimitive.Close className="kbd" aria-label="关闭搜索">Esc</DialogPrimitive.Close>
            </div>

            <div className="gs-filters" role="tablist" aria-label="搜索范围">
              {SCOPE_ORDER.map((s) => {
                const label = s === "all" ? "全部" : GROUPS.find((g) => g.key === s)!.label;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={scope === s}
                    className={cn("gs-chip", scope === s && "active")}
                    onClick={() => {
                      setScope(s);
                      setSel(0);
                    }}
                  >
                    {label}
                    {s !== "all" && results ? <span className="c">{counts[s] >= 20 ? "20+" : counts[s]}</span> : null}
                  </button>
                );
              })}
              <span className="t-xs t-faint mo-gs-scope-note">标题 + 全文（含 OCR 识别文字）</span>
            </div>

            <div className="gs-body" ref={bodyRef}>
              {!q ? (
                <div className="mo-gs-empty">
                  <div className="mo-empty-title">输入关键词开始检索</div>
                  <div className="mo-empty-desc">可搜案件名称 / 所内编号、客户名称 / 证件号 / 电话、材料名称与正文、期限事项、在途收案。</div>
                </div>
              ) : results && flat.length === 0 && !loading ? (
                <div className="mo-gs-empty">
                  <div className="mo-empty-title">{total === 0 ? "未找到相关结果" : "该范围下没有结果"}</div>
                  <div className="mo-empty-desc">{total === 0 ? "换个关键词试试；证件号需完整输入才会精确匹配。" : "按 Tab 切换到其他范围查看。"}</div>
                </div>
              ) : null}

              {visible.map(({ group, items, start }) => {
                const Icon = group.icon;
                return (
                  <Fragment key={group.key}>
                    <div className="gs-group">
                      {group.label} · {counts[group.key] >= 20 ? "20+" : counts[group.key]}
                      {scope === "all" && counts[group.key] > items.length ? (
                        <button type="button" className="mo-gs-more" onClick={() => { setScope(group.key); setSel(0); }}>
                          查看全部 →
                        </button>
                      ) : null}
                    </div>
                    {items.map((item, i) => {
                      const myIdx = start + i;
                      const chip = item.sourceOrigin ? documentSourceChip[item.sourceOrigin] : null;
                      const due = item.dueAt && item.type === "deadline" ? dueLabel(item.dueAt) : null;
                      return (
                        <div
                          key={`${group.key}-${item.id}`}
                          data-idx={myIdx}
                          role="option"
                          aria-selected={sel === myIdx}
                          className={cn("gs-item", sel === myIdx && "sel")}
                          onMouseMove={() => sel !== myIdx && setSel(myIdx)}
                          onClick={() => go(item.href)}
                          style={item.href ? undefined : { cursor: "default" }}
                        >
                          <div className={cn("gs-ic", group.tone)}>
                            <Icon strokeWidth={1.9} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="gs-title">
                              <Highlight text={item.title} q={q} />
                              {item.ocr ? (
                                <span className="badge b-violet" style={{ fontSize: 9.5, padding: "0 6px", marginLeft: 6 }}>
                                  <Sparkle style={{ width: 8, height: 8 }} /> OCR
                                </span>
                              ) : null}
                            </div>
                            {item.type === "document" && item.snippet ? (
                              <div className="gs-snippet">…<Highlight text={item.snippet} q={q} />…</div>
                            ) : null}
                            <div className="gs-meta">
                              {item.type === "document" ? (
                                <>
                                  <span className="mono">{item.pageNo ? `第 ${item.pageNo} 页命中` : item.matchedBy}</span>
                                  {chip ? <span className={cn("src-chip", chip.kind)}>{chip.label}</span> : null}
                                  {item.context ? <span className="truncate">{item.context}</span> : <span>未挂案件或收案（如模板、申请附件），请在对应模块打开</span>}
                                  {item.code ? <span className="mono">{item.code}</span> : null}
                                </>
                              ) : item.type === "matter" ? (
                                <>
                                  <span className="mono">{item.code}</span>
                                  <span>· <Highlight text={item.matchedBy ?? ""} q={q} />{item.meta ? ` · ${item.meta}` : ""}</span>
                                </>
                              ) : item.type === "client" ? (
                                <span>{item.meta}{item.matchedBy && item.matchedBy !== "名称命中" ? <> · <Highlight text={item.matchedBy} q={q} /></> : null}</span>
                              ) : item.type === "deadline" && due ? (
                                <>
                                  <span className="mono">{due.date}</span>
                                  <span>· {item.meta} · {item.context}</span>
                                  <span style={{ color: due.urgent ? "var(--red)" : undefined }}>· {due.left}</span>
                                </>
                              ) : (
                                <span>{item.meta}</span>
                              )}
                            </div>
                          </div>
                          {item.matterLink && item.type !== "matter" ? (
                            <button
                              type="button"
                              className="badge b-blue mo-gs-jump"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(item.matterLink!);
                              }}
                            >
                              {item.type === "document" && !item.code ? "打开收案" : "跳转案件"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>

            <div className="gs-foot">
              <span className="hint"><span className="kbd">↑</span><span className="kbd">↓</span> 选择</span>
              <span className="hint"><span className="kbd">↵</span> 打开</span>
              <span className="hint"><span className="kbd">Tab</span> 切换范围</span>
              <span className="perm">
                <Lock style={{ width: 12, height: 12 }} aria-hidden />
                仅展示你有权限访问的内容 · 材料正文支持按页定位
                {results && results.documentsFailedCount > 0 ? ` · 另有 ${results.documentsFailedCount} 份材料识别失败未纳入全文` : ""}
              </span>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
