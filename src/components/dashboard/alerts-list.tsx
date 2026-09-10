import Link from "next/link";
import { Inbox, Shield, Stamp, AlertTriangle, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { matterVisibilityFilter } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { matterHref } from "@/lib/matters/route";

type AlertItem = {
  id: string;
  source: "preservation" | "sms" | "approval";
  title: string;
  detail: string;
  href: string;
  date: Date | null;
  tone: "danger" | "warn" | "ok" | "muted";
};

function classifyByDays(days: number): AlertItem["tone"] {
  if (days < 0) return "danger";
  if (days <= 3) return "danger";
  if (days <= 7) return "warn";
  if (days <= 30) return "muted";
  return "ok";
}

async function loadAlerts(userId: string | null, role: string | null): Promise<AlertItem[]> {
  const now = new Date();
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const isManager = role === "ADMIN" || role === "PRINCIPAL_LAWYER";

  const [preservationProperties, unprocessedSms, pendingSeals] = await Promise.all([
    userId && role
      ? prisma.preservationProperty.findMany({
          where: {
            status: { in: ["ACTIVE", "RENEWED"] },
            expiryDate: { lte: in30 },
            target: {
              case: {
                OR: [
                  { matter: { deletedAt: null, ...matterVisibilityFilter(userId, role) } },
                  { matterId: null, ownerId: userId }
                ]
              }
            }
          },
          orderBy: { expiryDate: "asc" },
          take: 6,
          select: {
            id: true,
            expiryDate: true,
            propertyType: true,
            target: {
              select: {
                name: true,
                case: {
                  select: {
                    matter: { select: { id: true, internalCode: true, title: true } }
                  }
                }
              }
            }
          }
        })
      : Promise.resolve([]),
    userId
      ? prisma.smsMessage.findMany({
          where: { receivedById: userId, processed: false },
          orderBy: { receivedAt: "desc" },
          take: 5,
          select: {
            id: true,
            smsType: true,
            parsedJson: true,
            receivedAt: true
          }
        })
      : Promise.resolve([]),
    // 待审批用章申请（仅管理员 / 主任律师可见，作为审批人提醒）
    isManager
      ? prisma.sealRequest.findMany({
          where: { status: "PENDING" },
          orderBy: { requestedAt: "asc" },
          take: 6,
          select: {
            id: true,
            documentTitle: true,
            purpose: true,
            requestedAt: true,
            matter: { select: { id: true, internalCode: true, title: true } }
          }
        })
      : Promise.resolve([])
  ]);

  const items: AlertItem[] = [];

  for (const p of preservationProperties) {
    const days = Math.ceil((p.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const label = days < 0 ? `保全已过期 ${-days} 天` : days === 0 ? "保全今日到期" : `保全 ${days} 天后到期`;
    const matter = p.target.case.matter;
    items.push({
      id: `pres-${p.id}`,
      source: "preservation",
      title: `${label} · ${p.target.name}`,
      detail: matter
        ? `${matter.internalCode} ${matter.title}`
        : "未关联案件（诉前保全）",
      href: matter ? matterHref(matter) : "/preservation",
      date: p.expiryDate,
      tone: classifyByDays(days)
    });
  }

  for (const m of unprocessedSms) {
    const parsed = (m.parsedJson as { summary?: string; court?: string } | null) ?? {};
    items.push({
      id: `sms-${m.id}`,
      source: "sms",
      title: parsed.summary || "未处理法院短信",
      detail: parsed.court ?? "—",
      href: "/inbox",
      date: m.receivedAt,
      tone: "warn"
    });
  }

  for (const s of pendingSeals) {
    items.push({
      id: `seal-${s.id}`,
      source: "approval",
      title: `待审批用章 · ${s.documentTitle}`,
      detail: s.matter ? `${s.matter.internalCode} ${s.matter.title}` : s.purpose,
      href: "/approvals/seals",
      date: s.requestedAt,
      tone: "warn"
    });
  }

  // 按 tone 优先（danger > warn > muted > ok），相同 tone 按时间近的优先
  const toneOrder = { danger: 0, warn: 1, muted: 2, ok: 3 };
  items.sort((a, b) => {
    if (toneOrder[a.tone] !== toneOrder[b.tone]) return toneOrder[a.tone] - toneOrder[b.tone];
    if (!a.date || !b.date) return 0;
    return a.date.getTime() - b.date.getTime();
  });

  return items.slice(0, 12);
}

const SOURCE_META: Record<AlertItem["source"], { icon: typeof Shield; label: string }> = {
  preservation: { icon: Shield, label: "保全" },
  sms: { icon: Inbox, label: "短信" },
  approval: { icon: Stamp, label: "审批" }
};

export async function AlertsList() {
  const session = await getSession();
  const alerts = await loadAlerts(session?.user.id ?? null, session?.user.role ?? null);

  return (
    <section className="ll-surface flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-3 pt-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">待我处理</h2>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">
            保全到期 / 未读法院短信 / 待审批用章
          </p>
        </div>
        <Link
          href="/schedule"
          className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          全部
          <ArrowRight
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.8}
          />
        </Link>
      </header>

      <div className="border-t border-border flex-1 overflow-y-auto px-2 py-2">
        {alerts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
            <AlertTriangle className="mb-2 h-5 w-5 opacity-30" />
            暂无待处理事项
          </div>
        ) : (
          alerts.map((a) => {
            const M = SOURCE_META[a.source];
            const Icon = M.icon;
            return (
              <Link
                key={a.id}
                href={a.href}
                className="ll-row group flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors"
              >
                <span
                  className={cn(
                    "mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded",
                    a.tone === "danger" && "bg-red-500/12 text-red-600",
                    a.tone === "warn" && "bg-amber-500/15 text-amber-600",
                    a.tone === "muted" && "bg-muted/60 text-muted-foreground",
                    a.tone === "ok" && "bg-emerald-500/12 text-emerald-600"
                  )}
                >
                  <Icon className="h-3 w-3" strokeWidth={2} />
                </span>
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] tracking-wider text-muted-foreground">
                      {M.label}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[13px] font-medium leading-tight">
                    {a.title}
                  </div>
                  <div className="mt-0.5 line-clamp-1 font-mono text-[10px] tracking-wide text-muted-foreground tabular">
                    {a.detail}
                  </div>
                </div>
                <ArrowRight
                  className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/60 transition-[color,transform] [transition-duration:var(--motion-press)] [transition-timing-function:var(--ease-out)] group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transform-none"
                  strokeWidth={1.8}
                />
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
