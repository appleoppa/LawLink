"use client";

import Link from "next/link";
import { ChevronRight, IdCard, Phone, MapPin, UserCog } from "lucide-react";
import { clientTypeLabel, litigationStandingLabel, partyTypeLabel } from "@/lib/enums";
import { cn } from "@/lib/utils";
import type { MatterPayload } from "./matter-detail-tabs";

type PartyRow = MatterPayload["parties"][number];

const ROLE_STYLE: Record<string, { label: string; cls: string }> = {
  CLIENT: { label: "客户", cls: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  OPPOSING_PARTY: { label: "相对方", cls: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  THIRD_PARTY: { label: "第三人", cls: "bg-violet-500/10 text-violet-600 border-violet-500/20" }
};

export function PartiesPanel({ matter }: { matter: MatterPayload }) {
  const opposing = matter.parties.filter((p) => p.role === "OPPOSING_PARTY");
  const thirdParty = matter.parties.filter((p) => p.role === "THIRD_PARTY");
  const clientParties = matter.parties.filter((p) => p.role === "CLIENT_PARTY");

  const total = matter.clientLinks.length + clientParties.length + opposing.length + thirdParty.length;
  if (total === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[13px] font-medium">
          案件当事人
          <span className="ml-1 text-[11px] text-muted-foreground">({total})</span>
        </span>
      </header>
      <ul className="divide-y divide-border">
        {/* 委托方：CRM 客户（可点开）*/}
        {matter.clientLinks.map((cl) => (
          <ClientLinkRow
            key={`cl-${cl.clientId}`}
            name={cl.client.name}
            typeLabel={clientTypeLabel[cl.client.type]}
            href={`/clients/${cl.client.id}`}
            primary={cl.isPrimary}
          />
        ))}
        {/* 委托方：非 CRM 录入的当事人 */}
        {clientParties.map((p) => (
          <PartyRowItem key={p.id} party={p} roleKey="CLIENT" />
        ))}
        {opposing.map((p) => (
          <PartyRowItem key={p.id} party={p} roleKey="OPPOSING_PARTY" />
        ))}
        {thirdParty.map((p) => (
          <PartyRowItem key={p.id} party={p} roleKey="THIRD_PARTY" />
        ))}
      </ul>
    </section>
  );
}

function RoleTag({ roleKey }: { roleKey: string }) {
  const s = ROLE_STYLE[roleKey] ?? ROLE_STYLE.OPPOSING_PARTY;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10.5px] font-medium",
        s.cls
      )}
    >
      {s.label}
    </span>
  );
}

function ClientLinkRow({
  name,
  typeLabel,
  href,
  primary
}: {
  name: string;
  typeLabel: string;
  href: string;
  primary: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-muted/30"
      >
        <RoleTag roleKey="CLIENT" />
        <span className="truncate text-[13px] font-medium">{name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">· {typeLabel}</span>
        {primary && (
          <span className="shrink-0 rounded-sm bg-blue-500/10 px-1 text-[9.5px] text-blue-600">主</span>
        )}
        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  );
}

function PartyRowItem({ party, roleKey }: { party: PartyRow; roleKey: string }) {
  const isOrg = party.partyType !== "NATURAL_PERSON";
  const standing = party.standing ? litigationStandingLabel[party.standing] : null;
  const idValue = isOrg ? party.enterpriseSocialCode : party.idNumber;
  const typeLabel = partyTypeLabel[party.partyType];

  const details: { icon: React.ReactNode; text: string; mono?: boolean }[] = [];
  if (idValue) details.push({ icon: <IdCard className="h-3 w-3" />, text: idValue, mono: true });
  if (isOrg && party.legalRep)
    details.push({ icon: <UserCog className="h-3 w-3" />, text: `法定代表人 ${party.legalRep}` });
  if (party.phone) details.push({ icon: <Phone className="h-3 w-3" />, text: party.phone, mono: true });
  if (party.address) details.push({ icon: <MapPin className="h-3 w-3" />, text: party.address });

  return (
    <li className="flex items-start gap-2.5 px-4 py-2.5">
      <RoleTag roleKey={roleKey} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{party.name || "—"}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">· {typeLabel}</span>
          {standing && (
            <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0 text-[10px] text-muted-foreground">
              {standing}
            </span>
          )}
        </div>
        {details.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {details.map((d, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <span className="shrink-0 text-muted-foreground/70">{d.icon}</span>
                <span className={cn("truncate", d.mono && "font-mono")} title={d.text}>
                  {d.text}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
