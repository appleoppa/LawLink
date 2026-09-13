"use server";
import { hasCustomPermission, scopeFor } from "@/lib/roles/catalog";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { matterAssociationFilter } from "@/lib/permissions";
import { listClients } from "@/server/clients/actions";
import { listActiveColleagues } from "@/server/users/actions";
import { listSealTypeConfigs } from "@/server/seals/actions";

export async function getApprovalCreateOptions() {
  const session = await requireSession("approval");
  const [clients, colleagues, configs, matters] = await Promise.all([
    hasCustomPermission(session.user, "clients.read") ? listClients({ pageSize: 100 }) : Promise.resolve({ items: [] }), listActiveColleagues(), listSealTypeConfigs(),
    prisma.matter.findMany({ where: { deletedAt: null, ...matterAssociationFilter(session.user.id) }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, internalCode: true, title: true } })
  ]);
  return { clients: clients.items.map(c => ({ id: c.id, name: c.name, type: c.type })), colleagues, configs, matters, canCreateUnlinkedInvoice: ["PRINCIPAL_LAWYER", "FINANCE"].includes(session.user.role) || (session.user.role === "CUSTOM" && scopeFor(session.user, "finance.write") === "ALL") };
}
