import {getWorkBoard} from "@/server/reminders/work-actions";
import {WorkResponsibilityPanel} from "@/components/matters/work-responsibility-panel";
import { listScheduleItems } from "@/server/schedule/actions";
import { shMonthStart } from "@/server/finance/facts";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { matterAssociationFilter } from "@/lib/permissions";
import { ScheduleView } from "./_components/schedule-view";

export default async function SchedulePage() {
  const session = await getSession();
  if (!session?.user) return null;

  // 拉前后各 3 个月覆盖月历前后翻页（2026-09-20 时区收尾：窗口按上海月界，
  // 此前本地取月，UTC 容器窗口端点偏 8 小时）
  const from = shMonthStart(new Date(), -3);
  const to = shMonthStart(new Date(), 4);

  const [items, matters] = await Promise.all([
    listScheduleItems({ from, to }),
    prisma.matter.findMany({
      where: {
        deletedAt: null,
        ...matterAssociationFilter(session.user.id)
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, internalCode: true, title: true }
    })
  ]);

  return <div className="space-y-4"><ScheduleView items={items} matters={matters} /><WorkResponsibilityPanel data={await getWorkBoard()}/></div>;
}
