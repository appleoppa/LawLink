/** 真实数据库事务验证：仅新建独立测试对象，所有写入最后强制回滚，不执行外发或扫描现有案件。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { refreshScheduleReminder, retireScheduleReminders } from "../src/server/reminders/schedule";

const rollback = new Error("ROLLBACK_WORKFLOW_FIXTURES");
async function main() {
  const tag = randomUUID();
  let assertions = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({ data: { name: "流程回滚测试", email: `workflow-${tag}@example.invalid`, passwordHash: "INVALID-NONLOGIN-TEST-HASH", role: "LAWYER" } });
      const matter = await tx.matter.create({ data: { title: "流程回滚测试", internalCode: `WORKFLOW-${tag}`, ownerId: owner.id } });
      const procedure = await tx.matterProcedure.create({ data: { matterId: matter.id, order: 1, type: "FIRST_INSTANCE" } });
      const now = new Date("2026-09-19T16:00:00+08:00");
      const deadline = await tx.deadline.create({ data: { procedureId: procedure.id, title: "当日新增期限", dueAt: new Date("2026-09-19T00:00:00+08:00") } });
      const results = await Promise.all(Array.from({ length: 3 }, () => refreshScheduleReminder("Deadline", deadline.id, now, tx)));
      assert.equal(results.filter((r) => r?.sent).length, 1); assertions++;
      assert.equal(await tx.notification.count({ where: { refId: deadline.id } }), 1); assertions++;
      await tx.deadline.update({ where: { id: deadline.id }, data: { completed: true, updatedAt: new Date(now.getTime() + 1000) } });
      await retireScheduleReminders(tx, "Deadline", deadline.id, now);
      assert.equal(await refreshScheduleReminder("Deadline", deadline.id, now, tx), null); assertions++;
      assert.equal(await tx.notification.count({ where: { refId: deadline.id, read: false } }), 0); assertions++;
      await tx.deadline.update({ where: { id: deadline.id }, data: { completed: false, updatedAt: new Date(now.getTime() + 2000) } });
      assert.equal((await refreshScheduleReminder("Deadline", deadline.id, now, tx))?.sent, true); assertions++;
      const hearing = await tx.hearing.create({ data: { procedureId: procedure.id, title: "当日开庭", startsAt: new Date("2026-09-19T17:00:00+08:00") } });
      assert.equal((await refreshScheduleReminder("Hearing", hearing.id, now, tx))?.sent, true); assertions++;
      await tx.hearing.update({ where: { id: hearing.id }, data: { startsAt: new Date("2026-10-01T09:00:00+08:00") } });
      await retireScheduleReminders(tx, "Hearing", hearing.id, now);
      assert.equal(await refreshScheduleReminder("Hearing", hearing.id, now, tx), null); assertions++;
      assert.equal(await tx.notification.count({ where: { refId: hearing.id, read: false } }), 0); assertions++;
      throw rollback;
    }, { timeout: 20000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.matter.count({ where: { internalCode: `WORKFLOW-${tag}` } }), 0);
  assert.equal(await prisma.user.count({ where: { email: `workflow-${tag}@example.invalid` } }), 0);
  console.log(`PASS: ${assertions} 项真实数据库提醒断言；测试对象和通知已随事务回滚，未修改现有案件。`);
}
main().catch(() => { console.error("FAIL: 真实数据库提醒验证未通过，事务已回滚。"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
