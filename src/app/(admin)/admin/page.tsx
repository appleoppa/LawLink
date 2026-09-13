import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  BookOpenCheck,
  Bot,
  Building2,
  FileUp,
  KeyRound,
  Layers,
  ListChecks,
  Package,
  ScrollText,
  ShieldCheck,
  Users
} from "lucide-react";

import { getSession } from "@/lib/auth/session";
import { isSystemAdmin } from "@/lib/auth/system-role";

const adminGroups = [
  {
    title: "组织与人员",
    description: "管理律所资料、账号、岗位和常设律师团队。",
    items: [
      { href: "/admin/firm-profile", label: "律所信息", icon: Building2 },
      { href: "/admin/users", label: "用户管理", icon: Users },
      { href: "/admin/roles", label: "岗位角色", icon: KeyRound },
      { href: "/admin/teams", label: "律师团队", icon: Users }
    ]
  },
  {
    title: "业务规则",
    description: "维护审批、归档和案件字段等全所统一规则。",
    items: [
      { href: "/admin/approval-permissions", label: "审批权限", icon: ShieldCheck },
      { href: "/admin/archive-policy", label: "归档制度", icon: BookOpenCheck },
      { href: "/admin/templates", label: "阶段模板", icon: Layers },
      { href: "/admin/custom-fields", label: "自定义字段", icon: ListChecks }
    ]
  },
  {
    title: "系统接入",
    description: "配置外部服务，并维护提醒和历史数据导入。",
    items: [
      { href: "/admin/ai", label: "AI 与元典", icon: Bot },
      { href: "/admin/express", label: "快递接入", icon: Package },
      { href: "/admin/reminders", label: "提醒维护", icon: BellRing },
      { href: "/admin/import", label: "批量导入", icon: FileUp }
    ]
  },
  {
    title: "安全与审计",
    description: "查看系统内的重要操作记录和责任主体。",
    items: [{ href: "/admin/audit", label: "审计日志", icon: ScrollText }]
  }
];

export default async function AdminHomePage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  const systemAdmin = isSystemAdmin(session.user);
  const { TextBackfillCard } = await import("./_components/text-backfill-card");
  const { ClientIdCryptoCard } = await import("./_components/client-id-crypto-card");
  const { getClientIdCryptoStats } = await import("@/server/clients/backfill-crypto");
  const { getTextLayerStats } = await import("@/server/documents/admin-text-backfill");

  if (!systemAdmin) {
    return (
      <div className="space-y-5">
        <header>
          <p className="text-[12px] font-medium text-primary">管理工作区</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">日常维护</h1>
          <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">你保留原有的提醒维护和批量导入权限，系统级配置仍仅向超级管理员开放。</p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <ManagementCard href="/admin/reminders" label="提醒维护" description="检查法定期限和开庭提醒，并维护通知接入。" icon={BellRing} />
          <ManagementCard href="/admin/import" label="批量导入" description="使用既有模板导入案件资料。" icon={FileUp} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-low)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[12px] font-medium text-primary">系统管理模式</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">管理后台</h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-muted-foreground">
              在这里维护全所组织、业务规则、外部接入和安全记录。案件办理、客户沟通与审批处理仍在业务系统完成。
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        {adminGroups.map((group) => (
          <section key={group.title} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-low)]">
            <h2 className="text-[15px] font-semibold">{group.title}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{group.description}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <ManagementCard key={item.href} {...item} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <TextBackfillCard initialStats={await getTextLayerStats()} />
      <ClientIdCryptoCard initialStats={await getClientIdCryptoStats()} />
    </div>
  );
}

function ManagementCard({
  href,
  label,
  description,
  icon: Icon
}: {
  href: string;
  label: string;
  description?: string;
  icon: typeof ShieldCheck;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-16 items-start gap-3 rounded-lg border border-border bg-background/60 p-3 transition-[background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out)] hover:border-primary/25 hover:bg-primary/[0.035] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transform-none"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        {description ? <span className="mt-1 block text-[11.5px] leading-5 text-muted-foreground">{description}</span> : null}
      </span>
      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none" />
    </Link>
  );
}
