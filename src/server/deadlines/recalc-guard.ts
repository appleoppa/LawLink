/** 规则重算可写性守卫（自 confirm.ts 移入；本模块不标 "use server"，仅供服务端内部调用）。 */
import { prisma } from "@/lib/prisma";

/**
 * 规则侧/批量侧更新只允许作用于 PENDING 期限。
 * CONFIRMED / ADJUSTED 期限由人工确认过——重算结果应另行生成待复核记录，
 * 不得静默覆盖（报告 P0-8 验收门槛）。
 */
export async function assertDeadlineRecalcWritable(ids: string[]) {
  const protectedRows = await prisma.deadline.findMany({
    where: { id: { in: ids }, confirmStatus: { in: ["CONFIRMED", "ADJUSTED"] } },
    select: { id: true, confirmStatus: true }
  });
  if (protectedRows.length > 0) {
    throw new Error(
      `有 ${protectedRows.length} 条期限已经人工确认或调整，规则重算不得覆盖；请生成待复核记录`
    );
  }
}
