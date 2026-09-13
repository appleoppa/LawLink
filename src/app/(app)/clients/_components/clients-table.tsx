"use client";

import Link from "next/link";
import { Building2, User, Briefcase, Pencil, Phone, Mail } from "lucide-react";
import type { Client, ClientCooperationStatus, ClientType, Contact } from "@prisma/client";
import { Button } from "@/components/ui/button";
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

/** 墨案：合作状态 → 徽章 + 行脊线（teal=签约 / amber=洽谈 / slate=潜在 / bronze=终止） */
const COOP_META: Record<ClientCooperationStatus, { badge: string; spine: string }> = {
  POTENTIAL: { badge: "b-slate", spine: "#8296A1" },
  NEGOTIATING: { badge: "b-amber", spine: "#96650B" },
  SIGNED: { badge: "b-teal", spine: "#007B7F" },
  TERMINATED: { badge: "b-bronze", spine: "#8A6B3E" }
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
      <div className="ll-surface flex flex-col items-center gap-2 py-20 text-center">
        <div className="text-sm text-muted-foreground">还没有客户</div>
        <div className="text-xs text-muted-foreground">
          点击右上角 <span className="text-foreground/80">新建客户</span> 开始
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 桌面端表格（墨案 03/10 语言：脊线在首格内嵌 span，避免 tr 伪元素错列） */}
      <div className="ll-surface hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E8ECEA] bg-[#FAFBFA] text-left text-[11px] font-medium text-muted-foreground">
              <th className="px-5 py-2.5">客户</th>
              <th className="px-4 py-2.5">类型</th>
              <th className="px-4 py-2.5">合作状态</th>
              <th className="px-4 py-2.5">联系方式</th>
              <th className="px-4 py-2.5">主要联系人</th>
              <th className="px-4 py-2.5 text-right">案件</th>
              <th className="w-16 px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const primary = c.contacts[0];
              const spine = COOP_META[c.cooperationStatus].spine;
              return (
                <tr key={c.id} className="group border-t border-[#E8ECEA] transition-colors hover:bg-[#F7FAF9]">
                  <td className="relative px-5 py-3">
                    <span className="absolute left-0 top-[11px] bottom-[11px] w-[3px] rounded-r" style={{ background: spine }} aria-hidden />
                    <Link href={`/clients/${c.id}`} className="block">
                      <div className="text-[13px] font-semibold leading-snug transition-colors group-hover:text-[#005054]">
                        {c.name}
                      </div>
                      {c.idNumber && (
                        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground tabular">
                          {maskClientRef(c.idNumber)}
                        </div>
                      )}
                      {c.source && (
                        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground/80">
                          来源：{c.source}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={c.type} />
                  </td>
                  <td className="px-4 py-3">
                    <CoopBadge status={c.cooperationStatus} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      {c.phone && (
                        <span className="flex items-center gap-1.5 text-xs">
                          <Phone className="h-3 w-3" strokeWidth={1.8} />
                          <span className="font-mono tabular">{maskPhoneText(c.phone)}</span>
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1.5 text-xs">
                          <Mail className="h-3 w-3" strokeWidth={1.8} />
                          <span className="truncate">{c.email}</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {primary ? (
                      <div>
                        <div className="text-[13px] text-foreground/90">{primary.name}</div>
                        {primary.phone && (
                          <div className="font-mono text-[10.5px] text-muted-foreground tabular">
                            {maskPhoneText(primary.phone)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-[15px] font-semibold tabular">{c._count.matters}</span>
                    {c._count.intakes > 0 && (
                      <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground tabular">
                        +{c._count.intakes}收
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(c)}
                      className="h-7 w-7 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片列表 */}
      <div className="space-y-2 md:hidden">
        {items.map((c) => {
          const primary = c.contacts[0];
          const spine = COOP_META[c.cooperationStatus].spine;
          return (
            <div key={c.id} className="ll-surface relative overflow-hidden p-3 pl-4">
              <span className="absolute left-0 top-[11px] bottom-[11px] w-[3px] rounded-r" style={{ background: spine }} aria-hidden />
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(c)}
                  className="h-7 w-7 shrink-0 p-0"
                  aria-label="编辑"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                </Button>
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
