import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getMatterById } from "@/server/matters/actions";
import { getMatterFinance } from "@/server/finance/actions";
import { listActiveColleagues } from "@/server/users/actions";
import { getLatestArchiveRecord } from "@/server/archive/actions";
import { getMatterReviewSummary } from "@/server/ai/matter-review-summary";
import { getSession } from "@/lib/auth/session";
import { resolveMatterRoute } from "@/server/matters/route";
import { matterHref } from "@/lib/matters/route";
import { prisma } from "@/lib/prisma";
import { nullableDecimalToNumber, serializeDecimals } from "@/lib/decimal";
import { MatterDetailTabs } from "./_components/matter-detail-tabs";
import { ReviewSummaryCard } from "./_components/review-summary-card";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MatterDetailPage({ params }: PageProps) {
  const { id: param } = await params;

  // 路由键是 internalCode（`LL-2026-CC-0001`），但历史书签、通知与审计日志里
  // 存的是 cuid 地址，两者都要认；命中 cuid 时在鉴权通过后再跳规范地址。
  const route = await resolveMatterRoute(param);
  if (!route) notFound();

  const [matterRaw, session] = await Promise.all([
    getMatterById(route.id),
    getSession()
  ]);
  if (!matterRaw) notFound();

  if (param !== route.internalCode) redirect(matterHref(route));

  const matter = {
    ...matterRaw,
    claimAmount: nullableDecimalToNumber(matterRaw.claimAmount)
  };

  const [
    financeRaw,
    userOptions,
    documents,
    folders,
    templates,
    allColleagues,
    sealContracts,
    expresses,
    latestArchive,
    customFieldDefs,
    preservationCases
  ] = await Promise.all([
    getMatterFinance(matter.id),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" }
    }),
    prisma.document.findMany({
      where: { matterId: matter.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        procedure: { select: { id: true, type: true, customLabel: true } }
      }
    }),
    // v0.8: 卷宗
    prisma.documentFolder.findMany({
      where: { matterId: matter.id },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, orderIndex: true, isDefault: true }
    }),
    // v0.8: 适用本案件类别的模板
    prisma.documentTemplate.findMany({
      where: {
        enabled: true,
        OR: [
          { applicableCategories: { isEmpty: true } },
          { applicableCategories: { has: matter.category } }
        ]
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        applicableCategories: true,
        variables: true,
        isBuiltIn: true
      }
    }),
    listActiveColleagues(),
    // v0.11: 案件下用印申请关联的合同附件（待盖章稿 + 盖章后扫描件）
    prisma.sealRequest.findMany({
      where: { matterId: matter.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        documentTitle: true,
        status: true,
        createdAt: true,
        draftDoc: { select: { id: true, name: true, size: true, createdAt: true } },
        stampedDoc: { select: { id: true, name: true, size: true, createdAt: true } }
      }
    }),
    // v0.11: 案件下快递追踪
    prisma.expressTracking.findMany({
      where: { matterId: matter.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        trackingNo: true,
        companyCode: true,
        direction: true,
        purpose: true,
        lastState: true,
        lastUpdateAt: true,
        createdAt: true
      }
    }),
    // v0.18: 最新归档申请状态（用于显示"归档中"/"已驳回" banner）
    getLatestArchiveRecord(matter.id),
    // v0.28: 案件自定义字段定义（启用项）
    prisma.customFieldDef.findMany({
      where: { entityType: "MATTER", enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, key: true, label: true, fieldType: true, options: true, required: true }
    }),
    prisma.preservationCase.findMany({
      where: { matterId: matter.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        matter: { select: { id: true, internalCode: true, title: true } },
        owner: { select: { id: true, name: true } },
        targets: {
          orderBy: { createdAt: "asc" },
          include: {
            properties: {
              orderBy: { expiryDate: "asc" },
              include: {
                renewals: { orderBy: { renewedAt: "desc" }, take: 3 }
              }
            }
          }
        }
      }
    })
  ]);

  // getMatterFinance 已在 action 出口统一序列化 Decimal
  const finance = financeRaw;

  // v0.22: 本案 AI 审查总览（聚合 ReviewRecord）
  const reviewSummary = await getMatterReviewSummary(matter.id);
  const currentMatterMember = session?.user.id
    ? matter.members.find((member) => member.userId === session.user.id)
    : null;
  const canAssociateThisMatter = Boolean(
    session?.user.id &&
      (matter.ownerId === session.user.id ||
        currentMatterMember)
  );
  const canLeadThisMatter = Boolean(
    session?.user.id &&
      (matter.ownerId === session.user.id ||
        currentMatterMember?.role === "LEAD" ||
        currentMatterMember?.role === "CO_LEAD")
  );
  const canOwnThisMatter = Boolean(session?.user.id && matter.ownerId === session.user.id);

  // v0.8: 卷宗对应文档（含 templateId 标识）
  const folderDocuments = documents.map((d) => ({
    id: d.id,
    name: d.name,
    size: d.size,
    folderId: d.folderId,
    templateId: d.templateId,
    createdAt: d.createdAt
  }));
  const preservationCasesForClient = serializeDecimals(preservationCases);

  return (
    <div className="space-y-4">
      <Link
        href="/matters"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回案件列表
      </Link>

      <ReviewSummaryCard summary={reviewSummary} matterId={matter.id} />

      <MatterDetailTabs
        matter={matter}
        finance={finance}
        userOptions={userOptions}
        documents={documents}
        folders={folders}
        folderDocuments={folderDocuments}
        templates={templates.map((t) => ({
          ...t,
          variables: Array.isArray(t.variables) ? (t.variables as string[]) : []
        }))}
        colleagues={allColleagues.map((c) => ({ id: c.id, name: c.name }))}
        currentUserRole={session?.user.role ?? null}
        canAssociateThisMatter={canAssociateThisMatter}
        canLeadThisMatter={canLeadThisMatter}
        canOwnThisMatter={canOwnThisMatter}
        sealContracts={sealContracts}
        expresses={expresses}
        latestArchive={latestArchive}
        customFieldDefs={customFieldDefs}
        preservationCases={preservationCasesForClient}
      />
    </div>
  );
}
