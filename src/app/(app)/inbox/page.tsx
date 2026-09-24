import { listSmsMessages } from "@/server/sms/actions";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { matterAssociationFilter } from "@/lib/permissions";
import { InboxView } from "./_components/inbox-view";

export default async function InboxPage() {
  const session = await getSession();
  if (!session?.user) return null;

  const [unprocessed, processed, needsManual, needsMatch, recentMatters] = await Promise.all([
    listSmsMessages({ scope: "mine", processed: "unprocessed" }),
    listSmsMessages({ scope: "mine", processed: "processed" }),
    listSmsMessages({ scope: "mine", processed: "all", needsManual: true }),
    // B1 小项：私有来件区——已取件、未匹配案件的来件单独成组（先取件后匹配的入口）
    // 2026-09-20 第五轮审计 P2-6 修复：此前缺 suggestions include 与文件阅读状态字段
    // （as never 掩盖类型检查）——MATTER_MATCH 归属建议在最需要它的「待匹配」页签不可见。
    prisma.smsMessage.findMany({
      where: { receivedById: session.user.id, processingState: "NEEDS_MATCH", processed: false },
      orderBy: { receivedAt: "desc" },
      include: {
        receivedBy: { select: { id: true, name: true } },
        matchedMatter: { select: { id: true, internalCode: true, title: true, procedures: { where: { engagement: "ENGAGED" }, orderBy: { order: "asc" }, select: { id: true, type: true, customLabel: true, caseNumber: true } } } },
        inboundFiles: { orderBy: { downloadedAt: "asc" }, select: { id: true, originalName: true, displayName: true, mimeType: true, size: true, state: true, uploadSource: true, downloadedAt: true, documentId: true, sourceUrl: true, analysisState: true, docType: true, analysisError: true } },
        suggestions: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, fieldKey: true, currentValue: true, suggestedValue: true, sourcePage: true, sourceExcerpt: true, status: true, fileId: true, payload: true } }
      }
    }),
    prisma.matter.findMany({
      where: {
        deletedAt: null,
        ...matterAssociationFilter(session.user.id)
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        internalCode: true,
        title: true,
        procedures: {
          where: { engagement: "ENGAGED" },
          orderBy: { order: "asc" },
          select: { id: true, type: true, customLabel: true, caseNumber: true }
        }
      }
    })
  ]);

  return (
    <InboxView
      needsManual={needsManual}
      unprocessed={unprocessed}
      processed={processed}
      needsMatch={needsMatch}
      matters={recentMatters}
    />
  );
}
