import { AppShell } from "@/components/layout/app-shell";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { listActiveBanners } from "@/server/announcements/actions";
import { getSession } from "@/lib/auth/session";
import { getFirmProfile } from "@/server/settings/firm-profile";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // v0.27: 顶部公告 banner —— 仅登录后获取，未登录走 (auth) 段不走此 layout
  const session = await getSession();
  const banners = session?.user ? await listActiveBanners() : [];

  // v0.42 项1：侧栏品牌（律所名 / 副标题 / Logo）可在设置页配置
  const profile = await getFirmProfile();
  const firm = {
    name: profile.firmName,
    subtitle: profile.firmSubtitle,
    logoDataUrl: profile.logoDataUrl
  };

  // v0.43：当前用户头像（从 DB 读最新，避免 JWT 缓存），供顶栏即时刷新
  const me = session?.user
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { avatar: true }
      })
    : null;

  return (
    <AppShell
      firm={firm}
      userAvatar={me?.avatar ?? null}
      banner={banners.length > 0 ? <AnnouncementBanner banners={banners} /> : null}
    >
      {children}
    </AppShell>
  );
}
