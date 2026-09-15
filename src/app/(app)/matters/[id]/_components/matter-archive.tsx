"use client";

/**
 * 案卷工作台「案件档案」页签（默认首屏，docs/UI-MATTER-DOSSIER-PLAN.md 第二版）：
 * 基本信息 → 当事人完整卡片 → 本程序信息 → 委托与收费 → 承办团队 → 自定义字段。
 */
import { useState } from "react";
import Link from "next/link";
import { FileText, Pencil, UserRound, Users } from "lucide-react";
import { FieldGrid, FieldItem, InitialAvatar } from "@/components/patterns/moan";
import { avatarTone } from "@/lib/ui/moan-tones";
import { litigationStandingLabel, matterCategoryKind, matterCategoryLabel, partyTypeLabel, procedureTypeLabel } from "@/lib/enums";
import { clientIdTypeLabel } from "@/lib/clients/person-id";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { RelatedMattersField } from "./related-matters-field";
import { ARBITRATION_TYPES, PROCEDURE_OUTCOME_LABEL, contactRoleLabels } from "./info-panel";
import { CustomFieldsPanel } from "./custom-fields-panel";
import type { MatterPayload } from "./matter-detail-tabs";

type Procedure = MatterPayload["procedures"][number];
type PartyRow = MatterPayload["parties"][number];

const ROLE_LABEL: Record<string, string> = {
  CLIENT_PARTY: "委托方",
  OPPOSING_PARTY: "对方当事人",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他参与人"
};
const PARTY_GROUPS: { key: string; title: string; roles: string[] }[] = [
  { key: "ours", title: "委托方", roles: ["CLIENT_PARTY", "CO_LITIGANT"] },
  { key: "opp", title: "对方当事人", roles: ["OPPOSING_PARTY"] },
  { key: "other", title: "第三人及其他", roles: ["THIRD_PARTY", "AGENT", "WITNESS", "OTHER"] }
];

const dash = (v: string | null | undefined) => v?.trim() || null;

function Section({ icon: Icon, title, hint, action, children }: { icon: typeof FileText; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="panel-head">
        <div className="panel-title">
          <Icon className="ic" strokeWidth={1.8} />
          {title}
          {hint ? <span className="t-xs t-mute" style={{ fontWeight: 400 }}>{hint}</span> : null}
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** 证件号默认打码，点击查看明文（数据已在本页授权范围内） */
function MaskedId({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const masked = value.length > 8 ? `${value.slice(0, 3)}${"•".repeat(value.length - 7)}${value.slice(-4)}` : value.replace(/.(?=.{2})/g, "•");
  return (
    <>
      <span className="min-w-0 truncate font-mono tabular-nums">{shown ? value : masked}</span>
      <button type="button" className="link-inline shrink-0" onClick={() => setShown((v) => !v)}>
        {shown ? "打码" : "明文"}
      </button>
    </>
  );
}

const CLAIMANT_STANDINGS = ["PLAINTIFF", "JOINT_PLAINTIFF", "APPELLANT", "RETRIAL_APPLICANT", "ENFORCEMENT_APPLICANT", "ARBITRATION_CLAIMANT", "ADMIN_RECONSIDERATION_APPLICANT", "ADMIN_PLAINTIFF"];
const RESPONDENT_STANDINGS = ["DEFENDANT", "JOINT_DEFENDANT", "APPELLEE", "RETRIAL_RESPONDENT", "EXECUTED_PERSON", "ARBITRATION_RESPONDENT", "ADMIN_RECONSIDERATION_RESPONDENT", "ADMIN_DEFENDANT"];

/** 诉讼地位配色（沿用 v1.3.2）：申请方青、被申请方橙、第三人紫、其他绿、未设置灰 */
function standingTone(standing: string | null) {
  if (!standing) return "slate";
  if (CLAIMANT_STANDINGS.includes(standing)) return "teal";
  if (RESPONDENT_STANDINGS.includes(standing)) return "amber";
  if (standing === "THIRD_PARTY") return "violet";
  return "green";
}

/**
 * 当事人紧凑卡片（沿用 v1.3.2 ProcedurePartyBlock 形式，2026-09-14 用户要求）：
 * 头像 + 名称 + 主体类型 / 证件 / 法定代表人标签，第二行联系人、电话、地址，右侧诉讼地位。
 */
function PartyBlock({ party, standings, clientHref }: { party: PartyRow; standings: string[]; clientHref: string | null }) {
  const isOrg = party.partyType !== "NATURAL_PERSON";
  const idValue = isOrg ? party.enterpriseSocialCode : party.idNumber;
  const idLabel = isOrg ? "信用代码" : party.idType && party.idType !== "ID_CARD" ? clientIdTypeLabel[party.idType] : "身份证";
  const primary = standings[0] ?? null;
  const contact = [
    party.contactName ? `联系人：${party.contactName}` : "",
    party.phone ? `电话：${party.phone}` : "",
    party.address ? `地址：${party.address}` : ""
  ].filter(Boolean);
  return (
    <div className={cn("dos-pb", `line-${standingTone(primary)}`)} title={[party.name, ...contact, party.notes ? `备注：${party.notes}` : ""].filter(Boolean).join("\n")}>
      <span className={cn("dos-pb-av", `tone-${standingTone(primary)}`)}>{party.name.trim().charAt(0) || "—"}</span>
      <div className="min-w-0 flex-1">
        <div className="dos-pb-top">
          <span className="dos-pb-name">{party.name || "—"}</span>
          <span className="dos-pb-chip">{partyTypeLabel[party.partyType]}</span>
          {party.role !== "CLIENT_PARTY" && party.role !== "OPPOSING_PARTY" && !standings.some((st) => litigationStandingLabel[st as keyof typeof litigationStandingLabel] === ROLE_LABEL[party.role]) ? <span className="dos-pb-chip">{ROLE_LABEL[party.role] ?? "当事人"}</span> : null}
          {idValue ? (
            <span className="dos-pb-chip">
              <span className="k">{idLabel}</span>
              <MaskedId value={idValue} />
            </span>
          ) : null}
          {isOrg && party.legalRep ? (
            <span className="dos-pb-chip">
              <span className="k">法定代表人</span>
              <span className="min-w-0 truncate">{party.legalRep}</span>
            </span>
          ) : null}
          {!isOrg || !party.enterpriseName || party.enterpriseName === party.name ? null : (
            <span className="dos-pb-chip">
              <span className="k">工商登记</span>
              <span className="min-w-0 truncate">{party.enterpriseName}</span>
            </span>
          )}
          {clientHref ? (
            <Link href={clientHref} className="link-inline text-[11px]">
              客户档案
            </Link>
          ) : null}
        </div>
        <div className="dos-pb-sub">{contact.length ? contact.join(" · ") : "暂无联系人、电话或地址"}</div>
        {party.notes?.trim() ? <div className="dos-pb-sub">备注：{party.notes}</div> : null}
      </div>
      <div className="dos-pb-standing">
        {standings.length ? (
          standings.map((s) => (
            <span key={s} className={cn("dos-pb-st", `tone-${standingTone(s)}`)}>
              {litigationStandingLabel[s as keyof typeof litigationStandingLabel] ?? s}
            </span>
          ))
        ) : (
          <span className="dos-pb-st tone-slate">未设置地位</span>
        )}
      </div>
    </div>
  );
}

export function MatterArchive({
  matter,
  currentProcedure,
  parties,
  customFieldDefs,
  customValues,
  canEdit,
  canEditCustom,
  canManageRelated,
  onEdit
}: {
  matter: MatterPayload;
  currentProcedure: Procedure | null;
  parties: PartyRow[];
  customFieldDefs: React.ComponentProps<typeof CustomFieldsPanel>["defs"];
  customValues: Record<string, string>;
  canEdit: boolean;
  canEditCustom: boolean;
  canManageRelated: boolean;
  onEdit: () => void;
}) {
  const kind = matterCategoryKind(matter.category);
  const isCriminal = matter.category === "CRIMINAL";
  const isArbitration = Boolean(currentProcedure && ARBITRATION_TYPES.includes(currentProcedure.type));
  const contactLabels = contactRoleLabels(currentProcedure?.type);
  const related = [
    ...matter.linksFrom.map((l) => ({ ...l.relatedMatter, relation: l.relation })),
    ...matter.linksTo.map((l) => ({ ...l.matter, relation: l.relation }))
  ].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const money = (v: number | null | undefined) => (v != null && v > 0 ? formatCurrency(v) : null);
  const standing = currentProcedure?.ourStanding ?? matter.ourStanding;
  const outcome = currentProcedure?.outcomeNote?.trim() || (currentProcedure?.outcome ? PROCEDURE_OUTCOME_LABEL[currentProcedure.outcome] : "");
  const procLabel = currentProcedure ? currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type] : null;
  const editBtn = canEdit ? (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
      <Pencil />
      编辑
    </button>
  ) : null;

  // 本程序诉讼地位：一个当事人在同一程序可有多个地位（如被告兼反诉原告）
  const normalize = (st: string) => (st === "JOINT_PLAINTIFF" ? "PLAINTIFF" : st === "JOINT_DEFENDANT" ? "DEFENDANT" : st);
  const standingsOf = (party: PartyRow) => {
    const rows = currentProcedure?.procedureParties.filter((pp) => pp.partyId === party.id).sort((a, b) => a.ordinal - b.ordinal).map((pp) => normalize(pp.standing)) ?? [];
    if (rows.length) return [...new Set(rows)];
    return party.standing ? [normalize(party.standing)] : [];
  };

  return (
    <>
      {/* 基本信息与当前程序信息合并为一张表（2026-09-14 用户要求） */}
      <Section icon={FileText} title="基本信息" hint={kind === "litigation" && procLabel ? `程序字段为当前程序「${procLabel}」` : undefined} action={editBtn}>
        <FieldGrid cols={2}>
          <FieldItem label="案件类别">{matterCategoryLabel[matter.category]}</FieldItem>
          <FieldItem label={isCriminal ? "涉嫌罪名" : kind === "litigation" ? "案由" : kind === "counsel" ? "顾问类型" : "业务类型"}>
            {kind === "litigation" ? dash(matter.cause?.name ?? matter.causeFreeText) : dash(kind === "counsel" ? matter.counselType : matter.businessType)}
          </FieldItem>
          <FieldItem label="收案日期" mono>{matter.intakeDate ? formatDate(matter.intakeDate) : null}</FieldItem>
          <FieldItem label="委托方">{dash(matter.primaryClient?.name ?? matter.clientLinks.map((l) => l.client.name).join("、"))}</FieldItem>
          {kind === "litigation" ? (
            <>
              {!isCriminal ? <FieldItem label="标的额" mono>{money(matter.claimAmount)}</FieldItem> : null}
              <FieldItem label="我方地位">{standing ? litigationStandingLabel[standing] : null}</FieldItem>
              {currentProcedure ? (
                <>
                  <FieldItem label="案号" mono>{dash(currentProcedure.caseNumber)}</FieldItem>
                  <FieldItem label={isArbitration ? "仲裁机构" : isCriminal ? "办案机关" : "受理机构"}>{dash(currentProcedure.handlingAgency)}</FieldItem>
                  <FieldItem label="管辖地">{dash(currentProcedure.jurisdiction)}</FieldItem>
                  <FieldItem label={isArbitration ? "受理时间" : "立案时间"} mono>{currentProcedure.acceptedAt ? formatDate(currentProcedure.acceptedAt) : null}</FieldItem>
                  <FieldItem label={contactLabels.lead}>
                    {currentProcedure.presidingJudge?.trim() ? (
                      <span>
                        {currentProcedure.presidingJudge}
                        {currentProcedure.presidingJudgeContact ? <span className="ml-2 font-mono text-[12px] font-normal text-[var(--t-secondary)]">{currentProcedure.presidingJudgeContact}</span> : null}
                      </span>
                    ) : null}
                  </FieldItem>
                  <FieldItem label={contactLabels.assistant}>
                    {currentProcedure.judgeAssistant?.trim() ? (
                      <span>
                        {currentProcedure.judgeAssistant}
                        {currentProcedure.judgeAssistantContact ? <span className="ml-2 font-mono text-[12px] font-normal text-[var(--t-secondary)]">{currentProcedure.judgeAssistantContact}</span> : null}
                      </span>
                    ) : null}
                  </FieldItem>
                  {currentProcedure.panel?.trim() ? <FieldItem label={isArbitration ? "仲裁庭" : "合议庭"} wide>{currentProcedure.panel}</FieldItem> : null}
                  {currentProcedure.concludedAt || outcome ? (
                    <>
                      <FieldItem label="结案时间" mono>{currentProcedure.concludedAt ? formatDate(currentProcedure.concludedAt) : null}</FieldItem>
                      <FieldItem label={isCriminal ? "处理结果" : "裁判结果"}>{outcome || null}</FieldItem>
                    </>
                  ) : null}
                </>
              ) : null}
              {!isCriminal && matter.category !== "ADMINISTRATIVE" ? (
                <FieldItem label={isArbitration ? "是否提出反请求" : "是否反诉"}>{matter.intake ? (matter.intake.counterclaim ? "是" : "否") : null}</FieldItem>
              ) : null}
              <FieldItem label="律协备案">{matter.barFiling && matter.barFiling !== "NONE" ? "已备案" : "未备案"}</FieldItem>
              {!isCriminal ? <FieldItem label={isArbitration ? "仲裁请求" : "诉讼请求"} wide>{matter.intake?.claimDescription?.trim() ? <span className="whitespace-pre-wrap">{matter.intake.claimDescription}</span> : null}</FieldItem> : null}
            </>
          ) : (
            <>
              <FieldItem label={kind === "counsel" ? "顾问期限" : "服务期间"} mono>
                {matter.serviceStart || matter.serviceEnd ? `${matter.serviceStart ? formatDate(matter.serviceStart) : "—"} ~ ${matter.serviceEnd ? formatDate(matter.serviceEnd) : "—"}` : null}
              </FieldItem>
              {kind === "project" ? <FieldItem label="项目金额" mono>{money(matter.claimAmount)}</FieldItem> : null}
              <FieldItem label="服务范围" wide>{matter.serviceScope?.trim() ? <span className="whitespace-pre-wrap">{matter.serviceScope}</span> : null}</FieldItem>
              {kind === "project" ? <FieldItem label="交付成果" wide>{dash(matter.deliverables)}</FieldItem> : null}
            </>
          )}
          <FieldItem label="关联案件" wide>
            <RelatedMattersField matterId={matter.id} related={related} canManage={canManageRelated} />
          </FieldItem>
        </FieldGrid>
      </Section>

      <Section icon={UserRound} title="当事人" hint={`${parties.length} 方 · 诉讼地位按当前程序${procLabel ? `「${procLabel}」` : ""}`} action={editBtn}>
        {parties.length === 0 ? (
          <p className="t-xs t-mute">暂未登记当事人</p>
        ) : (
          <div className="dos-party-groups">
            {PARTY_GROUPS.map((group) => {
              const rows = parties.filter((p) => group.roles.includes(p.role)).sort((a, b) => a.ordinal - b.ordinal);
              if (!rows.length) return null;
              return (
                <div key={group.key} className="dos-party-group">
                  <div className="dos-party-group-h">
                    {group.title}
                    <span>{rows.length}</span>
                  </div>
                  <div className="dos-party-list">
                    {rows.map((p) => (
                      <PartyBlock key={p.id} party={p} standings={standingsOf(p)} clientHref={p.id.startsWith("client:") ? `/clients/${p.id.slice(7)}` : null} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {customFieldDefs.length > 0 ? (
        <CustomFieldsPanel matterId={matter.id} defs={customFieldDefs} values={customValues} canEdit={canEditCustom} />
      ) : null}
    </>
  );
}

/** 案件档案侧栏：承办团队 */
export function TeamRailCard({ matter, canManage, onManage }: { matter: MatterPayload; canManage: boolean; onManage: () => void }) {
  const order = { LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 } as const;
  const members = [
    ...(matter.owner && !matter.members.some((m) => m.userId === matter.ownerId) ? [{ id: matter.owner.id, name: matter.owner.name, role: "LEAD" as const, roleName: (matter.owner as { roleName?: string }).roleName }] : []),
    ...matter.members.map((m) => ({ id: m.userId, name: m.user.name, role: m.role, roleName: m.user.roleName }))
  ].sort((a, b) => order[a.role] - order[b.role]);
  return (
    <div className="card">
      <div className="rail-sec-head">
        <Users className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
        承办团队
        {canManage ? (
          <button type="button" className="link border-0 bg-transparent p-0" onClick={onManage}>
            管理
          </button>
        ) : null}
      </div>
      {members.length === 0 ? (
        <div className="panel-body t-xs t-mute">暂无团队成员</div>
      ) : (
        members.map((m) => (
          <div key={`${m.id}-${m.role}`} className="member">
            <InitialAvatar name={m.name} tone={avatarTone(m.name)} />
            <div className="min-w-0">
              <div className="n truncate">{m.name}</div>
              <div className="r truncate">{m.roleName ?? "—"}</div>
            </div>
            <span className={cn("badge role-tag", m.role === "LEAD" ? "b-teal" : "b-slate")} style={{ fontSize: 10 }}>
              {m.role === "LEAD" ? "主办" : m.role === "CO_LEAD" ? "协办" : "助理"}
            </span>
          </div>
        ))
      )}
      {(matter as { teamAccessRestricted?: boolean }).teamAccessRestricted ? (
        <div className="panel-body" style={{ padding: "8px 14px" }}>
          <span className="t-xs t-mute">受限事项：不进入团队汇总视图</span>
        </div>
      ) : null}
    </div>
  );
}
