import { customOrLegacy } from "@/lib/roles/catalog";
import { isManager as canManage } from "@/lib/permissions";
/**
 * v0.38: 公告指引独立页（v0.37 曾并入 /service-center，现拆回）
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listAnnouncements } from "@/server/announcements/actions";
import { AnnouncementsView } from "./_components/announcements-view";

export default async function AnnouncementsPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const isManager =
    customOrLegacy(session.user, "announcements.manage", canManage(session.user));
  const announcements = await listAnnouncements();

  return (
    <AnnouncementsView
      items={announcements}
      isManager={isManager}
      currentUserId={session.user.id}
    />
  );
}
