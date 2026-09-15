"use client";

/**
 * 案卷工作台「案件档案」页签（默认首屏，docs/UI-MATTER-DOSSIER-PLAN.md 第二版）：
 * 基本信息 → 当事人完整卡片 → 本程序信息 → 委托与收费 → 承办团队 → 自定义字段。
 */
import { useState } from "react";
import Link from "next/link";
import { Briefcase, FileText, Landmark, Pencil, UserRound, Users, Wallet } from "lucide-react";
import { FieldGrid, FieldItem, InitialAvatar } from "@/components/patterns/moan";
import { avatarTone } from "@/lib/ui/moan-tones";
import { litigationStandingLabel, matterCategoryKind, matterCategoryLabel, partyTypeLabel, procedureTypeLabel } from "@/lib/enums";
import { clientIdTypeLabel } from "@/lib/clients/person-id";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { RelatedMattersField } from "./related-matters-field";
import { ARBITRATION_TYPES, PROCEDURE_OUTCOME_LABEL, contactRoleLabels } from "./info-panel";
import { CustomFieldsPanel } from "./custom-fields-panel";
import type { EngagementRow } from "./engagement-panel";
import type { FinancePayload, MatterPayload } from "./matter-detail-tabs";

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
  { key: "ours", title: "我方", roles: ["CLIENT_PARTY", "CO_LITIGANT"] },
  { key: "opp", title: "对方", roles: ["OPPOSING_PARTY"] },
  { key: "other", title: "第三人及其他参与人", roles: ["THIRD_PARTY", "AGENT", "WITNESS", "OTHER"] }
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
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{shown ? value : masked}</span>
      <button type="button" className="link-inline text-[11.5px] font-normal" onClick={() => setShown((v) => !v)}>
        {shown ? "打码" : "明文"}
      </button>
    </span>
  );
}

function PartyCard({ party, standings, clientHref }: { party: PartyRow; standings: string[]; clientHref: string | null }) {
  const person = party.partyType === "NATURAL_PERSON";
  const idLabel = person ? (party.idType && party.idType !== "ID_CARD" ? clientIdTypeLabel[party.idType] : "居民身份证") : "统一社会信用代码";
  const idValue = person ? party.idNumber : party.enterpriseSocialCode;
  return (
    <article className="dos-party">
      <header className="dos-party-head">
        <InitialAvatar name={party.name} tone={avatarTone(party.name)} />
        <div className="min-w-0 flex-1">
          <div className="dos-party-name">
            {party.name}
            {clientHref ? (
              <Link href={clientHref} className="link-inline text-[11.5px] font-normal">
                客户档案
              </Link>
            ) : null}
          </div>
          <div className="dos-party-tags">
            <span className="badge b-white">{ROLE_LABEL[party.role] ?? "当事人"}</span>
            {standings.filter((s) => s !== ROLE_LABEL[party.role]).map((s) => (
              <span key={s} className={cn("badge", party.role === "CLIENT_PARTY" ? "b-teal" : "b-slate")}>{s}</span>
            ))}
            <span className="t-xs t-mute">{partyTypeLabel[party.partyType]}</span>
          </div>
        </div>
      </header>
      <FieldGrid cols={2}>
        <FieldItem label={idLabel}>{idValue ? <MaskedId value={idValue} /> : null}</FieldItem>
        {person ? (
          <FieldItem label="联系电话" mono>{dash(party.phone)}</FieldItem>
        ) : (
          <FieldItem label="法定代表人">{dash(party.legalRep)}</FieldItem>
        )}
        {!person ? <FieldItem label="联系电话" mono>{dash(party.phone)}</FieldItem> : null}
        <FieldItem label={person ? "联系人" : "经办联系人"}>{dash(party.contactName)}</FieldItem>
        {!person && party.enterpriseName && party.enterpriseName !== party.name ? <FieldItem label="工商登记名称" wide>{party.enterpriseName}</FieldItem> : null}
        <FieldItem label={person ? "住址" : "注册地址"} wide>{dash(party.address)}</FieldItem>
        {party.notes?.trim() ? <FieldItem label="备注" wide>{party.notes}</FieldItem> : null}
      </FieldGrid>
    </article>
  );
}

export function MatterArchive({
  matter,
  currentProcedure,
  parties,
  financeStats,
  engagements,
  customFieldDefs,
  customValues,
  canEdit,
  canEditCustom,
  canManageRelated,
  onEdit,
  onOpenFinance
}: {
  matter: MatterPayload;
  currentProcedure: Procedure | null;
  parties: PartyRow[];
  financeStats: FinancePayload["stats"] | null;
  engagements: EngagementRow[];
  customFieldDefs: React.ComponentProps<typeof CustomFieldsPanel>["defs"];
  customValues: Record<string, string>;
  canEdit: boolean;
  canEditCustom: boolean;
  canManageRelated: boolean;
  onEdit: () => void;
  onOpenFinance: () => void;
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
  const editBtn = canEdit ? (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
      <Pencil />
      编辑
    </button>
  ) : null;

  // 本程序诉讼地位：一个当事人在同一程序可有多个地位（如被告兼反诉原告）
  const standingsOf = (party: PartyRow) => {
    const rows = currentProcedure?.procedureParties.filter((pp) => pp.partyId === party.id).map((pp) => litigationStandingLabel[pp.standing]) ?? [];
    if (rows.length) return rows;
    return party.standing ? [litigationStandingLabel[party.standing]] : [];
  };

  const members = [
    ...(matter.owner && !matter.members.some((m) => m.userId === matter.ownerId) ? [{ id: matter.owner.id, name: matter.owner.name, role: "LEAD" as const, roleName: (matter.owner as { roleName?: string }).roleName }] : []),
    ...matter.members.map((m) => ({ id: m.userId, name: m.user.name, role: m.role, roleName: m.user.roleName }))
  ].sort((a, b) => ({ LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 })[a.role] - ({ LEAD: 0, CO_LEAD: 1, ASSISTANT: 2 })[b.role]);

  return (
    <>
      <Section icon={FileText} title="基本信息" action={editBtn}>
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

      <Section icon={UserRound} title="当事人" hint={`${parties.length} 方 · 诉讼地位按当前程序${currentProcedure ? `「${currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type]}」` : ""}`} action={editBtn}>
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
                      <PartyCard key={p.id} party={p} standings={standingsOf(p)} clientHref={p.id.startsWith("client:") ? `/clients/${p.id.slice(7)}` : null} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 非诉 / 顾问没有案号、受理机构、法官等程序字段 */}
      {currentProcedure && kind === "litigation" ? (
        <Section icon={Landmark} title="本程序信息" hint={currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type]} action={editBtn}>
          <FieldGrid cols={2}>
            <FieldItem label="案号" mono>{dash(currentProcedure.caseNumber)}</FieldItem>
            <FieldItem label={isArbitration ? "仲裁机构" : isCriminal ? "办案机关" : "受理机构"}>{dash(currentProcedure.handlingAgency)}</FieldItem>
            <FieldItem label="管辖地">{dash(currentProcedure.jurisdiction)}</FieldItem>
            <FieldItem label={isArbitration ? "受理时间" : "立案时间"} mono>{currentProcedure.acceptedAt ? formatDate(currentProcedure.acceptedAt) : null}</FieldItem>
            <FieldItem label={contactLabels.lead}>{dash(currentProcedure.presidingJudge)}</FieldItem>
            <FieldItem label="联系方式" mono>{dash(currentProcedure.presidingJudgeContact)}</FieldItem>
            <FieldItem label={contactLabels.assistant}>{dash(currentProcedure.judgeAssistant)}</FieldItem>
            <FieldItem label="联系方式" mono>{dash(currentProcedure.judgeAssistantContact)}</FieldItem>
            {currentProcedure.panel?.trim() ? <FieldItem label={isArbitration ? "仲裁庭" : "合议庭"} wide>{currentProcedure.panel}</FieldItem> : null}
            <FieldItem label="结案时间" mono>{currentProcedure.concludedAt ? formatDate(currentProcedure.concludedAt) : null}</FieldItem>
            <FieldItem label={isCriminal ? "处理结果" : "裁判结果"}>{outcome || null}</FieldItem>
          </FieldGrid>
        </Section>
      ) : null}

      <Section
        icon={Wallet}
        title="委托与收费"
        action={
          financeStats ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFinance}>
              财务明细
            </button>
          ) : null
        }
      >
        {engagements.length === 0 ? (
          <p className="t-xs t-mute">尚未关联委托合同</p>
        ) : (
          <div className="dos-eng-list">
            {engagements.map((row) => (
              <div key={row.engagement.id} className="dos-eng">
                <Briefcase className="h-4 w-4 shrink-0 text-[var(--t-muted)]" strokeWidth={1.8} />
                <div className="min-w-0 flex-1">
                  <div className="dos-eng-title">
                    {row.engagement.title}
                    <span className={cn("badge", row.engagement.endedAt ? "b-slate" : "b-green")}>{row.engagement.endedAt ? "已终止" : "生效中"}</span>
                  </div>
                  <div className="t-xs t-mute">
                    {row.engagement.client.name} · {row.engagement.startedAt ? formatDate(row.engagement.startedAt) : "—"} 起
                  </div>
                  {row.engagement.scopeText ? <div className="dos-eng-text">委托范围：{row.engagement.scopeText}</div> : null}
                  {row.engagement.feeNote ? <div className="dos-eng-text">收费约定：{row.engagement.feeNote}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {financeStats ? (
          <div className="dos-fee-strip">
            {[
              ["合同额", financeStats.contractAmount, ""],
              ["已收", financeStats.received, "green"],
              ["待收", Math.max(0, financeStats.receivable - financeStats.received), "amber"],
              ["已开票", financeStats.invoiced, ""]
            ].map(([k, v, tone]) => (
              <div key={k as string} className="dos-fee">
                <span className="k">{k}</span>
                <span className={cn("v", tone && `t-${tone}`)}>{(v as number) > 0 ? formatCurrency(v as number) : "—"}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section icon={Users} title="承办团队" action={editBtn}>
        {members.length === 0 ? (
          <p className="t-xs t-mute">暂无团队成员</p>
        ) : (
          <div className="dos-team">
            {members.map((m) => (
              <div key={`${m.id}-${m.role}`} className="dos-member">
                <InitialAvatar name={m.name} tone={avatarTone(m.name)} />
                <div className="min-w-0">
                  <div className="n">{m.name}</div>
                  <div className="r">{m.roleName ?? "—"}</div>
                </div>
                <span className={cn("badge ml-auto", m.role === "LEAD" ? "b-teal" : "b-slate")}>{m.role === "LEAD" ? "主办" : m.role === "CO_LEAD" ? "协办" : "助理"}</span>
              </div>
            ))}
          </div>
        )}
        {(matter as { teamAccessRestricted?: boolean }).teamAccessRestricted ? <p className="t-xs t-mute mt-2">受限事项：不进入团队汇总视图。</p> : null}
      </Section>

      {customFieldDefs.length > 0 ? (
        <CustomFieldsPanel matterId={matter.id} defs={customFieldDefs} values={customValues} canEdit={canEditCustom} />
      ) : null}
    </>
  );
}
