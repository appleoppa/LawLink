/**
 * v0.50: ICS 日历订阅源（PRD §二十一）。
 *
 * GET /api/calendar/{token} → text/calendar
 * token 即凭证（对应 User.calendarToken，可在 设置→个人信息 重置）；
 * 内容 = 该用户可见范围内 过去 7 天 ~ 未来 90 天 的开庭 / 期限 / 任务 / 保全到期。
 * 苹果日历 / Google Calendar / Outlook 订阅 URL 后自动定期刷新。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { queryScheduleItems } from "@/server/schedule/query";
import { buildIcs, type IcsEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";

const PAST_DAYS = 7;
const FUTURE_DAYS = 90;

const TYPE_PREFIX: Record<string, string> = {
  hearing: "[开庭]",
  deadline: "[期限]",
  task: "[任务]"
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return new NextResponse("Not found", { status: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { calendarToken: token },
    select: { id: true, role: true, active: true, name: true }
  });
  if (!user || !user.active) {
    return new NextResponse("Not found", { status: 404 });
  }

  const now = new Date();
  const from = new Date(now.getTime() - PAST_DAYS * 86400000);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now.getTime() + FUTURE_DAYS * 86400000);
  to.setHours(23, 59, 59, 999);

  const items = await queryScheduleItems(user.id, user.role, {
    from,
    to,
    includeCompleted: false
  });

  const events: IcsEvent[] = items.map((item) => {
    const prefix = TYPE_PREFIX[item.type] ?? "";
    // 客户名而非完整案件名（与站内日程一致，减少日历外泄的敏感信息）
    const who = item.clientName ?? item.matter.internalCode;
    const isTimed = item.type === "hearing";
    return {
      uid: `${item.id}`,
      title: `${prefix} ${item.title} · ${who}`,
      start: item.occurredAt,
      allDay: !isTimed,
      description: [
        item.matter.internalCode,
        item.procedureLabel,
        item.description ?? undefined
      ]
        .filter(Boolean)
        .join(" / "),
      reminderMinutes: isTimed ? [24 * 60, 2 * 60] : [24 * 60]
    };
  });

  const ics = buildIcs({
    calendarName: `LawLink 日程 · ${user.name}`,
    events
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="lawlink.ics"'
    }
  });
}
