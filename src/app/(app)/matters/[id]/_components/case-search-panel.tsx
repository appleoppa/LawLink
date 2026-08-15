"use client";

import { useState, useTransition } from "react";
import {
  Search,
  Loader2,
  ExternalLink,
  Scale,
  CircleAlert,
  BookmarkPlus,
  Check
} from "lucide-react";
import { toast } from "sonner";
import type { MatterCategory } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  searchSimilarCases,
  searchSimilarCasesByVector,
  type CaseSearchHit,
  type VectorCaseHit
} from "@/server/yuandian/cases";
import { searchRegulationsAction, type RegulationSearchHit } from "@/server/yuandian/regulations";
import {
  searchLocalJudgmentsAction,
  type LocalJudgmentSearchActionResult
} from "@/server/cncases/search";
import {
  saveCaseToMatter,
  saveVectorCaseToMatter
} from "@/server/yuandian/save-case";
import { cn } from "@/lib/utils";

type Props = {
  matterId: string;
  matterCategory: MatterCategory;
  defaultCauseName: string | null;
};

const PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
  "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
  "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "最高"
];

const WSZL_OPTIONS = ["判决书", "裁定书", "调解书", "决定书"] as const;

function ajlbFromCategory(cat: MatterCategory): string | undefined {
  switch (cat) {
    case "CIVIL_COMMERCIAL":
    case "LABOR_ARBITRATION":
    case "COMMERCIAL_ARBITRATION":
      return "民事案件";
    case "CRIMINAL":
      return "刑事案件";
    case "ADMINISTRATIVE":
      return "行政案件";
    default:
      return undefined;
  }
}

type SearchMode = "keyword" | "vector" | "cncases" | "regulation";

export function CaseSearchPanel({ matterId, matterCategory, defaultCauseName }: Props) {
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [causeInput, setCauseInput] = useState(defaultCauseName ?? "");
  const [qw, setQw] = useState("");
  const [vectorQuery, setVectorQuery] = useState("");
  const [provinces, setProvinces] = useState<string[]>([]);
  const [wszl, setWszl] = useState<string[]>(["判决书"]);
  const [jaStart, setJaStart] = useState("");
  const [jaEnd, setJaEnd] = useState("");
  const [topK, setTopK] = useState(10);

  const [pending, startTransition] = useTransition();
  const [keywordResult, setKeywordResult] = useState<{
    total: number;
    items: CaseSearchHit[];
    pointsCharged: number;
  } | null>(null);
  const [vectorResult, setVectorResult] = useState<{
    items: VectorCaseHit[];
    pointsCharged: number;
  } | null>(null);
  const [cncasesQuery, setCncasesQuery] = useState("");
  const [cncasesResult, setCncasesResult] = useState<LocalJudgmentSearchActionResult | null>(null);
  const [regKeyword, setRegKeyword] = useState("");
  const [regFgmc, setRegFgmc] = useState("");
  const [regXljb, setRegXljb] = useState("");
  const [regSxx, setRegSxx] = useState("现行有效");
  const [regResult, setRegResult] = useState<{ total: number; items: RegulationSearchHit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  function toggleProvince(p: string) {
    setProvinces((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }
  function toggleWszl(w: string) {
    setWszl((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }

  async function handleSave(c: CaseSearchHit) {
    setSavingId(c.id);
    try {
      const res = await saveCaseToMatter({
        matterId,
        caseHit: c
      });
      setSavedIds((prev) => new Set(prev).add(c.id));
      toast.success("已保存到案件资料", {
        description: res.documentName
      });
    } catch (err) {
      toast.error("保存失败", {
        description: err instanceof Error ? err.message : ""
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveVector(c: VectorCaseHit) {
    setSavingId(c.scid);
    try {
      const res = await saveVectorCaseToMatter({
        matterId,
        caseHit: c
      });
      setSavedIds((prev) => new Set(prev).add(c.scid));
      toast.success("已保存到案件资料", {
        description: res.documentName
      });
    } catch (err) {
      toast.error("保存失败", {
        description: err instanceof Error ? err.message : ""
      });
    } finally {
      setSavingId(null);
    }
  }

  function handleSearch() {
    const ay = causeInput
      .split(/[,，、\s]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "keyword") {
          const r = await searchSimilarCases({
            matterId,
            ay: ay.length ? ay : undefined,
            ajlb: ajlbFromCategory(matterCategory) as never,
            xzqh_p: provinces.length ? provinces : undefined,
            wszl: wszl.length ? (wszl as never) : undefined,
            qw: qw.trim() || undefined,
            ja_start: jaStart || undefined,
            ja_end: jaEnd || undefined,
            top_k: topK
          });
          setKeywordResult(r);
          setVectorResult(null);
          setCncasesResult(null);
          setRegResult(null);
          if (r.items.length === 0) toast.info("未命中类案");
        } else if (mode === "cncases") {
          if (!cncasesQuery.trim()) {
            setError("请输入裁判文书关键词");
            return;
          }
          const r = await searchLocalJudgmentsAction(cncasesQuery.trim(), { max: topK, matterId });
          setCncasesResult(r);
          setKeywordResult(null);
          setVectorResult(null);
          setRegResult(null);
          if (r.items.length === 0) toast.info(r.message ?? "未命中本地裁判文书");
        } else if (mode === "regulation") {
          if (!regKeyword.trim() && !regFgmc.trim()) {
            setError("请输入法规关键词或法规名称");
            return;
          }
          const r = await searchRegulationsAction({
            keyword: regKeyword.trim() || undefined,
            fgmc: regFgmc.trim() || undefined,
            xljb_1: regXljb || undefined,
            sxx: regSxx || undefined,
            top_k: topK,
            matterId
          });
          setRegResult(r);
          setKeywordResult(null);
          setVectorResult(null);
          setCncasesResult(null);
          if (r.items.length === 0) toast.info("未命中法规");
        } else {
          if (!vectorQuery.trim()) {
            setError("语义检索的案情描述不能为空");
            return;
          }
          const r = await searchSimilarCasesByVector({
            matterId,
            query: vectorQuery.trim(),
            ay: ay.length ? ay : undefined,
            ajlb: ajlbFromCategory(matterCategory) as never,
            xzqh_p: provinces[0] || undefined, // vector 接受 string 单值
            wszl: wszl.length ? (wszl as never) : undefined,
            ja_start: jaStart || undefined,
            ja_end: jaEnd || undefined,
            return_num: topK
          });
          setVectorResult(r);
          setKeywordResult(null);
          setCncasesResult(null);
          setRegResult(null);
          if (r.items.length === 0) toast.info("未命中类案");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "检索失败";
        setError(msg);
        toast.error("检索失败", { description: msg });
      }
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4 text-primary" strokeWidth={1.8} />
            类案检索
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            元典案例库 · 本地裁判文书 · 法条法规
          </p>
        </div>
        <div className="flex rounded-md border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setMode("keyword")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px]",
              mode === "keyword"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            关键词
          </button>
          <button
            type="button"
            onClick={() => setMode("vector")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px]",
              mode === "vector"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            语义
          </button>
          <button
            type="button"
            onClick={() => setMode("cncases")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px]",
              mode === "cncases"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            本地文书
          </button>
          <button
            type="button"
            onClick={() => setMode("regulation")}
            className={cn(
              "rounded px-2.5 py-1 text-[11px]",
              mode === "regulation"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            法条法规
          </button>
        </div>
      </header>

      {/* 检索表单 */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        {mode === "cncases" && (
          <div>
            <Label className="text-[11px]">裁判文书关键词（本地 8500 万份，移动硬盘一）</Label>
            <Input
              value={cncasesQuery}
              onChange={(e) => setCncasesQuery(e.target.value)}
              placeholder="如：民间借贷 违约金 二七区人民法院"
              className="mt-1"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
        )}
        {mode === "regulation" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-[11px]">法规内容关键词</Label>
              <Input
                value={regKeyword}
                onChange={(e) => setRegKeyword(e.target.value)}
                placeholder="如：违约金 不得超过 造成损失"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px]">法规名称（可选）</Label>
              <Input
                value={regFgmc}
                onChange={(e) => setRegFgmc(e.target.value)}
                placeholder="如：最高人民法院关于审理民间借贷案件适用法律若干问题的规定"
                className="mt-1"
              />
            </div>
          </div>
        )}
        {mode === "regulation" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-[11px]">效力级别（可选）</Label>
              <select
                value={regXljb}
                onChange={(e) => setRegXljb(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">全部</option>
                <option value="宪法">宪法</option>
                <option value="法律">法律</option>
                <option value="司法解释">司法解释</option>
                <option value="行政法规">行政法规</option>
                <option value="部门规章">部门规章</option>
                <option value="地方性法规">地方性法规</option>
                <option value="地方政府规章">地方政府规章</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px]">时效性（可选）</Label>
              <select
                value={regSxx}
                onChange={(e) => setRegSxx(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">全部</option>
                <option value="现行有效">现行有效</option>
                <option value="失效">失效</option>
                <option value="已被修改">已被修改</option>
                <option value="部分失效">部分失效</option>
                <option value="尚未生效">尚未生效</option>
              </select>
            </div>
          </div>
        )}
        {mode === "vector" && (
          <div>
            <Label className="text-[11px]">案情描述（自然语言）</Label>
            <textarea
              value={vectorQuery}
              onChange={(e) => setVectorQuery(e.target.value)}
              placeholder="如：被告借款 50 万元到期未还，原告主张违约金和资金占用费"
              rows={3}
              className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
            />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-[11px]">
              {mode === "vector" ? "案由过滤（可选）" : "案由（多个用 / 逗号分隔）"}
            </Label>
            <Input
              value={causeInput}
              onChange={(e) => setCauseInput(e.target.value)}
              placeholder="如：民间借贷纠纷"
              className="mt-1"
            />
          </div>
          {mode === "keyword" && (
            <div>
              <Label className="text-[11px]">全文关键词（空格 AND 拼接）</Label>
              <Input
                value={qw}
                onChange={(e) => setQw(e.target.value)}
                placeholder="如：违约金 逾期"
                className="mt-1"
              />
            </div>
          )}
        </div>

        <div>
          <Label className="text-[11px]">
            {mode === "vector" ? "省份过滤（取第一个，语义接口单值）" : "省级法院（多选）"}
          </Label>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PROVINCES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => toggleProvince(p)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  provinces.includes(p)
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-input"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label className="text-[11px]">文书种类</Label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {WSZL_OPTIONS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWszl(w)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    wszl.includes(w)
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-input"
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[11px]">裁判日期</Label>
            <div className="mt-1 flex items-center gap-1.5">
              <Input
                type="date"
                value={jaStart}
                onChange={(e) => setJaStart(e.target.value)}
                className="h-9 text-[12px]"
              />
              <span className="text-muted-foreground">~</span>
              <Input
                type="date"
                value={jaEnd}
                onChange={(e) => setJaEnd(e.target.value)}
                className="h-9 text-[12px]"
              />
            </div>
          </div>
          <div>
            <Label className="text-[11px]">返回条数（1-50）</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={(e) => setTopK(Math.min(50, Math.max(1, Number(e.target.value) || 10)))}
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex items-center justify-end pt-1">
          <Button onClick={handleSearch} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            检索类案
          </Button>
        </div>
      </div>

      {/* 结果区 */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {keywordResult && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            命中 <span className="font-mono text-foreground">{keywordResult.total}</span> 条，
            已返回 <span className="font-mono text-foreground">{keywordResult.items.length}</span> 条，
            本次扣 <span className="font-mono text-foreground">{keywordResult.pointsCharged}</span> POINT
          </p>
          <ul className="space-y-2">
            {keywordResult.items.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 overflow-hidden">
                    <div className="text-sm font-medium leading-snug">{c.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{c.ah}</span>
                      <span>·</span>
                      <span>{c.jbdw}</span>
                      <span>·</span>
                      <span>{c.cprq}</span>
                      <span className="rounded border border-border bg-muted/30 px-1 py-0.5 text-[10px]">
                        {c.wszl}
                      </span>
                      {c.ay.map((y) => (
                        <span
                          key={y}
                          className="rounded border border-primary/30 bg-primary/5 px-1 py-0.5 text-[10px] text-primary"
                        >
                          {y}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {savedIds.has(c.id) ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700">
                        <Check className="h-3 w-3" />
                        已存
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSave(c)}
                        disabled={savingId === c.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-popover hover:text-primary disabled:opacity-50"
                        title="作为类案存档保存到本案件资料"
                      >
                        {savingId === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <BookmarkPlus className="h-3 w-3" />
                        )}
                        存档
                      </button>
                    )}
                    <a
                      href={c.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-primary hover:bg-popover"
                    >
                      全文
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                {c.content && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-foreground/75">
                    {c.content}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vectorResult && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            语义检索返回 <span className="font-mono text-foreground">{vectorResult.items.length}</span> 条（按相似度评分排序），
            本次扣 <span className="font-mono text-foreground">{vectorResult.pointsCharged}</span> POINT
          </p>
          <ul className="space-y-2">
            {vectorResult.items.map((c) => (
              <li key={c.scid} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium leading-snug">{c.title}</span>
                      <span className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0.5 text-[10px] text-violet-700">
                        相似度 {c.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {c.ah && <span className="font-mono">{c.ah}</span>}
                      {c.jbdw && (
                        <>
                          <span>·</span>
                          <span>{c.jbdw}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{c.jaDate ? formatJaDate(c.jaDate) : c.jand}</span>
                      <span className="rounded border border-border bg-muted/30 px-1 py-0.5 text-[10px]">
                        {c.wszl}
                      </span>
                      {(c.anyou ?? []).map((y) => (
                        <span
                          key={y}
                          className="rounded border border-primary/30 bg-primary/5 px-1 py-0.5 text-[10px] text-primary"
                        >
                          {y}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {savedIds.has(c.scid) ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700">
                        <Check className="h-3 w-3" />
                        已存
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSaveVector(c)}
                        disabled={savingId === c.scid}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-popover hover:text-primary disabled:opacity-50"
                        title="作为类案存档保存到本案件资料"
                      >
                        {savingId === c.scid ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <BookmarkPlus className="h-3 w-3" />
                        )}
                        存档
                      </button>
                    )}
                    <a
                      href={c.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-primary hover:bg-popover"
                    >
                      全文
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                {c.content && (
                  <p className="mt-2 line-clamp-5 whitespace-pre-line text-[12px] leading-relaxed text-foreground/75">
                    {c.content}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cncasesResult && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            本地裁判文书命中{" "}
            <span className="font-mono text-foreground">{cncasesResult.total}</span> 条，已返回{" "}
            <span className="font-mono text-foreground">{cncasesResult.items.length}</span> 条
          </p>
          {!cncasesResult.available && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-500/10 p-3 text-[12px] text-amber-700">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{cncasesResult.message}</span>
            </div>
          )}
          <ul className="space-y-2">
            {cncasesResult.items.map((c, i) => (
              <li key={`${c.title}-${i}`} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 overflow-hidden">
                    <div className="text-sm font-medium leading-snug">{c.title}</div>
                    {c.meta && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.meta}</p>
                    )}
                  </div>
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-primary hover:bg-popover"
                  >
                    查看
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {regResult && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            法规命中 <span className="font-mono text-foreground">{regResult.total}</span> 条，已返回{" "}
            <span className="font-mono text-foreground">{regResult.items.length}</span> 条
          </p>
          <ul className="space-y-2">
            {regResult.items.map((r, i) => (
              <li key={`${r.fgmc}-${i}`} className="rounded-lg border border-border bg-card p-3">
                <div className="text-sm font-medium leading-snug">{r.fgmc}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {r.xljb_1 && (
                    <span className="rounded border border-primary/30 bg-primary/5 px-1 py-0.5 text-[10px] text-primary">
                      {r.xljb_1}
                    </span>
                  )}
                  {r.sxx && (
                    <span className="rounded border border-border bg-muted/30 px-1 py-0.5 text-[10px]">
                      {r.sxx}
                    </span>
                  )}
                  {r.fbrq && <span>发布 {r.fbrq}</span>}
                  {r.ssrq && <span>· 实施 {r.ssrq}</span>}
                  {r.fbbm && <span>· {r.fbbm}</span>}
                </div>
                {r.content && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-foreground/75">
                    {r.content}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatJaDate(n: number): string {
  // 20191223 → 2019-12-23
  const s = String(n);
  if (s.length !== 8) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
