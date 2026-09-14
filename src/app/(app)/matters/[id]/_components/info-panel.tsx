"use client";
import { FieldGrid, FieldItem } from "@/components/patterns/moan";

import { useState } from "react";
import { FileText, Pencil } from "lucide-react";
import { litigationStandingLabel, matterCategoryKind } from "@/lib/enums";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { MatterPayload } from "./matter-detail-tabs";
import { RelatedMattersField } from "./related-matters-field";

const ARBITRATION_TYPES = [
  "COMMERCIAL_ARBITRATION",
  "LABOR_ARBITRATION",
  "ARBITRATION_SET_ASIDE",
  "ARBITRATION_ENFORCEMENT_REVIEW"
];

const EXECUTION_TYPES = [
  "ENFORCEMENT",
  "ENFORCEMENT_OBJECTION",
  "ADMIN_NON_LITIGATION_ENFORCEMENT",
  "CRIMINAL_ENFORCEMENT"
];

const dash = (v: string | null | undefined) => v?.trim() || "—";

// 商事仲裁配仲裁秘书，诉讼/劳动仲裁配书记员，不会同时出现
export function contactRoleLabels(type: string | undefined) {
  if (type && ARBITRATION_TYPES.includes(type)) {
    return { lead: "仲裁员", assistant: "仲裁秘书" };
  }

  if (type && EXECUTION_TYPES.includes(type)) {
    return { lead: "执行法官", assistant: "书记员" };
  }

  if (type && ["INVESTIGATION", "PROSECUTION_REVIEW"].includes(type)) {
    return type === "INVESTIGATION" ? { lead: "承办侦查员", assistant: "协办人员" } : { lead: "承办检察官", assistant: "检察官助理" };
  }

  return { lead: "主办法官", assistant: "书记员" };
}

const PROCEDURE_OUTCOME_LABEL: Record<string, string> = {
  WON: "胜诉",
  PARTIAL_WON: "部分胜诉",
  LOST: "败诉",
  MEDIATED: "调解",
  WITHDRAWN: "撤回",
  DISMISSED: "驳回",
  COMPLETED: "已完成",
  TRANSFERRED: "移送",
  OTHER: "其他"
};


export function InfoPanel({
  matter,
  currentProcedure,
  canEdit,
  canManageRelatedMatters,
  onEdit
}: {
  matter: MatterPayload;
  currentProcedure: MatterPayload["procedures"][number] | null;
  canEdit: boolean;
  canManageRelatedMatters: boolean;
  onEdit: () => void;
}) {
  // 关联案件（双向合并去重）
  const relatedMatters = [
    ...matter.linksFrom.map((l) => ({ ...l.relatedMatter, relation: l.relation })),
    ...matter.linksTo.map((l) => ({ ...l.matter, relation: l.relation }))
  ].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);

  // v0.35: 按案件类别分叉展示（诉讼/仲裁 vs 非诉/专项 vs 顾问）
  const kind = matterCategoryKind(matter.category);
  const period = (s: Date | null, e: Date | null) => {
    if (!s && !e) return "—";
    return `${s ? formatDate(s) : "—"} ~ ${e ? formatDate(e) : "—"}`;
  };
  const claimText = matter.claimAmount ? formatCurrency(Number(matter.claimAmount)) : "—";
  const isCriminal = matter.category === "CRIMINAL";
  const isAdministrative = matter.category === "ADMINISTRATIVE";
  // v1.1「信息总览」：只放标题区/侧栏没有的内容——案由、类别、状态、期限
  // 已由页头与 MatterKeypoints 承载，此处聚焦当前程序的档案字段
  const contactLabels = contactRoleLabels(currentProcedure?.type);

  const standing = currentProcedure?.ourStanding ?? matter.ourStanding;
  const isArbitration = Boolean(
    currentProcedure && ARBITRATION_TYPES.includes(currentProcedure.type)
  );
  const requestLabel = isArbitration ? "仲裁请求" : "诉讼请求";
  const requestContent = matter.intake?.claimDescription?.trim() || "";
  const causeText = matter.cause?.name?.trim() || matter.causeFreeText?.trim() || "";
  const clientName =
    matter.primaryClient?.name?.trim() ||
    matter.clientLinks.map((l) => l.client.name).join("、");
  const opposingNames = matter.parties
    .filter((p) => p.role === "OPPOSING_PARTY")
    .map((p) => p.name)
    .join("、");
  // barFiling 记录的是「是否需向律协备案」，NONE 视为未备案
  const barFilingText =
    matter.barFiling && matter.barFiling !== "NONE" ? "已备案" : "未备案";
  const counterclaimText = matter.intake ? (matter.intake.counterclaim ? "是" : "否") : "";
  const outcomeText = currentProcedure?.outcomeNote?.trim()
    || (currentProcedure?.outcome ? PROCEDURE_OUTCOME_LABEL[currentProcedure.outcome] : "");

  return (
    <div className="card">
      <div className="panel-head" style={{ borderBottom: "none", paddingBottom: 8 }}>
        <div className="ws-head min-w-0 flex-1">
          <div className="ic-wrap">
            <FileText strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2>信息总览</h2>
            <div className="desc truncate">
              {currentProcedure ? `当前程序档案字段` : "案件档案字段"}
              {matter.firmCaseNo ? ` · 所内编号 ${matter.firmCaseNo}` : ""}
            </div>
          </div>
          {canEdit ? (
            <div className="acts">
              <button type="button" onClick={onEdit} className="btn btn-secondary btn-sm">
                <Pencil strokeWidth={1.8} />
                编辑信息
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="panel-body" style={{ paddingTop: 4 }}>
        {kind === "litigation" ? (
          <FieldGrid cols={2}>
            <FieldItem label="收案时间" mono>{matter.intakeDate ? formatDate(matter.intakeDate) : "—"}</FieldItem>
            <FieldItem label={isArbitration ? "受理时间" : "立案时间"} mono>{currentProcedure?.acceptedAt ? formatDate(currentProcedure.acceptedAt) : "—"}</FieldItem>
            <FieldItem label={isCriminal ? "涉嫌罪名" : "案由"}>{dash(causeText)}</FieldItem>
            <FieldItem label="案号" mono>{dash(currentProcedure?.caseNumber)}</FieldItem>
            <FieldItem label={isCriminal ? "委托人" : "客户名称"}>{dash(clientName)}</FieldItem>
            {/* 刑事案件没有「相对方」「反诉」「标的」 */}
            {!isCriminal ? <FieldItem label={isAdministrative ? "被告行政机关" : "相对方"}>{dash(opposingNames)}</FieldItem> : null}
            <FieldItem label="我方地位">{standing ? litigationStandingLabel[standing] ?? standing : "—"}</FieldItem>
            {!isCriminal ? <FieldItem label="标的" mono>{claimText}</FieldItem> : null}
            {!isCriminal && !isAdministrative ? <FieldItem label={isArbitration ? "是否提出反请求" : "是否反诉"}>{dash(counterclaimText)}</FieldItem> : null}
            <FieldItem label="律协备案">{barFilingText}</FieldItem>
            <FieldItem label="管辖地">{dash(currentProcedure?.jurisdiction)}</FieldItem>
            <FieldItem label={isArbitration ? "仲裁机构" : isCriminal ? "办案机关" : "管辖机构"}>{dash(currentProcedure?.handlingAgency)}</FieldItem>
            <FieldItem label={contactLabels.lead}>{personName(currentProcedure?.presidingJudge)}</FieldItem>
            <FieldItem label="联系方式"><ContactText value={currentProcedure?.presidingJudgeContact} /></FieldItem>
            <FieldItem label={contactLabels.assistant}>{personName(currentProcedure?.judgeAssistant)}</FieldItem>
            <FieldItem label="联系方式"><ContactText value={currentProcedure?.judgeAssistantContact} /></FieldItem>
            {currentProcedure?.panel?.trim() ? <FieldItem label={isArbitration ? "仲裁庭" : "合议庭"} wide>{currentProcedure.panel}</FieldItem> : null}
            {requestContent && !isCriminal ? <FieldItem label={requestLabel} wide><ClampedText text={requestContent} /></FieldItem> : null}
            {outcomeText ? <FieldItem label={isCriminal ? "处理结果" : "裁判结果"} wide>{outcomeText}</FieldItem> : null}
            <FieldItem label="关联案件" wide>
              <RelatedMattersField matterId={matter.id} related={relatedMatters} canManage={canManageRelatedMatters} />
            </FieldItem>
          </FieldGrid>
        ) : (
          /* 非诉 / 专项 / 顾问：没有立案、案号、相对方、诉讼地位、法官等诉讼字段 */
          <FieldGrid cols={2}>
            <FieldItem label="收案时间" mono>{matter.intakeDate ? formatDate(matter.intakeDate) : "—"}</FieldItem>
            <FieldItem label={kind === "counsel" ? "顾问类型" : "业务类型"}>{dash(kind === "counsel" ? matter.counselType : matter.businessType)}</FieldItem>
            <FieldItem label="客户名称">{dash(clientName)}</FieldItem>
            <FieldItem label={kind === "counsel" ? "顾问期限" : "服务期间"} mono>{period(matter.serviceStart, matter.serviceEnd)}</FieldItem>
            {kind === "project" ? <FieldItem label="项目金额" mono>{claimText}</FieldItem> : null}
            {matter.serviceScope?.trim() ? <FieldItem label="服务范围" wide><ClampedText text={matter.serviceScope} /></FieldItem> : <FieldItem label="服务范围" wide>—</FieldItem>}
            {kind === "project" ? <FieldItem label="交付成果" wide>{dash(matter.deliverables)}</FieldItem> : null}
            <FieldItem label="关联案件" wide>
              <RelatedMattersField matterId={matter.id} related={relatedMatters} canManage={canManageRelatedMatters} />
            </FieldItem>
          </FieldGrid>
        )}
      </div>
    </div>
  );
}

/* —— Sub-components —— */

/** 长文本默认 4 行截断，可展开/收起（诉讼请求可能很长） */
function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const isLong = text.length > 120 || text.split("\n").length > 4;
  return (
    <span className="block">
      <span className={cn("block whitespace-pre-wrap break-words", !open && isLong && "line-clamp-4")}>
        {text}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[11px] text-primary hover:underline"
        >
          {open ? "收起" : "展开全文"}
        </button>
      )}
    </span>
  );
}


/** 人名为空时显示「未录入」 */
function personName(name?: string | null): React.ReactNode {
  const n = name?.trim();
  if (!n) return <span className="text-muted-foreground">未录入</span>;
  return n;
}

/** 联系方式（电话等）等宽展示，空值折叠为「—」 */
function ContactText({ value }: { value?: string | null }) {
  const v = value?.trim();
  if (!v) return <>—</>;
  return <span className="font-mono tabular">{v}</span>;
}

// 一行：移动端纵向堆叠（pair 间横线），md+ 横向排列（pair 间竖线）
export function InfoRow({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col divide-y divide-border border-b border-border last:border-b-0 md:flex-row md:divide-x md:divide-y-0",
        className
      )}
    >
      {children}
    </div>
  );
}

// 一个标签-取值对：标签灰底（暗），取值白底（亮）
export function Pair({
  label,
  grow,
  wide,
  tight,
  children
}: {
  label: string;
  grow?: boolean;
  wide?: boolean;
  /** 只占内容宽度（值不换行），用于收案时间等短字段，避免撑成两行 */
  tight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0",
        tight ? "md:flex-none" : wide ? "md:flex-[3]" : grow ? "md:flex-[2]" : "md:flex-1"
      )}
    >
      <div className="w-[68px] shrink-0 border-r border-border bg-muted/50 px-2 py-2 text-[11.5px] leading-snug text-muted-foreground">
        <AlignedLabel label={label} />
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 bg-card px-2.5 py-2 text-[12.5px] leading-snug text-foreground/95",
          tight ? "whitespace-nowrap" : "break-words"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function AlignedLabel({ label }: { label: string }) {
  const chars = Array.from(label);
  if (chars.length > 1 && chars.length < 4) {
    return (
      <span className="flex w-[4em] justify-between whitespace-nowrap">
        {chars.map((char, index) => (
          <span key={`${char}-${index}`}>{char}</span>
        ))}
      </span>
    );
  }

  return <span className="whitespace-nowrap">{label}</span>;
}
