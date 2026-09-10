import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  User,
  Briefcase,
  Wallet,
  Coins,
  Clock,
  FileText,
  Phone,
  Mail,
  MapPin
} from "lucide-react";
import { getClientById, getClientFinanceSummary } from "@/server/clients/actions";
import { Badge } from "@/components/ui/badge";
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
const yuan = (n: number) => `¥${n.toLocaleString()}`;
const dash = <span className="text-muted-foreground/50">—</span>;

const COOP_TONE: Record<string, string> = {
  POTENTIAL: "bg-amber-100 text-amber-800",
  NEGOTIATING: "bg-sky-100 text-sky-800",
  SIGNED: "bg-emerald-100 text-emerald-800",
  TERMINATED: "bg-muted text-muted-foreground"
};

const ACTIVE_MATTER_STATUSES = new Set(["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"]);

function firstChar(value: string) {
  return value.trim().slice(0, 1) || "客";
}

function dateText(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("zh-CN");
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = await getClientById(params.id);
  if (!client) notFound();
  const finance = await getClientFinanceSummary(params.id);

  const isIndividual = client.type === "INDIVIDUAL";
  const TypeIcon = isIndividual ? User : client.type === "COMPANY" ? Building2 : Briefcase;
  // 企业客户：主要联系人（contacts 已按 isPrimary desc 排序）
  const primaryContact = client.contacts[0] ?? null;

  // 按案件分组合同，关联案件与签约合同合并展示（左案件 / 右合同）
  const billingsByMatter = new Map<string, typeof finance.billings>();
  for (const b of finance.billings) {
    const arr = billingsByMatter.get(b.matter.id) ?? [];
    arr.push(b);
    billingsByMatter.set(b.matter.id, arr);
  }

  const activeMatterCount = client.matters.filter((matter) =>
    ACTIVE_MATTER_STATUSES.has(matter.status)
  ).length;
  const paidRate =
    finance.receivable > 0
      ? Math.min(100, Math.round((finance.received / finance.receivable) * 100))
      : finance.contractTotal > 0
        ? Math.min(100, Math.round((finance.received / finance.contractTotal) * 100))
        : 0;

  return (
    <div className="space-y-4">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回客户列表
      </Link>

      <section className="ll-hero-surface px-5 py-5">
        <div className="relative z-[1] flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary text-2xl font-semibold text-primary-foreground shadow-[0_12px_30px_rgba(0,123,127,0.18)]">
              {firstChar(client.name)}
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5 rounded-full bg-card text-[11px]">
                  <TypeIcon className="h-3.5 w-3.5 text-primary" />
                  {clientTypeLabel[client.type]}
                </Badge>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium",
                    COOP_TONE[client.cooperationStatus] ?? "bg-muted text-muted-foreground"
                  )}
                >
                  {cooperationStatusLabel[client.cooperationStatus]}
                </span>
                {client.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="rounded-full text-[11px]">
                    {tag}
                  </Badge>
                ))}
              </div>
              <h1 className="truncate text-[24px] font-semibold leading-tight" title={client.name}>
                {client.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">{client.internalCode || "暂无客户编号"}</span>
                <span>首次合作 {dateText(client.createdAt)}</span>
                {primaryContact ? <span>主要联系人：{primaryContact.name}</span> : null}
              </div>
            </div>
          </div>
          <ClientEditButton client={client} />
        </div>

        <div className="relative z-[1] mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroStat label="累计委托" value={`${finance.matterCount} 件`} icon={<Briefcase className="h-3.5 w-3.5" />} />
          <HeroStat label="办理中" value={`${activeMatterCount} 件`} icon={<Clock className="h-3.5 w-3.5" />} accent />
          <HeroStat label="累计实收" value={yuan(finance.received)} icon={<Coins className="h-3.5 w-3.5" />} />
          <HeroStat label="待收" value={yuan(finance.pending)} icon={<Wallet className="h-3.5 w-3.5" />} tone="warn" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title">
                <Briefcase className="h-4 w-4 text-primary" />
                关联案件
                <span className="font-mono text-xs text-muted-foreground tabular">
                  {client.matters.length}
                </span>
              </h2>
              <span className="text-xs text-muted-foreground">
                合同合计 <span className="font-mono text-foreground">{yuan(finance.contractTotal)}</span>
              </span>
            </header>

            {client.matters.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">暂无关联案件</p>
            ) : (
              <ul className="divide-y divide-border px-4">
                {client.matters.map((m) => {
                  const bs = billingsByMatter.get(m.id) ?? [];
                  return (
                    <li
                      key={m.id}
                      className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start"
                    >
                      <Link href={matterHref(m)} className="group min-w-0">
                        <div className="truncate text-[13.5px] font-medium transition-colors group-hover:text-primary">
                          {m.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{m.internalCode}</span>
                          <span>·</span>
                          <span>{matterCategoryLabel[m.category]}</span>
                          <Badge variant="outline" className="rounded-full text-[10px]">
                            {matterStatusLabel[m.status]}
                          </Badge>
                          <span>更新 {dateText(m.updatedAt)}</span>
                        </div>
                      </Link>

                      <div className="min-w-0">
                        {bs.length === 0 ? (
                          <span className="text-xs text-muted-foreground/60">暂无合同</span>
                        ) : (
                          <ul className="space-y-1.5">
                            {bs.map((b) => (
                              <li
                                key={b.id}
                                className="flex items-center justify-between gap-2 rounded-sm border border-border bg-background px-2.5 py-1.5"
                              >
                                <span className="min-w-0 flex-1 truncate text-xs" title={b.title}>
                                  <FileText className="mr-1 inline h-3 w-3 text-muted-foreground" />
                                  {b.title}
                                  {b.signedAt && (
                                    <span className="ml-1.5 text-muted-foreground/70">
                                      {dateText(b.signedAt)}
                                    </span>
                                  )}
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="font-mono text-xs">{yuan(b.contractAmount)}</span>
                                  <Badge variant="outline" className="rounded-full text-[10px]">
                                    {billingStatusLabel[b.status] ?? b.status}
                                  </Badge>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="ll-surface p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="ll-panel-title">
                <TypeIcon className="h-4 w-4 text-primary" />
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
                  <V mono title={client.idNumber ?? undefined}>{client.idNumber || dash}</V>
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
                  <V mono title={client.idNumber ?? undefined}>{client.idNumber || dash}</V>
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
                {primaryContact?.phone || client.phone || dash}
              </V>
              <L>邮箱</L>
              <V title={client.email ?? undefined}>{client.email || dash}</V>

              <L>住所地</L>
              <V wide title={client.address ?? undefined}>{client.address || dash}</V>

              {client.tags.length > 0 && (
                <>
                  <L>标签</L>
                  <V wide nowrap={false}>
                    <span className="flex flex-wrap gap-1">
                      {client.tags.map((t) => (
                        <Badge key={t} variant="outline" className="rounded-full text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </V>
                </>
              )}
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

        <aside className="space-y-4 xl:sticky xl:top-16">
          <section className="ll-surface overflow-hidden">
            <header className="ll-panel-head">
              <h2 className="ll-panel-title">
                <Phone className="h-4 w-4 text-primary" />
                联系人
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular">
                {client.contacts.length}
              </span>
            </header>
            {client.contacts.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无联系人</p>
            ) : (
              <ul className="divide-y divide-border px-4">
                {client.contacts.map((contact) => (
                  <li key={contact.id} className="flex gap-3 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-xs font-semibold text-primary">
                      {firstChar(contact.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{contact.name}</span>
                        {contact.isPrimary ? (
                          <Badge variant="outline" className="rounded-full text-[10px]">
                            主要
                          </Badge>
                        ) : null}
                      </div>
                      {contact.title ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {contact.title}
                        </div>
                      ) : null}
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        {contact.phone ? (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" strokeWidth={1.8} />
                            <span className="font-mono">{contact.phone}</span>
                          </div>
                        ) : null}
                        {contact.email ? (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3" strokeWidth={1.8} />
                            <span className="truncate">{contact.email}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ll-surface p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="ll-panel-title">
                <Wallet className="h-4 w-4 text-primary" />
                财务汇总
              </h2>
              <span className="font-mono text-xs text-muted-foreground">{paidRate}%</span>
            </header>
            <div className="space-y-2">
              <SummaryField label="累计合同" value={yuan(finance.contractTotal)} />
              <SummaryField label="累计应收" value={yuan(finance.receivable)} />
              <SummaryField label="累计实收" value={yuan(finance.received)} accent="green" />
              <SummaryField label="待收" value={yuan(finance.pending)} accent="warn" />
            </div>
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>收款率</span>
                <span className="font-mono">{paidRate}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${paidRate}%` }}
                />
              </div>
            </div>
          </section>

          <section className="ll-surface p-4">
            <h2 className="ll-panel-title mb-3">
              <MapPin className="h-4 w-4 text-primary" />
              客户概况
            </h2>
            <div className="space-y-2 text-[12px]">
              <SummaryField label="合作状态" value={cooperationStatusLabel[client.cooperationStatus]} />
              <SummaryField label="客户类型" value={clientTypeLabel[client.type]} />
              <SummaryField label="首次合作" value={dateText(client.createdAt)} />
              <SummaryField label="最近更新" value={dateText(client.updatedAt)} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  accent,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card/80 px-3 py-2.5 shadow-[var(--shadow-inset)]",
        accent && "border-primary/30 bg-primary/[0.04]",
        tone === "warn" && "border-amber-500/25 bg-amber-500/[0.05]"
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn(accent && "text-primary", tone === "warn" && "text-amber-600")}>
          {icon}
        </span>
        {label}
      </div>
      <div className="ll-stat mt-2 text-[20px] leading-none text-foreground">{value}</div>
    </div>
  );
}

function SummaryField({
  label,
  value,
  accent
}: {
  label: string;
  value: React.ReactNode;
  accent?: "green" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-mono text-foreground",
          accent === "green" && "text-emerald-700",
          accent === "warn" && "text-amber-700"
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
