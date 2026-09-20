/** 只读 SQL 验证：从真实领取语句提取筛选条件，以 CTE 样本验证，不写 JobQueue。 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";
const db = new PrismaClient({ log: [] });
async function main() {
  const source = readFileSync("src/server/cron/queue.ts", "utf8");
  const condition = source.match(/SELECT "id" FROM "JobQueue"\s+WHERE ([\s\S]*?)\s+ORDER BY/)?.[1];
  if (!condition) throw new Error("未找到实际队列领取条件");
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH "JobQueue" ("id", "status", "runAt") AS (VALUES
        ('pending-future', 'PENDING', NOW() + INTERVAL '1 hour'),
        ('pending-due', 'PENDING', NOW()),
        ('pending-past', 'PENDING', NOW() - INTERVAL '1 hour'),
        ('retry-future', 'FAILED', NOW() + INTERVAL '1 hour'),
        ('retry-due', 'FAILED', NOW() - INTERVAL '1 minute'),
        ('running', 'RUNNING', NOW() - INTERVAL '1 hour'),
        ('done', 'SUCCESS', NOW() - INTERVAL '1 hour'),
        ('dead', 'DEAD', NOW() - INTERVAL '1 hour')
      ) SELECT "id" FROM "JobQueue" WHERE ${Prisma.raw(condition)} ORDER BY "id"
    `);
  });
  assert.deepEqual(rows.map((r) => r.id), ["pending-due", "pending-past", "retry-due"]);
  console.log("PASS: PostgreSQL 实际筛选条件正确，8 个状态/时间边界用例；未修改业务数据。");
}
main().catch(() => { console.error("FAIL: 队列只读 SQL 验证未通过。"); process.exitCode = 1; }).finally(() => db.$disconnect());
