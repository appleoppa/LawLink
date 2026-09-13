import { hasCustomPermission } from "@/lib/roles/catalog";
import { getSession } from "@/lib/auth/session";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CategoryChart } from "@/components/dashboard/category-chart";
import {
  getDashboardKpis,
  getDashboardRevenueTrend,
  getDashboardCategoryDistribution,
  getDashboardSchedule,
  getDashboardHeroData
} from "@/server/dashboard/actions";

export default async function DashboardPage() {
  const session = await getSession();
  const canReadFinance = Boolean(session?.user && hasCustomPermission(session.user, "finance.read"));
  const canReadMatters = Boolean(session?.user && hasCustomPermission(session.user, "matters.read"));
  const canReadSchedule = Boolean(session?.user && hasCustomPermission(session.user, "schedule.read"));

  const [kpis, revenueTrend, categoryDistribution, scheduleItems, hero] =
    await Promise.all([
      getDashboardKpis(),
      getDashboardRevenueTrend(),
      getDashboardCategoryDistribution(),
      getDashboardSchedule(),
      getDashboardHeroData()
    ]);

  return (
    <div className="space-y-4 pb-8">
      {/* v0.47：顶部问候区 + 右侧近期日程 */}
      <DashboardGreeting
        name={session?.user?.name ?? ""}
        summary={{
          todayDeadlineCount: hero.todayDeadlineCount,
          weekHearingCount: hero.weekHearingCount,
          nearTermCount: hero.nearTermCount
        }}
        scheduleItems={scheduleItems}
      />
      <KpiCards data={kpis.filter(k => k.key === "received" ? canReadFinance : k.key === "deadline" ? canReadSchedule : canReadMatters)} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {canReadFinance && <RevenueChart data={revenueTrend} />}
        </div>
        <div className="lg:col-span-2">
          {canReadMatters && <CategoryChart data={categoryDistribution} />}
        </div>
      </div>
    </div>
  );
}
