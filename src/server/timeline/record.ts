import type { Prisma } from "@prisma/client";

/**
 * 时间线事件唯一写入口（v5 §5.8「双写待统一入口」清偿）。
 *
 * 全部业务侧时间线写入必须经此函数，禁止散落直接调 `timelineEvent.create`：
 * - 单一来源保证字段口径（occurredAt 必填、refType/refId 可选）一致；
 * - 与 `auditTx` 同事务调用时，状态迁移与审计同事务提交（P0-7 语义）；
 * - 未来若时间线需要派生索引、去重或限流，只改这里。
 */
export type TimelineEventData = {
  matterId: string;
  eventType: string;
  title: string;
  content?: string;
  occurredAt?: Date;
  refType?: string;
  refId?: string;
};

export async function recordTimelineEvent(
  db: Prisma.TransactionClient,
  data: TimelineEventData
): Promise<void> {
  await db.timelineEvent.create({
    data: {
      matterId: data.matterId,
      eventType: data.eventType,
      title: data.title,
      content: data.content,
      occurredAt: data.occurredAt ?? new Date(),
      refType: data.refType,
      refId: data.refId
    }
  });
}
