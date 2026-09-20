/**
 * 2026-09-20 A 批 P1-8：迁移 20260920000001_audit_fix_hardening（触发器修订版）独立演练。
 *
 * 演练库 lawlink_hardening_trial_20260920：先以当前 schema 建结构（db push 等效——直接用
 * Prisma migrate deploy 会把全部迁移跑一遍，db push 只同步结构），再原样执行本迁移 SQL，
 * 验证三项效果：FK RESTRICT 拒删、confirmState 默认 PENDING、AuditLog 触发器显式抛错。
 * 不触碰主库 lawlink；演练库保留供复核（清理另行确认）。
 * 运行：npx tsx scripts/trial-audit-fix-hardening.ts
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

const TRIAL_DB = "lawlink_hardening_trial_20260920";
const url = (process.env.DATABASE_URL ?? "").replace(/\/[^/?]+(\?|$)/, `/${TRIAL_DB}$1`);
if (!process.env.DATABASE_URL) throw new Error("需要 DATABASE_URL");

async function main() {
  const admin = new PrismaClient();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TRIAL_DB}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${TRIAL_DB}`);
  await admin.$disconnect();
  console.log(`① 演练库 ${TRIAL_DB} 已创建`);

  // 用当前 schema 同步结构（等效 db push；主库不参与）
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe"
  });
  console.log("② 结构同步完成（当前 schema，含 RESTRICT/PENDING 目标态）");

  const trial = new PrismaClient({ datasources: { db: { url } } });
  const sql = (await import("node:fs")).readFileSync("prisma/migrations/20260920000001_audit_fix_hardening/migration.sql", "utf8");
  // 按分号切分但跳过 $$...$$ 函数体内的分号；注释行剥离
  const split = (text: string) => {
    const out: string[] = [];
    let cur = "", inFn = false;
    for (let i = 0; i < text.length; i++) {
      const two = text.slice(i, i + 2);
      if (two === "$$") { inFn = !inFn; cur += two; i++; continue; }
      if (text[i] === ";" && !inFn) { out.push(cur.replace(/^--.*$/gm, "").trim()); cur = ""; continue; }
      cur += text[i];
    }
    if (cur.trim()) out.push(cur.replace(/^--.*$/gm, "").trim());
    return out.filter(s => s.replace(/\s/g, "").length);
  };
  for (const s of split(sql)) await trial.$executeRawUnsafe(s);
  console.log("③ 迁移 SQL 原样执行成功（含触发器函数段，函数先于触发器创建）");

  const fk = await trial.$queryRawUnsafe<{ conname: string; confdeltype: string }[]>(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='"FeeEntry"'::regclass AND contype='f' AND conname='FeeEntry_matterId_fkey'`);
  console.log(`④ FeeEntry_matterId_fkey 删除行为 = ${fk[0]?.confdeltype === "r" ? "RESTRICT ✓" : fk[0]?.confdeltype + " ✗"}`);

  // 验证默认值 + 触发器 + FK 拒删（最小对象）
  await trial.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",name,role,active,"systemRole","createdAt","updatedAt","sessionVersion") VALUES ('u1','t@t.test','x','试','LAWYER',true,'NONE',NOW(),NOW(),0)`);
  await trial.$executeRawUnsafe(`INSERT INTO "Matter" (id,title,"internalCode",status,"ownerId","createdAt","updatedAt") VALUES ('m1','试案','T-1','IN_PROGRESS','u1',NOW(),NOW())`);
  await trial.$executeRawUnsafe(`INSERT INTO "FeeEntry" (id,"matterId",type,"moneyKind",amount,"recordedById","occurredAt","updatedAt") VALUES ('f1','m1','RECEIVED','LAWYER_FEE',100,'u1',NOW(),NOW())`);
  const def = await trial.$queryRawUnsafe<{ confirmState: string }[]>(`SELECT "confirmState"::text FROM "FeeEntry" WHERE id='f1'`);
  console.log(`⑤ 漏写 confirmState 的实收默认 = ${def[0]?.confirmState === "PENDING" ? "PENDING ✓" : def[0]?.confirmState + " ✗"}`);

  await trial.$executeRawUnsafe(`INSERT INTO "AuditLog" (id,"userId",action,"targetType","targetId","createdAt") VALUES ('a1','u1','USER_LOGIN','User','u1',NOW())`);
  try {
    await trial.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE id='a1'`);
    console.log("⑥ AuditLog 删除被放行 ✗（触发器未生效）");
  } catch (e) {
    console.log(`⑥ AuditLog 删除被显式拒绝 ✓（${(e as Error).message.slice(0, 60)}…）`);
  }
  try {
    await trial.$executeRawUnsafe(`DELETE FROM "Matter" WHERE id='m1'`);
    console.log("⑦ 案件物理删除被放行 ✗（FK 未生效）");
  } catch (e) {
    console.log(`⑦ 案件物理删除被 RESTRICT 拒绝 ✓（${(e as Error).message.slice(0, 50)}…）`);
  }
  await trial.$executeRawUnsafe(`DELETE FROM "FeeEntry" WHERE id='f1'; DELETE FROM "AuditLog" WHERE id='a1'; DELETE FROM "Matter" WHERE id='m1'; DELETE FROM "User" WHERE id='u1';`).catch(() => {});
  await trial.$disconnect();
  console.log("⑧ 演练样本已清理；演练库保留供复核，未触碰主库。");
}

main().catch(e => { console.error(e); process.exit(1); });
