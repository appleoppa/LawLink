import { requireSession } from "@/lib/auth/session";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  User,
  Briefcase,
  Phone,
  Mail,
  Plus,
  ScanSearch
} from "lucide-react";
import { getClientById, getClientFinanceSummary } from "@/server/clients/actions";
import { isManager } from "@/lib/permissions";
import { maskIdNumber } from "@/lib/clients/id-number-crypto";
import { ClientMergeCard } from "./_components/client-merge-card";
import {
  clientTypeLabel,
  cooperationStatusLabel,
  genderLabel,
  matterCategoryLabel,
  matterStatusLabel
} from "@/lib/enums";
import { cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";
import { ClientEditButton } from "./_components/client-edit-button";

const billingStatusLabel: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "生效中",
  CLOSED: "已结"
};
const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;
const dash = <span className="text-muted-foreground/50">—</span>;

/** 墨案徽章（moan.css）：合作状态 → 语义色，与客户列表保持一致 */
const COOP_BADGE: Record<string, string> = {
  POTENTIAL: "b-slate",
  NEGOTIATING: "b-amber",
  SIGNED: "b-teal",
  TERMINATED: "b-bronze"
};

const ACTIVE_MATTER_STATUSES = new Set(["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"]);

/** 墨案 03：列表脊线与状态徽章按案件状态着色（蓝在办 / 绿结案 / 金归档） */
function matterTone(status: string): { spine: string; badge: string } {
  if (status === "ARCHIVED") return { spine: "#8A6B3E", badge: "b-bronze" };
  if (status === "CLOSED") return { spine: "#1A7F45", badge: "b-green" };
  if (ACTIVE_MATTER_STATUSES.has(status)) return { spine: "#1E56C8", badge: "b-blue" };
  return { spine: "#8296A1", badge: "b-slate" };
}

function firstChar(value: string) {
  return value.trim().slice(0, 1) || "客";
}

function dateText(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("zh-CN");
}

/** 电话默认打码（PII 底线：日志与展示均不出全号） */
function maskPhone(phone: string | null | undefined) {
  if (!phone) return null;
  if (/^\d{11}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  return phone.length > 4 ? `${phone.slice(0, 2)}****${phone.slice(-2)}` : phone;
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = await getClientById(params.id);
  if (!client) notFound();
  const session = await requireSession("clients.read");
  const canReadFinance = hasCustomPermission(session.user, "finance.read");
  const finance = canReadFinance ? await getClientFinanceSummary(params.id) : { contractTotal: 0, receivable: 0, received: 0, pending: 0, matterCount: 0, billings: [] };

  const isIndividual = client.type === "INDIVIDUAL";
  const TypeIcon = isIndividual ? User : client.type === "COMPANY" ? Building2 : Briefcase;
  const primaryContact = client.contacts[0] ?? null;
  const canWrite = hasCustomPermission(session.user, "clients.write");

  // 按案件分组合同（关联案件行的合同副行）
  const billingsByMatter = new Map<string, typeof finance.billings>();
  for (const b of finance.billings) {
    const arr = billingsByMatter.get(b.matter.id) ?? [];
    arr.push(b);
    billingsByMatter.set(b.matter.id, arr);
  }

  const activeMatterCount = client.matters.filter((m) => ACTIVE_MATTER_STATUSES.has(m.status)).length;
  const paidRate =
    finance.receivable > 0
      ? Math.min(100, Math.round((finance.received / finance.receivable) * 100))
      : finance.contractTotal > 0
        ? Math.min(100, Math.round((finance.received / finance.contractTotal) * 100))
        : 0;

  return (
    <div className="space-y-3.5">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        返回客户列表
      </Link>

      {/* P0 合并提示（效果图 10 merge-banner：疑似重复档案置顶提示） */}
      {(isManager(session.user.role) || (session.user.role === "CUSTOM" && canWrite)) && (
        <ClientMergeCard keepId={client.id} keepName={client.name} />
      )}

      {/* 客户 Hero（效果图 10 client-hero：logo + 徽章 + meta + 右侧四统计 + 操作行） */}
      <section className="ll-surface px-5 pb-4 pt-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 gap-4">
            <div
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px] text-[20px] font-bold text-white"
              style={{
                background: "linear-gradient(150deg, #16324F, #10233A 60%, #0C1927)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 1px 2px rgba(12,25,39,0.10)"
              }}
            >
              {firstChar(client.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[20px] font-bold tracking-[-0.015em]" title={client.name}>
                {client.name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="badge b-white">{clientTypeLabel[client.type]}</span>
                <span className={`badge ${COOP_BADGE[client.cooperationStatus] ?? "b-white"}`}>
                  <span className="bdot" aria-hidden />
                  {cooperationStatusLabel[client.cooperationStatus]}
                </span>
                {activeMatterCount > 0 && (
                  <span className="badge b-blue">
                    <span className="bdot" aria-hidden />
                    在办 {activeMatterCount} 件
                  </span>
                )}
                {client.source && <span className="badge b-white">来源：{client.source}</span>}
                {client.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="badge b-white">{tag}</span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[#E8ECEA] pt-3 text-[12px]">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{isIndividual ? "证件号" : "信用代码"}</span>
                  <span className="font-mono font-medium">{maskIdNumber(client.idNumber) || dash}</span>
                </span>
                {!isIndividual && (
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[11px] text-muted-foreground">法定代表人</span>
                    <span className="font-semibold">{client.legalRep || dash}</span>
                  </span>
                )}
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[11px] text-muted-foreground">建档</span>
                  <span className="font-mono font-medium">{dateText(client.createdAt)}</span>
                </span>
                {client.address && (
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[11px] text-muted-foreground">{isIndividual ? "住所地" : "注册地"}</span>
                    <span className="max-w-[220px] truncate font-semibold" title={client.address}>{client.address}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧四统计（效果图 10 ch-stats：竖分隔、右对齐等宽数字） */}
          <div className="flex flex-wrap shrink-0 xl:ml-auto xl:pl-2">
            <ChStat n={canReadFinance ? String(finance.matterCount) : "—"} l="累计案件" />
            <ChStat n={`${activeMatterCount}`} l="办理中" fg="#005054" />
            <ChStat n={canReadFinance ? yuan(finance.received) : "—"} l="累计实收" />
            <ChStat n={canReadFinance ? yuan(finance.pending) : "—"} l="待收" fg="#96650B" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href="/intakes" className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            为此客户新建收案
          </Link>
          {canWrite && (
            <span className="btn btn-secondary btn-sm inline-flex">
              <ClientEditButton client={client} />
            </span>
          )}
          <Link href="/conflicts" className="btn btn-secondary btn-sm">
            <ScanSearch className="h-3.5 w-3.5" strokeWidth={1.8} />
            冲突检索
          </Link>
          <div className="flex-1" />
          <span className="self-center text-[11px] text-[#98A3AD]">资料修改与审计同事务留痕</span>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_296px]">
        {/* 左列：关联案件 + 联系人 + 工商/个人信息 */}
        <div className="min-w-0 space-y-3.5">
          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title">
                <Briefcase className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                关联案件
                <span className="badge b-white ml-0.5">{client.matters.length}</span>
              </h2>
              <Link href={`/matters?search=${encodeURIComponent(client.name)}`} className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
                按客户筛选案件列表 →
              </Link>
            </header>

            {client.matters.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">暂无关联案件</p>
            ) : (
              client.matters.map((m) => {
                const tone = matterTone(m.status);
                const bs = billingsByMatter.get(m.id) ?? [];
                const contractSum = bs.reduce((n, b) => n + b.contractAmount, 0);
                return (
                  <div key={m.id} className="relative border-b border-[#E8ECEA] py-2.5 pl-[22px] pr-4 transition-colors last:border-b-0 hover:bg-[#F7FAF9]">
                    <span className="absolute left-0 top-[9px] bottom-[9px] w-[3px] rounded-r" style={{ background: tone.spine }} aria-hidden />
                    <Link href={matterHref(m)} className="group flex min-w-0 items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.75px] font-semibold transition-colors group-hover:text-[#005054]">
                          {m.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          <span className="font-mono">{m.internalCode}</span>
                          {" · "}
                          {matterCategoryLabel[m.category]}
                          {" · "}
                          {bs.length > 0
                            ? bs.map((b) => `${b.title}（${billingStatusLabel[b.status] ?? b.status} ${yuan(b.contractAmount)}）`).join(" · ")
                            : `更新 ${dateText(m.updatedAt)}`}
                        </span>
                      </span>
                      <span className={`badge ${tone.badge} shrink-0`}>
                        <span className="bdot" aria-hidden />
                        {matterStatusLabel[m.status]}
                      </span>
                      {contractSum > 0 && (
                        <span className="shrink-0 font-mono text-[12.5px] font-semibold tabular">{yuan(contractSum)}</span>
                      )}
                    </Link>
                  </div>
                );
              })
            )}
            <footer className="border-t border-[#E8ECEA] px-4 py-2.5 text-[11px] text-muted-foreground">
              案件正文按各自权限访问；此处仅汇总本客户的关联与合同信息。
            </footer>
          </section>

          {/* 联系人（效果图 10 contact：头像 + 主要联系人徽章 + 打码联系方式） */}
          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title">
                <Phone className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                联系人
                <span className="badge b-white ml-0.5">{client.contacts.length}</span>
              </h2>
              {canWrite && (
                <span className="text-[11px] text-muted-foreground">编辑资料中维护联系人</span>
              )}
            </header>
            {client.contacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无联系人</p>
            ) : (
              client.contacts.map((contact) => (
                <div key={contact.id} className="flex items-center gap-2.5 border-b border-[#E8ECEA] px-4 py-3 last:border-b-0">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold",
                      contact.isPrimary ? "bg-[#E4F1F0] text-[#005054]" : "bg-[#EDF1EF] text-[#5B6B75]"
                    )}
                  >
                    {firstChar(contact.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-semibold">{contact.name}</span>
                      {contact.isPrimary && <span className="badge b-teal !text-[10px]">主要联系人</span>}
                      {contact.title && <span className="badge b-white !text-[10px]">{contact.title}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {contact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" strokeWidth={1.8} />
                          <span className="font-mono">{maskPhone(contact.phone)}</span>
                        </span>
                      )}
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" strokeWidth={1.8} />
                          <span className="truncate">{contact.email}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-[#98A3AD]">号码默认打码</span>
                </div>
              ))
            )}
          </section>

          {/* 工商 / 个人信息 */}
          <section className="ll-surface p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="ll-panel-title">
                <TypeIcon className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                {isIndividual ? "个人信息" : "工商信息"}
              </h2>
            </header>
            <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-px overflow-hidden rounded-md border border-border bg-border text-[12.5px] sm:grid-cols-[84px_minmax(0,1fr)_84px_minmax(0,1fr)]">
              <L>客户编号</L>
              <V mono title={client.internalCode ?? undefined}>{client.internalCode || dash}</V>
              <L>客户来源</L>
              <V title={client.source ?? undefined}>{client.source || dash}</V>

              {isIndividual ? (
                <>
                  <L>身份证号</L>
                  <V mono title="证件号（已加密存储，展示打码）">{maskIdNumber(client.idNumber) || dash}</V>
                  <L>性别</L>
                  <V>{client.gender ? genderLabel[client.gender] : dash}</V>
                  <L>所属行业</L>
                  <V title={client.industry ?? undefined}>{client.industry || dash}</V>
                  <L>民族</L>
                  <V>{client.ethnicity || dash}</V>
                </>
              ) : (
                <>
                  <L>信用代码</L>
                  <V mono title="信用代码（已加密存储，展示打码）">{maskIdNumber(client.idNumber) || dash}</V>
                  <L>法定代表人</L>
                  <V title={client.legalRep ?? undefined}>{client.legalRep || dash}</V>
                  <L>所属行业</L>
                  <V title={client.industry ?? undefined}>{client.industry || dash}</V>
                  <L>邮箱</L>
                  <V title={client.email ?? undefined}>{client.email || dash}</V>
                </>
              )}

              <L>联系电话</L>
              <V mono title={primaryContact?.phone ?? client.phone ?? undefined}>
                {maskPhone(primaryContact?.phone ?? client.phone) || dash}
              </V>
              <L>邮箱</L>
              <V title={client.email ?? undefined}>{client.email || dash}</V>

              <L>住所地</L>
              <V wide title={client.address ?? undefined}>{client.address || dash}</V>

              {client.notes && (
                <>
                  <L>备注</L>
                  <V wide nowrap={false}>
                    <span className="whitespace-pre-wrap">{client.notes}</span>
                  </V>
                </>
              )}
            </dl>
          </section>
        </div>

        {/* 右栏：财务往来 + 客户概况 */}
        <aside className="min-w-0 space-y-3.5 xl:sticky xl:top-16">
          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title text-[13px]">财务往来</h2>
              <span className="text-[10.5px] text-muted-foreground">累计</span>
            </header>
            <div className="px-4 pb-4 pt-2.5">
              <div className="flex items-baseline justify-between py-1">
                <span className="text-[12px] text-muted-foreground">累计合同</span>
                <span className="font-mono text-[14px] font-semibold tabular">{canReadFinance ? yuan(finance.contractTotal) : "未授权"}</span>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <span className="text-[12px] text-muted-foreground">累计实收</span>
                <span className="font-mono text-[14px] font-semibold tabular text-[#1A7F45]">{canReadFinance ? yuan(finance.received) : "—"}</span>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <span className="text-[12px] text-muted-foreground">待收</span>
                <span className="font-mono text-[14px] font-semibold tabular text-[#96650B]">{canReadFinance ? yuan(finance.pending) : "—"}</span>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#EDF1EF]">
                <div className="h-full rounded-full bg-[#007B7F]" style={{ width: `${paidRate}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>已确认回款</span>
                <span className="font-mono tabular">
                  {canReadFinance ? `${yuan(finance.received)} · ${paidRate}%` : "—"}
                </span>
              </div>
            </div>
          </section>

          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title text-[13px]">客户概况</h2>
            </header>
            <div className="px-4 pb-3 pt-1">
              <SummaryField label="合作状态" value={cooperationStatusLabel[client.cooperationStatus]} />
              <SummaryField label="客户类型" value={clientTypeLabel[client.type]} />
              <SummaryField label="建档" value={dateText(client.createdAt)} mono />
              <SummaryField label="最近更新" value={dateText(client.updatedAt)} mono />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Hero 右侧统计格（效果图 10 ch-stat：竖分隔、等宽右对齐） */
function ChStat({ n, l, fg }: { n: string; l: string; fg?: string }) {
  return (
    <div className="border-l border-[#E8ECEA] px-[22px] py-1 text-right first:border-l-0 first:pl-0">
      <div className="font-mono text-[19px] font-bold leading-none tabular" style={fg ? { color: fg } : undefined}>
        {n}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">{l}</div>
    </div>
  );
}

function SummaryField({
  label,
  value,
  accent,
  mono
}: {
  label: string;
  value: React.ReactNode;
  accent?: "green" | "warn";
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#E8ECEA]/80 py-2 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-[12.5px] font-medium",
          mono && "font-mono tabular",
          accent === "green" && "text-[#1A7F45]",
          accent === "warn" && "text-[#96650B]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// 客户信息表：标签格（灰底）
function L({ children }: { children: React.ReactNode }) {
  return (
    <dt className="bg-muted/50 px-2.5 py-2 text-[11.5px] leading-snug text-muted-foreground">
      {children}
    </dt>
  );
}

// 客户信息表：取值格（白底）。默认单行截断；wide 跨整行；nowrap=false 允许换行（标签/备注）
function V({
  children,
  mono,
  wide,
  nowrap = true,
  title
}: {
  children: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
  nowrap?: boolean;
  title?: string;
}) {
  return (
    <dd
      title={title}
      className={cn(
        "min-w-0 bg-card px-2.5 py-2 leading-snug text-foreground/95",
        mono && "font-mono",
        nowrap && "truncate",
        wide && "col-span-1 sm:col-span-3"
      )}
    >
      {children}
    </dd>
  );
}
