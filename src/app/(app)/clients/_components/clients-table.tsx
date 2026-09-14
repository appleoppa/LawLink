"use client";

import Link from "next/link";
import { Building2, User, Briefcase, Pencil, Phone, Mail } from "lucide-react";
import type { Client, ClientCooperationStatus, ClientType, Contact } from "@prisma/client";
import { clientTypeLabel, cooperationStatusLabel } from "@/lib/enums";

/** P1 §三：证件号展示打码（client 端纯字符串处理；密文形态直接遮蔽） */
function maskClientRef(v: string | null | undefined): string {
  if (!v) return "";
  if (v.includes(".")) return "••••（已加密，详见档案）";
  if (v.length >= 8) return `${v.slice(0, 3)}${"•".repeat(Math.max(4, v.length - 5))}${v.slice(-2)}`;
  return v;
}

/** 安全底线：电话默认打码，不在列表露出全号 */
function maskPhoneText(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{11}$/.test(v)) return `${v.slice(0, 3)}****${v.slice(7)}`;
  return v.length > 4 ? `${v.slice(0, 2)}****${v.slice(-2)}` : v;
}

/** 墨案：合作状态 → 徽章 + 案卷脊（teal=签约 / amber=洽谈 / slate=潜在 / bronze=终止） */
const COOP_META: Record<ClientCooperationStatus, { badge: string; spine: string }> = {
  POTENTIAL: { badge: "b-slate", spine: "slate" },
  NEGOTIATING: { badge: "b-amber", spine: "amber" },
  SIGNED: { badge: "b-teal", spine: "teal" },
  TERMINATED: { badge: "b-bronze", spine: "bronze" }
};

function CoopBadge({ status }: { status: ClientCooperationStatus }) {
  return (
    <span className={`badge ${COOP_META[status].badge}`}>
      <span className="bdot" aria-hidden />
      {cooperationStatusLabel[status]}
    </span>
  );
}

type ClientRow = Client & {
  contacts: Contact[];
  _count: { matters: number; intakes: number };
};

function TypeBadge({ type }: { type: ClientType }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  const Icon = type === "INDIVIDUAL" ? User : type === "COMPANY" ? Building2 : Briefcase;
  return (
    <span className="badge b-white !gap-1">
      <Icon className={cls} strokeWidth={1.8} />
      {clientTypeLabel[type]}
    </span>
  );
}

export function ClientsTable({
  items,
  onEdit
}: {
  items: ClientRow[];
  onEdit: (c: ClientRow) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="mo-empty-title">没有符合条件的客户</div>
        <div className="mo-empty-desc">调整筛选条件，或点击右上角「新建客户」建档；收案时关联的委托方也会自动出现在这里。</div>
      </div>
    );
  }

  return (
    <>
      <div className="mo-scroll-x hidden md:block">
        <table className="mo-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: "30%", paddingLeft: 20 }}>客户</th>
              <th>类型</th>
              <th>合作状态</th>
              <th>联系方式</th>
              <th>主要联系人</th>
              <th className="num">案件 / 收案</th>
              <th style={{ width: 56 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const primary = c.contacts[0];
              return (
                <tr key={c.id} data-spine={COOP_META[c.cooperationStatus].spine} className="group">
                  <td style={{ paddingLeft: 20 }}>
                    <Link href={`/clients/${c.id}`} className="block min-w-0">
                      <div className="truncate font-semibold group-hover:text-[var(--teal-deep)]" style={{ fontSize: 13 }}>{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--t-muted)]">
                        {c.idNumber ? <span className="font-mono">{maskClientRef(c.idNumber)}</span> : null}
                        {c.source ? <span className="truncate">来源：{c.source}</span> : null}
                      </div>
                    </Link>
                  </td>
                  <td><TypeBadge type={c.type} /></td>
                  <td><CoopBadge status={c.cooperationStatus} /></td>
                  <td className="text-[var(--t-secondary)]">
                    <div className="flex flex-col gap-0.5 text-[12px]">
                      {c.phone ? <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" strokeWidth={1.8} /><span className="font-mono">{maskPhoneText(c.phone)}</span></span> : null}
                      {c.email ? <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" strokeWidth={1.8} /><span className="truncate">{c.email}</span></span> : null}
                      {!c.phone && !c.email ? <span className="t-faint">—</span> : null}
                    </div>
                  </td>
                  <td>
                    {primary ? (
                      <div>
                        <div>{primary.name}</div>
                        {primary.phone ? <div className="font-mono text-[11px] text-[var(--t-muted)]">{maskPhoneText(primary.phone)}</div> : null}
                      </div>
                    ) : (
                      <span className="t-faint">—</span>
                    )}
                  </td>
                  <td className="num">
                    <span className="font-mono font-semibold" style={{ fontSize: 14 }}>{c._count.matters}</span>
                    <span className="font-mono text-[11px] text-[var(--t-muted)]"> / {c._count.intakes}</span>
                  </td>
                  <td className="text-right">
                    <button type="button" className="btn btn-ghost btn-sm btn-icon opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" onClick={() => onEdit(c)} aria-label={`编辑 ${c.name}`}>
                      <Pencil />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片列表 */}
      <div className="md:hidden">
        {items.map((c) => {
          const primary = c.contacts[0];
          const spine = COOP_META[c.cooperationStatus].spine;
          return (
            <div key={c.id} className="mo-spine border-b border-[var(--bd-hair)] p-3 pl-4 last:border-b-0" data-spine={spine}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/clients/${c.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.idNumber && (
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground tabular">
                      {maskClientRef(c.idNumber)}
                    </div>
                  )}
                  {c.source && (
                    <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">
                      来源：{c.source}
                    </div>
                  )}
                </Link>
                <button type="button" className="btn btn-ghost btn-sm btn-icon shrink-0" onClick={() => onEdit(c)} aria-label={`编辑 ${c.name}`}>
                  <Pencil />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <CoopBadge status={c.cooperationStatus} />
                {primary && <span>{primary.name}</span>}
                {c.phone && (
                  <span className="flex items-center gap-1 font-mono tabular">
                    <Phone className="h-3 w-3" strokeWidth={1.8} />
                    {maskPhoneText(c.phone)}
                  </span>
                )}
                <span className="font-mono tabular">{c._count.matters} 个案件</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
