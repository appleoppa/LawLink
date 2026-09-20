/**
 * 一次性修复（2026-09-20）：早期演示种子为交接行写入过占位快照 {"note":"演示"}，
 * 日程页「事项责任与交接」面板按 work/procedures/urgent 数组渲染导致 500。
 * 本脚本为缺字段的行重算真实快照与指纹；快照完好的行不动，可重复执行。
 */
import { PrismaClient } from '@prisma/client';
import { handoverSnapshot } from '../src/server/matters/handover';
import { intakeHandoverSnapshot } from '../src/server/intakes/handover';
import { fingerprint } from '../src/server/intakes/workflow';

const db = new PrismaClient();

async function main() {
  const matters = await db.$queryRaw<{ id: string; matterId: string; status: string }[]>`
    SELECT id, "matterId", status::text FROM "MatterHandover"
    WHERE NOT (snapshot ? 'work' AND snapshot ? 'procedures')`;
  for (const h of matters) {
    const snap = await handoverSnapshot(db, h.matterId);
    await db.$executeRaw`UPDATE "MatterHandover" SET snapshot=${JSON.parse(JSON.stringify(snap.snapshot))}::jsonb, fingerprint=${snap.fingerprint} WHERE id=${h.id}`;
    console.log(`repaired MatterHandover ${h.id} (${h.status})`);
  }
  const intakes = await db.$queryRaw<{ id: string; intakeId: string }[]>`
    SELECT id, "intakeId" FROM "IntakeHandover"
    WHERE NOT (snapshot ? 'urgent' AND snapshot ? 'intake')`;
  for (const i of intakes) {
    const snap = await intakeHandoverSnapshot(db, i.intakeId);
    const normalized = JSON.parse(JSON.stringify(snap));
    await db.$executeRaw`UPDATE "IntakeHandover" SET snapshot=${normalized}::jsonb, fingerprint=${fingerprint(snap)} WHERE id=${i.id}`;
    console.log(`repaired IntakeHandover ${i.id}`);
  }
  console.log(`done: ${matters.length} matter + ${intakes.length} intake rows`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
