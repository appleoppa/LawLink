/**
 * 2026-09-20 A 批 P1-6 存量日期瞬间分布审计（只读，不修改任何数据）。
 *
 * 背景：期限/开庭/任务的日历日在库内存在三种落库瞬间——上海午夜（= 前一日 16:00Z）、
 * UTC 午夜（z.coerce.date 解析 "YYYY-MM-DD"）、历史浏览器本地午夜。出口统一走
 * shDayKey（上海日历日）后三种瞬间都还原为正确日历日，无需迁移数据；
 * 按 v3 方案「未经证据不宣布修正」，本脚本输出分布证据：
 *   - 各表日期字段的 UTC 小时直方图（16 点档 = 上海午夜瞬间，0 点档 = UTC 午夜）；
 *   - 异常瞬间行（小时既非 0 也非 16 的行数，如存在需人工抽查来源）。
 * 运行：npx tsx scripts/audit-date-instants.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = { at: Date };

async function histogram(table: string, column: string, where: string, args: unknown[] = []) {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "${column}" AS at FROM "${table}" ${where}`,
    ...args
  );
  const dist = new Map<number, number>();
  for (const r of rows) dist.set(r.at.getUTCHours(), (dist.get(r.at.getUTCHours()) ?? 0) + 1);
  const sorted = [...dist.entries()].sort((a, b) => a[0] - b[0]);
  const total = rows.length;
  const canonical = (dist.get(0) ?? 0) + (dist.get(16) ?? 0);
  const anomaly = total - canonical;
  console.log(`${table}.${column}: 共 ${total} 行`);
  console.log(`  UTC 小时分布: ${sorted.map(([h, n]) => `${String(h).padStart(2, "0")}时=${n}`).join(", ") || "（空）"}`);
  console.log(`  规范瞬间（UTC 0 时=UTC 午夜 / 16 时=上海午夜）: ${canonical} 行；其他瞬间: ${anomaly} 行${anomaly ? "  ⚠ 需人工抽查" : ""}`);
  return anomaly;
}

async function main() {
  let anomalies = 0;
  anomalies += await histogram("Deadline", "dueAt", "");
  anomalies += await histogram("Hearing", "startsAt", "");
  anomalies += await histogram("Task", "dueAt", "WHERE \"dueAt\" IS NOT NULL");
  console.log(anomalies === 0 ? "\n结论：全部日期落在两种规范瞬间，出口统一 shDayKey 后无需迁移。" : `\n结论：${anomalies} 行非规范瞬间，请抽查其录入来源后再决定是否列迁移。`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
