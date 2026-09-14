import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Folder, Plus, Users, CreditCard, UserRound } from "lucide-react";
import { getClientById, getClientFinanceSummary } from "@/server/clients/actions";
import { getClientInsights } from "@/server/clients/insights";
import { isManager } from "@/lib/permissions";
import { maskIdNumber } from "@/lib/clients/id-number-crypto";
import { clientTypeLabel, cooperationStatusLabel, genderLabel, matterCategoryLabel, matterStatusLabel } from "@/lib/enums";
import { matterHref } from "@/lib/matters/route";
import { avatarTone, matterSpineTone, matterStatusTone } from "@/lib/ui/moan-tones";
import { FieldGrid, FieldItem, InitialAvatar } from "@/components/patterns/moan";
import { ClientEditButton } from "./_components/client-edit-button";
import { AddContactButton, MergeBanner, RevealValue } from "./_components/client-detail-parts";

const COOP_BADGE: Record<string, string> = { POTENTIAL: "b-slate", NEGOTIATING: "b-amber", SIGNED: "b-teal", TERMINATED: "b-bronze" };
const ACTIVE = new Set(["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"]);

const compact = (n: number) => (n >= 1_000_000 ? `¥${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `¥${Math.round(n / 1000)}K` : `¥${Math.round(n).toLocaleString("zh-CN")}`);
const yuan = (n: number) => `¥${Math.round(n).toLocaleString("zh-CN")}`;
const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : "—");
const mmdd = (d: string) => new Date(d).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).replace("/", "-");
const maskPhone = (phone: string | null | undefined) => (!phone ? "" : /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone.length > 4 ? `${phone.slice(0, 2)}****${phone.slice(-2)}` : phone);

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientById(id).catch(() => null);
  if (!client) notFound();
  const session = await requireSession("clients.read");
  const canReadFinance = hasCustomPermission(session.user, "finance.read");
  const canWrite = hasCustomPermission(session.user, "clients.write");
  const canMerge = canWrite && (isManager(session.user.role) || session.user.role === "CUSTOM");
  const [finance, insights] = await Promise.all([
    canReadFinance ? getClientFinanceSummary(id) : Promise.resolve(null),
    getClientInsights(id)
  ]);

  const isIndividual = client.type === "INDIVIDUAL";
  const activeCount = insights.matters.filter((m) => ACTIVE.has(m.status)).length;
  const maskedId = maskIdNumber(client.idNumber);
  const visibleMatters = insights.matters.slice(0, 6);
  const paidBase = finance ? (finance.receivable > 0 ? finance.receivable : finance.contractTotal) : 0;
  const paidRate = finance && paidBase > 0 ? Math.min(100, Math.round((finance.received / paidBase) * 100)) : 0;
  const intakeHref = `/matters?tab=intake&new=1&clientId=${client.id}`;

  return (
    <div className="mo-client">
      <Link href="/clients" className="mo-back">
        <ChevronLeft className="h-3.5 w-3.5" />
        返回客户列表
      </Link>

      {canMerge && insights.suspects.length > 0 ? <MergeBanner keepId={client.id} keepName={client.name} suspects={insights.suspects} canMerge={canMerge} /> : null}

      <div className="card client-hero">
        <div className="ch-top flex-wrap">
          <div className="ch-logo">{client.name.trim().charAt(0) || "客"}</div>
          <div style={{ minWidth: 0 }} className="flex-1">
            <h1 className="ch-name truncate" title={client.name}>{client.name}</h1>
            <div className="ch-badges">
              <span className="badge b-white">{clientTypeLabel[client.type]}</span>
              {client.source ? <span className="src-chip party">来源：{client.source}</span> : null}
              <span className={`badge ${COOP_BADGE[client.cooperationStatus] ?? "b-white"}`}><span className="bdot" />{cooperationStatusLabel[client.cooperationStatus]}</span>
              {activeCount > 0 ? <span className="badge b-blue"><span className="bdot" />在办 {activeCount} 件</span> : null}
              {client.tags.slice(0, 3).map((t) => <span key={t} className="badge b-white">{t}</span>)}
            </div>
            <div className="ch-meta">
              <div className="m">
                <span className="k">{isIndividual ? "身份证号" : "统一社会信用代码"}</span>
                {maskedId ? <RevealValue kind="clientId" id={client.id} masked={maskedId} className="v mono" /> : <span className="v t-faint">未登记</span>}
              </div>
              {!isIndividual ? <div className="m"><span className="k">法定代表人</span><span className="v">{client.legalRep || "—"}</span></div> : null}
              <div className="m"><span className="k">建档</span><span className="v mono">{ymd(client.createdAt)}</span></div>
              {client.address ? <div className="m"><span className="k">{isIndividual ? "住所地" : "注册地"}</span><span className="v max-w-[260px] truncate" title={client.address}>{client.address}</span></div> : null}
            </div>
          </div>
          <div className="ch-stats">
            <div className="ch-stat"><div className="n">{insights.matters.length}</div><div className="l">累计案件</div></div>
            <div className="ch-stat"><div className="n" style={{ color: "var(--teal-deep)" }}>{activeCount}</div><div className="l">办理中</div></div>
            <div className="ch-stat"><div className="n">{finance ? compact(finance.received) : "—"}</div><div className="l">累计实收</div></div>
            <div className="ch-stat"><div className="n" style={{ color: finance && finance.pending > 0 ? "var(--amber)" : undefined }}>{finance ? compact(finance.pending) : "—"}</div><div className="l">待回款</div></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          {hasCustomPermission(session.user, "intakes.create") ? (
            <Link href={intakeHref} className="btn btn-primary btn-sm"><Plus />为此客户新建收案</Link>
          ) : null}
          {canWrite ? <ClientEditButton client={client} /> : null}
          <Link href={`/conflicts?name=${encodeURIComponent(client.name)}`} className="btn btn-secondary btn-sm">冲突检索</Link>
          {canMerge && insights.suspects.length === 0 ? <MergeBanner keepId={client.id} keepName={client.name} suspects={[]} canMerge={canMerge} /> : null}
          <div style={{ flex: 1 }} />
          <span className="t-xs t-faint">资料修改与审计同事务留痕 · 证件与电话明文查看逐次审计</span>
        </div>
      </div>

      <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_296px]">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="panel-head">
              <div className="panel-title">
                <Folder className="ic" strokeWidth={1.8} />
                关联案件 <span className="badge b-white" style={{ marginLeft: 2 }}>{insights.matters.length}</span>
              </div>
              <Link href={`/matters?tab=all&search=${encodeURIComponent(client.name)}`} className="t-sm t-mute">按客户筛选案件列表 →</Link>
            </div>
            {visibleMatters.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无可见的关联案件</div><div className="mo-empty-desc">案件正文按各自权限访问；无权查看的案件不在此列出。</div></div>
            ) : (
              visibleMatters.map((m) => (
                <Link key={m.id} href={matterHref(m)} className="mrow mo-spine no-underline" data-spine={matterSpineTone(m.status)} style={{ color: "inherit" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mr-name truncate">{m.title}</div>
                    <div className="mr-meta truncate">
                      {[m.procedure ?? matterCategoryLabel[m.category], m.stage, m.ownerName ? `主办 ${m.ownerName}` : null, ACTIVE.has(m.status) ? m.internalCode : `${m.year}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className={`badge b-${matterStatusTone(m.status)}`}><span className="bdot" />{matterStatusLabel[m.status]}</span>
                  <span className="mr-money">{m.contract ? compact(m.contract) : ""}</span>
                </Link>
              ))
            )}
            {insights.matters.length > visibleMatters.length ? (
              <div className="panel-foot" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="t-xs t-mute">还有 {insights.matters.length - visibleMatters.length} 件 · 归档案件正文按归档权限访问</span>
                <Link href={`/matters?tab=all&search=${encodeURIComponent(client.name)}`} className="t-sm" style={{ color: "var(--teal-deep)", fontWeight: 550 }}>查看全部 →</Link>
              </div>
            ) : null}
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div className="panel-head">
              <div className="panel-title">
                <Users className="ic" strokeWidth={1.8} />
                联系人 <span className="badge b-white" style={{ marginLeft: 2 }}>{client.contacts.length}</span>
              </div>
              {canWrite && (isManager(session.user.role) || session.user.role === "CUSTOM") ? <AddContactButton clientId={client.id} /> : null}
            </div>
            {client.contacts.length === 0 ? (
              <div className="empty mo-empty-compact"><div className="mo-empty-title">暂无联系人</div></div>
            ) : (
              client.contacts.map((c) => (
                <div key={c.id} className="contact">
                  <InitialAvatar name={c.name} tone={c.isPrimary ? "teal" : avatarTone(c.name)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ct-name flex flex-wrap items-center gap-1.5">
                      {c.name}
                      {c.isPrimary ? <span className="badge b-teal" style={{ fontSize: 10 }}>主要联系人</span> : null}
                      {c.title ? <span className="badge b-white" style={{ fontSize: 10 }}>{c.title}</span> : null}
                    </div>
                    <div className="ct-meta flex flex-wrap items-center gap-x-1.5">
                      {c.phone ? <RevealValue kind="contactPhone" id={c.id} masked={maskPhone(c.phone)} /> : null}
                      {c.email ? <span>· {c.email}</span> : null}
                    </div>
                  </div>
                  <span className="t-xs t-faint hidden sm:inline">号码默认打码 · 按需查看</span>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="panel-head">
              <div className="panel-title">
                <UserRound className="ic" strokeWidth={1.8} />
                {isIndividual ? "个人信息" : "工商信息"}
              </div>
            </div>
            <div className="panel-body" style={{ paddingTop: 4 }}>
              <FieldGrid cols={2}>
                <FieldItem label="客户编号" mono>{client.internalCode || "—"}</FieldItem>
                <FieldItem label="客户来源">{client.source || "—"}</FieldItem>
                <FieldItem label="所属行业">{client.industry || "—"}</FieldItem>
                {isIndividual ? <FieldItem label="性别">{client.gender ? genderLabel[client.gender] : "—"}</FieldItem> : <FieldItem label="法定代表人">{client.legalRep || "—"}</FieldItem>}
                {isIndividual ? <FieldItem label="民族">{client.ethnicity || "—"}</FieldItem> : null}
                <FieldItem label="联系电话" mono>{maskPhone(client.phone) || "—"}</FieldItem>
                <FieldItem label="邮箱">{client.email || "—"}</FieldItem>
                <FieldItem label="住所地" wide>{client.address || "—"}</FieldItem>
                {client.notes ? <FieldItem label="备注" wide><span className="whitespace-pre-wrap">{client.notes}</span></FieldItem> : null}
              </FieldGrid>
            </div>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }} className="min-w-0 xl:sticky xl:top-[68px]">
          <div className="card">
            <div className="panel-head">
              <div className="panel-title" style={{ fontSize: 13 }}><CreditCard className="ic" strokeWidth={1.8} />财务往来</div>
              <span className="t-xs t-mute">累计</span>
            </div>
            {finance ? (
              <div className="panel-body" style={{ paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="t-sm t-mute">合同总额</span><span className="num-md">{yuan(finance.contractTotal)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="t-sm t-mute">累计实收</span><span className="num-md" style={{ color: "var(--green)" }}>{yuan(finance.received)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="t-sm t-mute">待回款</span><span className="num-md" style={{ color: finance.pending ? "var(--amber)" : undefined }}>{yuan(finance.pending)}</span></div>
                <div className="progress" style={{ marginTop: 10 }}><div className="progress-fill" style={{ width: `${paidRate}%` }} /></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}><span className="t-xs t-mute">回款进度</span><span className="num-sm t-mute">{paidRate}%</span></div>
              </div>
            ) : (
              <div className="panel-body t-xs t-mute">无财务查看权限</div>
            )}
          </div>

          <div className="card">
            <div className="panel-head">
              <div className="panel-title" style={{ fontSize: 13 }}><UserRound className="ic" strokeWidth={1.8} />来源渠道</div>
              <span className="t-xs t-mute">{insights.matters.length} 个案件</span>
            </div>
            {insights.source ? (
              <div className="src-bars">
                <div className="src-bar">
                  <span className="n truncate" title={insights.source.name}>{insights.source.name}</span>
                  <div className="track"><div className="fill" style={{ width: `${Math.max(6, (insights.source.sameSourceClients / Math.max(1, insights.source.totalClients)) * 100)}%`, background: "var(--teal)" }} /></div>
                  <span className="v">{insights.source.sameSourceClients} 家</span>
                </div>
                <div className="t-xs t-mute" style={{ marginTop: 6 }}>所内同渠道客户占比 {Math.round((insights.source.sameSourceClients / Math.max(1, insights.source.totalClients)) * 100)}%</div>
              </div>
            ) : (
              <div className="panel-body t-xs t-mute">建档时未登记客户来源，可在「编辑资料」补充。</div>
            )}
            <div className="panel-foot"><span className="t-xs t-mute">渠道随客户建档留痕，进入所级来源分布报表</span></div>
          </div>

          <div className="card">
            <div className="panel-head"><div className="panel-title" style={{ fontSize: 13 }}>最近动态</div></div>
            <div className="panel-body" style={{ paddingTop: 12 }}>
              {insights.activity.length === 0 ? (
                <div className="t-xs t-mute">暂无动态</div>
              ) : (
                <div className="timeline">
                  {insights.activity.map((a) => (
                    <div key={a.key} className={`tl-item ${a.tone}`}>
                      <div style={{ fontSize: 12.5, fontWeight: 550 }}>{a.title}</div>
                      <div className="t-xs t-mute" style={{ marginTop: 2 }}>{mmdd(a.at)} · {a.meta}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
