"use server";

/**
 * 墨案 10 客户详情的只读汇总：疑似重复档案、关联案件摘要、最近动态、来源渠道，
 * 以及按需查看证件/电话明文（逐次审计）。可见性口径与 getClientById 一致。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { audit } from "@/server/audit";
import { hasCustomPermission } from "@/lib/roles/catalog";
import { clientVisibilityFilter, isManager, matterFinanceVisibilityFilter, matterReadVisibilityFilter } from "@/lib/permissions";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { procedureTypeLabel } from "@/lib/enums";

async function assertClientVisible(clientId: string) {
  const session = await requireSession("clients.read");
  if (!isManager(session.user.role) && session.user.role !== "FINANCE") {
    const ok = await prisma.client.findFirst({
      where: { id: clientId, deletedAt: null, ...clientVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) },
      select: { id: true }
    });
    if (!ok) throw new Error("客户不存在");
  }
  return session;
}

export async function getClientInsights(clientId: string) {
  const session = await assertClientVisible(clientId);
  const canFinance = hasCustomPermission(session.user, "finance.read");
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, idType: true, idNumberBlind: true, source: true } });
  if (!client) throw new Error("客户不存在");

  const readFilter = matterReadVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const [suspects, matters, intakes, contacts, fees, sameSource, totalClients] = await Promise.all([
    hasCustomPermission(session.user, "clients.write")
      ? prisma.client.findMany({
          where: {
            deletedAt: null,
            id: { not: client.id },
            OR: [
              ...(client.idType && client.idNumberBlind ? [{ idType: client.idType, idNumberBlind: client.idNumberBlind }] : []),
              { name: client.name.trim() }
            ]
          },
          take: 3,
          select: { id: true, name: true, internalCode: true, idType: true, idNumberBlind: true }
        })
      : Promise.resolve([]),
    prisma.matter.findMany({
      where: { deletedAt: null, ...readFilter, OR: [{ primaryClientId: clientId }, { clientLinks: { some: { clientId } } }] },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        internalCode: true,
        title: true,
        status: true,
        category: true,
        intakeDate: true,
        createdAt: true,
        owner: { select: { name: true } },
        procedures: {
          where: { engagement: "ENGAGED" },
          orderBy: { order: "asc" },
          take: 1,
          select: { type: true, customLabel: true, stages: { where: { status: { not: "HIDDEN" }, completedAt: null }, orderBy: { order: "asc" }, take: 1, select: { name: true } } }
        }
      }
    }),
    prisma.intake.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, status: true, createdAt: true, createdBy: { select: { name: true } } }
    }),
    prisma.contact.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, name: true, createdAt: true } }),
    canFinance
      ? prisma.feeEntry.findMany({
          where: { type: "RECEIVED", matter: { deletedAt: null, primaryClientId: clientId, ...matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions) } },
          orderBy: { occurredAt: "desc" },
          take: 4,
          select: { id: true, amount: true, occurredAt: true, note: true, invoiceNo: true, billing: { select: { signedAt: true } }, recordedBy: { select: { name: true } }, matter: { select: { title: true } } }
        })
      : Promise.resolve([]),
    client.source ? prisma.client.count({ where: { deletedAt: null, source: client.source } }) : Promise.resolve(0),
    prisma.client.count({ where: { deletedAt: null } })
  ]);

  const billingByMatter = canFinance
    ? await prisma.billing.groupBy({ by: ["matterId"], where: { matterId: { in: matters.map((m) => m.id) } }, _sum: { contractAmount: true } })
    : [];
  const contractMap = new Map(billingByMatter.map((b) => [b.matterId, Number(b._sum.contractAmount ?? 0)]));

  type Activity = { key: string; at: string; title: string; meta: string; tone: "done" | "current" | "" };
  const activity: Activity[] = [
    ...fees.map((f) => ({ key: `f-${f.id}`, at: f.occurredAt.toISOString(), title: `到账登记 ¥${Number(f.amount).toLocaleString("zh-CN")}${f.billing?.signedAt || f.invoiceNo ? "" : " · 待确认"}`, meta: `${f.matter.title} · ${f.recordedBy.name}登记`, tone: "done" as const })),
    ...intakes.map((i) => ({ key: `i-${i.id}`, at: i.createdAt.toISOString(), title: `新建收案「${i.title}」`, meta: `${i.createdBy?.name ?? ""}${i.status === "CONVERTED" ? " · 已转正式案件" : i.status === "DECLINED" ? " · 未承接" : " · 审批中"}`, tone: (i.status === "CONVERTED" ? "done" : "current") as Activity["tone"] })),
    ...matters.slice(0, 4).map((m) => ({ key: `m-${m.id}`, at: m.createdAt.toISOString(), title: `立案「${m.title}」`, meta: `${m.internalCode} · 主办 ${m.owner?.name ?? "—"}`, tone: "done" as const })),
    ...contacts.map((c) => ({ key: `c-${c.id}`, at: c.createdAt.toISOString(), title: `新增联系人 ${c.name}`, meta: "客户档案维护", tone: "" as const }))
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return {
    suspects: suspects.map((s) => ({
      id: s.id,
      name: s.name,
      internalCode: s.internalCode,
      reason: client.idNumberBlind && s.idNumberBlind === client.idNumberBlind && s.idType === client.idType ? "证件号码一致" : "名称一致"
    })),
    matters: matters.map((m) => {
      const p = m.procedures[0];
      return {
        id: m.id,
        internalCode: m.internalCode,
        title: m.title,
        status: m.status,
        category: m.category,
        year: (m.intakeDate ?? m.createdAt).getFullYear(),
        ownerName: m.owner?.name ?? null,
        procedure: p ? p.customLabel ?? procedureTypeLabel[p.type] ?? p.type : null,
        stage: p?.stages[0]?.name ?? null,
        contract: canFinance ? contractMap.get(m.id) ?? 0 : null
      };
    }),
    activity,
    source: client.source ? { name: client.source, sameSourceClients: sameSource, totalClients } : null
  };
}

export async function revealClientIdNumber(clientId: string) {
  const session = await assertClientVisible(clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { idNumber: true } });
  const plain = decryptIdNumber(client?.idNumber);
  await audit({ userId: session.user.id, action: "CLIENT_ID_REVEAL", targetType: "Client", targetId: clientId });
  return plain;
}

export async function revealContactPhone(contactId: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { clientId: true, phone: true } });
  if (!contact) throw new Error("联系人不存在");
  const session = await assertClientVisible(contact.clientId);
  await audit({ userId: session.user.id, action: "CONTACT_PHONE_REVEAL", targetType: "Contact", targetId: contactId, detail: { clientId: contact.clientId } });
  return contact.phone ?? "";
}
