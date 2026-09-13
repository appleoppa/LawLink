"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ShieldCheck,
  Loader2,
  Search,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
  Info,
  Briefcase
} from "lucide-react";
import type {
  ConflictSeverity,
  ConflictConclusion,
  MatterCategory,
  MatterStatus,
  PartyRole,
  LitigationStanding
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { runCheckAndSave, setConflictConclusion } from "@/server/conflicts/actions";
import { conflictConclusionLabel, litigationStandingLabel, matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import type { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";
import { cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";

type Hit = {
  id: string;
  hitType: string;
  targetType: string;
  targetId: string;
  matchedName: string;
  matchedField: string;
  matchedValue: string;
  matchedRatio: number | null;
  severity: ConflictSeverity;
  reason: string;
  matter: {
    id: string;
    code: string;
    title: string;
    category: MatterCategory;
    status: MatterStatus;
    intakeDate: Date | null;
    canViewMatter: boolean;
    causeText: string | null;
    ownerName: string | null;
    partyRole: PartyRole | null;
    partyStanding: LitigationStanding | null;
  } | null;
};

type SameNameClient = { clientId: string; name: string };
type IdMatchedClient = { clientId: string; name: string; idNumber: string };

type LatestCheck = {
  id: string;
  conclusion: ConflictConclusion;
  hits: Hit[];
  decidedBy: { id: string; name: string } | null;
  decidedAt: Date | null;
  note: string | null;
  checkedAt: Date;
  sameNameClients: SameNameClient[];
  idMatchedClients: IdMatchedClient[];
};

type Props = {
  intakeId: string;
  queries: ReturnType<typeof buildIntakeConflictQueries>;
  latestCheck: LatestCheck | null;
  canEditConclusion: boolean;
};

const severityStyle: Record<ConflictSeverity, { color: string; bg: string; label: string }> = {
  BLOCKING: { color: "#B42318", bg: "rgba(220,38,38,0.10)", label: "阻塞" },
  HIGH: { color: "#EA580C", bg: "rgba(234,88,12,0.10)", label: "高" },
  MEDIUM: { color: "#96650B", bg: "rgba(217,119,6,0.10)", label: "中" },
  LOW: { color: "#1A7F45", bg: "rgba(101,163,13,0.10)", label: "低" }
};

const partyRoleLabel: Record<PartyRole, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他"
};

export function ConflictSection({
  intakeId,
  queries,
  latestCheck,
  canEditConclusion
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [conclusionNote, setConclusionNote] = useState(latestCheck?.note ?? "");
  const needsHighRiskNote =
    latestCheck?.hits.some((h) => h.severity === "HIGH" || h.severity === "BLOCKING") ?? false;

  function handleRunCheck() {
    if (queries.length === 0) {
      toast.warning("没有可检索的当事人", { description: "请先在收案中添加委托方或对方" });
      return;
    }

    startTransition(async () => {
      try {
        const res = await runCheckAndSave({ intakeId, queries });
        toast.success("冲突检索完成", {
          description: `命中 ${res.hits.length} 条，请逐条核查`
        });
      } catch (err) {
        toast.error("检索失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  function handleSetConclusion(conclusion: ConflictConclusion) {
    if (!latestCheck) return;
    if (conclusion === "DIFFERENT" && needsHighRiskNote && !conclusionNote.trim()) {
      toast.warning("请先补充承接理由", {
        description: "存在高风险或阻塞命中时，需要写明排除理由或书面同意留痕"
      });
      return;
    }
    startTransition(async () => {
      try {
        await setConflictConclusion({
          checkId: latestCheck.id,
          conclusion,
          note: conclusionNote
        });
        toast.success("结论已保存");
      } catch (err) {
        toast.error("保存失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <section className="ll-surface rounded-lg border border-border p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-4 w-4 text-primary" />
            利益冲突检索
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            匹配历史案件当事人；客户库同名仅作提示，不计为冲突
          </p>
        </div>

        <Button
          onClick={handleRunCheck}
          disabled={isPending}
          size="sm"
          className="gap-1.5"
          variant={latestCheck ? "outline" : "default"}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {latestCheck ? "重新检索" : "运行冲突检索"}
        </Button>
      </header>

      {!latestCheck ? (
        <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          还未运行冲突检索
        </div>
      ) : (
        <div className="space-y-3">
          {/* 概览 */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2.5 text-[12px]">
            <span className="font-mono text-[11px] text-muted-foreground">
              {new Date(latestCheck.checkedAt).toLocaleString("zh-CN")}
            </span>
            <span className="text-muted-foreground">·</span>
            <span>
              冲突命中{" "}
              <span className="font-mono text-foreground">{latestCheck.hits.length}</span>
            </span>
            <Badge
              variant="outline"
              className={cn(
                "ml-1 text-[10px]",
                latestCheck.conclusion === "SAME_SUBJECT" && "border-destructive/40 text-destructive",
                latestCheck.conclusion === "DIFFERENT" && "border-[#1A7F45]/40 text-[#1A7F45]",
                latestCheck.conclusion === "NEED_INFO" && "border-[var(--amber-line)] text-[var(--amber)]"
              )}
            >
              {conflictConclusionLabel[latestCheck.conclusion]}
            </Badge>
            {latestCheck.decidedBy && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {latestCheck.decidedBy.name} ·{" "}
                {latestCheck.decidedAt
                  ? new Date(latestCheck.decidedAt).toLocaleDateString("zh-CN")
                  : ""}
              </span>
            )}
          </div>

          {/* 客户库同名提示（非冲突） */}
          {latestCheck.sameNameClients.length > 0 && (
            <InfoBar
              icon={<Info className="h-3.5 w-3.5" />}
              tone="info"
              text={`客户库已有 ${latestCheck.sameNameClients.length} 个同名记录（仅提示，非冲突）`}
            >
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {latestCheck.sameNameClients.map((c) => (
                  <Link
                    key={c.clientId}
                    href={`/clients/${c.clientId}`}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:border-primary/40 hover:text-primary"
                  >
                    {c.name}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                ))}
              </div>
            </InfoBar>
          )}

          {/* 身份证号一致客户提示（强提示） */}
          {latestCheck.idMatchedClients.length > 0 && (
            <InfoBar
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              tone="warn"
              text={`身份证 / 信用代码与客户库 ${latestCheck.idMatchedClients.length} 条记录精确匹配，请人工核对是否为同一主体`}
            >
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {latestCheck.idMatchedClients.map((c) => (
                  <Link
                    key={c.clientId}
                    href={`/clients/${c.clientId}`}
                    className="inline-flex items-center gap-1 rounded border border-[var(--amber-line)] bg-[var(--amber-bg)] px-2 py-0.5 text-[11px] text-[var(--amber)] hover:bg-[var(--amber-bg)]"
                  >
                    {c.name} <span className="font-mono opacity-60">{c.idNumber}</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                ))}
              </div>
            </InfoBar>
          )}

          {/* 冲突命中列表 */}
          {latestCheck.hits.length === 0 ? (
            <div className="rounded-md border border-[#1A7F45]/30 bg-[#1A7F45]/10 p-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#1A7F45]" />
                <span className="text-foreground">未命中历史案件，系统已标记为可承接</span>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {latestCheck.hits.map((h) => (
                <HitCard key={h.id} hit={h} />
              ))}
            </ul>
          )}

          {/* 结论 */}
          {canEditConclusion && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 flex items-center gap-2">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-[13px] font-medium">标记结论</h3>
              </div>
              <Textarea
                value={conclusionNote}
                onChange={(e) => setConclusionNote(e.target.value)}
                placeholder="补充说明（如：经核对确认非同一主体；或已披露风险并取得书面同意）"
                rows={2}
                className="mb-2 text-[12px]"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetConclusion("SAME_SUBJECT")}
                  disabled={isPending}
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                >
                  有冲突（不承接）
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetConclusion("DIFFERENT")}
                  disabled={isPending}
                  className="border-[#1A7F45]/40 text-[#1A7F45] hover:bg-[#1A7F45]/10"
                >
                  可承接
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetConclusion("NEED_INFO")}
                  disabled={isPending}
                >
                  信息不足，待补充
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InfoBar({
  icon,
  tone,
  text,
  children
}: {
  icon: React.ReactNode;
  tone: "info" | "warn";
  text: string;
  children?: React.ReactNode;
}) {
  const colors =
    tone === "warn"
      ? { border: "border-[var(--amber-line)]", bg: "bg-[var(--amber-bg)]", text: "text-[var(--amber)]" }
      : { border: "border-[var(--blue-line)]", bg: "bg-[var(--blue-bg)]", text: "text-[var(--blue)]" };
  return (
    <div className={cn("rounded-md border p-2.5 text-[12px]", colors.border, colors.bg)}>
      <div className={cn("flex items-center gap-1.5 font-medium", colors.text)}>
        {icon}
        {text}
      </div>
      {children}
    </div>
  );
}

function HitCard({ hit }: { hit: Hit }) {
  const style = severityStyle[hit.severity];
  const m = hit.matter;
  const causeOrCategory = m ? (m.causeText ?? matterCategoryLabel[m.category]) : "—";
  const matterContent = m ? (
    <>
      <div className="flex items-center gap-2 text-[12px]">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[11px] text-muted-foreground">{m.code}</span>
        <span className="truncate font-medium">{m.title}</span>
        {m.canViewMatter && (
          <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary" />
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Field label="系统收案">{formatDate(m.intakeDate)}</Field>
        <Field label="当前状态">{matterStatusLabel[m.status]}</Field>
        <Field label="案由/类型">{causeOrCategory}</Field>
        <Field label="主办律师">{m.ownerName ?? "—"}</Field>
        <Field label="命中当事人">
          {hit.matchedName}{" "}
          <span className="text-foreground/70">
            ({m.partyRole ? partyRoleLabel[m.partyRole] : "—"}
            {m.partyStanding ? ` · ${litigationStandingLabel[m.partyStanding]}` : ""})
          </span>
        </Field>
        <Field label="证件号">
          {hit.matchedField === "idNumber" ? (
            <span className="font-mono">{hit.matchedValue}</span>
          ) : (
            "—"
          )}
        </Field>
      </div>
    </>
  ) : null;
  return (
    <li
      className="rounded-md border p-3"
      style={{
        borderColor: `${style.color}40`,
        backgroundColor: style.bg
      }}
    >
      {/* 头：严重度 + 命中字段 */}
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
          style={{ color: style.color, background: `${style.color}1A` }}
        >
          <AlertTriangle className="h-3 w-3" />
          {style.label}
        </span>
        <span className="text-muted-foreground">
          {hit.matchedField === "idNumber" ? "证件号一致" : hit.matchedRatio === 1 ? "姓名一致" : "姓名相似"}
        </span>
        {hit.matchedRatio !== null && hit.matchedRatio < 1 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {(hit.matchedRatio * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* 主：案件信息 */}
      {m ? (
        m.canViewMatter ? (
          <Link
            href={matterHref({ id: m.id, internalCode: m.code })}
            className="group mt-2 block rounded border border-border bg-background p-2.5 hover:border-primary/40"
          >
            {matterContent}
          </Link>
        ) : (
          <div className="mt-2 rounded border border-border bg-background p-2.5">
            {matterContent}
          </div>
        )
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">{hit.reason}</p>
      )}
    </li>
  );
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{label}：</span>
      <span className="truncate text-foreground/85">{children}</span>
    </div>
  );
}
