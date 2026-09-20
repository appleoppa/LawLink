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
    prisma.smsMessage.findMany({
      where: { receivedById: session.user.id, processingState: "NEEDS_MATCH", processed: false },
      orderBy: { receivedAt: "desc" },
      include: {
        receivedBy: { select: { id: true, name: true } },
        matchedMatter: { select: { id: true, internalCode: true, title: true, procedures: { where: { engagement: "ENGAGED" }, orderBy: { order: "asc" }, select: { id: true, type: true, customLabel: true, caseNumber: true } } } },
        inboundFiles: { orderBy: { downloadedAt: "asc" }, select: { id: true, originalName: true, displayName: true, mimeType: true, size: true, state: true, uploadSource: true, downloadedAt: true, documentId: true, sourceUrl: true } }
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
      needsMatch={needsMatch as never}
      matters={recentMatters}
    />
  );
}
