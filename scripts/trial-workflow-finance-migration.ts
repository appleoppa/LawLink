/** 独立试迁移：只新建库，不复用/重置/删除库，不读取业务数据。需用户明确授权后运行。 */
import { fixtureBilling, fixtureReceivable, fixtureReceipt } from "./workflow-finance-fixtures";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";

const schema = "prisma/workflow-baseline-20260919.prisma";
const candidate = "prisma/workflow-finance-proposal.prisma";
const migration = "docs/BUSINESS-WORKFLOW-FINANCE-MIGRATION-20260919.sql";
const sql = readFileSync(migration, "utf8");
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const source = new PrismaClient({ log: [] });
let test: PrismaClient | undefined;
let stage = "verify-files";
const results: string[] = [];
const database = `lawlink_workflow_trial_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(4).toString("hex")}`;
const output = join(tmpdir(), `${database}.json`);
function cli(args: string[], url?: string) {
  const run = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    env: { ...process.env, ...(url ? { DATABASE_URL: url } : {}) }, encoding: "utf8", timeout: 120_000,
  });
  // 不回显 CLI 原始错误，以免连接字符串进入日志。
  if (run.status !== 0) throw new Error(`Prisma CLI failed at ${stage}, exit=${run.status}`);
  return run.stdout;
}
async function main() {
  assert(sql.includes(`基线 schema SHA256: ${hash(schema)}`), "基线模型已变化，停止");
  assert(sql.includes(`候选 schema SHA256: ${hash(candidate)}`), "候选模型已变化，停止");
  assert(!/^\s*(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/im.test(sql.replace(/\$\$[\s\S]*?\$\$/g,"")), "SQL 超出纯增量范围");
  const baseline = join(tmpdir(), `${database}-baseline.sql`);
  writeFileSync(baseline, cli(["migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"]));
  stage = "create-isolated-database";
  const originalUrl = process.env.DATABASE_URL;
  assert(originalUrl, "缺少数据库连接配置");
  const url = new URL(originalUrl);
  const [identity] = await source.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  assert.notEqual(database, identity.name);
  assert.match(database, /^lawlink_workflow_trial_\d{8}_[a-f0-9]{8}$/);
  const existing = await source.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_database WHERE datname = ${database}`;
  assert.equal(Number(existing[0].count), 0, "禁止复用已有库");
  await source.$executeRawUnsafe(`CREATE DATABASE "${database}" TEMPLATE template0`);
  console.log(`Created isolated database: ${database}`);
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  const testUrl = url.toString();
  test = new PrismaClient({ datasources: { db: { url: testUrl } }, log: [] });
  const [destination] = await test.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  assert.equal(destination.name, database);
  assert.notEqual(destination.name, identity.name);
  stage = "initialize-current-model";
  cli(["db", "execute", "--file", baseline, "--schema", schema], testUrl);
  console.log("PASS: initialized current schema in isolated database");
  stage = "execute-reviewed-sql";
  cli(["db", "execute", "--file", migration, "--schema", schema], testUrl);
  results.push("在现行空模型上执行新版 SQL 成功，无旧账转换");
  stage = "seed-fresh-synthetic-records";
  await test.user.create({ data: { id: "trial-user", name: "独立验收人员", email: "migration-trial@example.invalid", passwordHash: "INVALID-NO-LOGIN", active: false } });
  for (const id of ["case-a", "case-b"]) await test.matter.create({ data: { id, internalCode: id, title: "独立合成案件", ownerId: "trial-user" } });
  await fixtureBilling(test,"case-a",100000,"bill");
  await fixtureReceipt(test,"case-a",40000,"trial-user","trial-user",{id:"payment",feeId:"fee",allocatedAmount:40000});
  await fixtureReceipt(test,"case-b",10000,"trial-user","trial-user",{id:"payment-b",feeId:"fee-b"});
  await fixtureReceivable(test,"case-a",100000,{id:"ar",billingId:"bill",settledAmount:40000});
  await test.$executeRaw`INSERT INTO "FeeEntry" (id,"matterId",type,amount,"recordedById","moneyKind","confirmState","updatedAt") VALUES ('commission','case-a','COMMISSION',12000,'trial-user','LAWYER_FEE','CONFIRMED',NOW())`;
  await test.allocation.create({ data: { id: "allocation", paymentId: "payment", receivableId: "ar", amount: 40000, allocatedById: "trial-user" } });
  for (const matterId of ["case-a", "case-b"]) await test.invoiceRequest.create({ data: { id: `invoice-${matterId}`, matterId, amount: 100000, status: "ISSUED", requestedById: "trial-user" } });
  const snapshot = async () => ({
    billing: await test!.billing.findMany({ orderBy: { id: "asc" } }),
    receivable: await test!.receivable.findMany({ orderBy: { id: "asc" } }),
    payment: await test!.payment.findMany({ orderBy: { id: "asc" } }),
    fee: await test!.feeEntry.findMany({ orderBy: { id: "asc" } }),
    allocation: await test!.allocation.findMany({ orderBy: { id: "asc" } }),
    correction: await test!.financeCorrection.findMany({ orderBy: { id: "asc" } }),
    invoice: await test!.invoiceRequest.findMany({ orderBy: { id: "asc" } }),
  });
  const before = JSON.stringify(await snapshot());
  stage = "verify-structure";
  const checks = await test.$queryRaw<{ name: string; validated: boolean }[]>`SELECT conname AS name, convalidated AS validated FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
  const expectedChecks = [...sql.matchAll(/ADD CONSTRAINT "([^"]+)" CHECK/g)].map((m) => m[1]);
  for (const name of expectedChecks) assert(checks.some((c) => c.name === name && c.validated), name);
  const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
  for (const table of tables) {
    const found = await test.$queryRaw<{ name: string | null }[]>(Prisma.sql`SELECT to_regclass(${`public."${table}"`})::text AS name`);
    assert(found[0].name, table);
  }
  results.push(`${tables.length} 张新表及 ${expectedChecks.length} 条 CHECK 已存在且生效`);
  stage = "compare-candidate-model";
  cli(["migrate", "diff", "--from-schema-datasource", schema, "--to-schema-datamodel", candidate, "--exit-code"], testUrl);
  results.push("Prisma 可表达的完整结构与候选模型无差异（CHECK 另行实测）");
  stage = "constraint-cases";
  let accepted = 0;
  let rejected = 0;
  const rollback = new Error("TRIAL_ROLLBACK");
  async function verify(name: string, statements: string[], expectedCode?: string) {
    let caught: unknown;
    try {
      await test!.$transaction(async (tx) => {
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        throw rollback;
      });
    } catch (error) { caught = error; }
    if (expectedCode) {
      assert(caught instanceof Prisma.PrismaClientKnownRequestError && caught.meta?.code === expectedCode, `${name}: expected SQLSTATE ${expectedCode}`);
      rejected++;
    } else { assert.equal(caught, rollback, `${name}: should succeed`); accepted++; }
    results.push(`${expectedCode ? "拒绝" : "允许"}：${name}`);
  }
  const invoiceLink = (id = "link", matter = "case-a", invoice = "invoice-case-a", payment = "payment", amount = 10000) => `INSERT INTO "InvoicePaymentAllocation" (id,"matterId","invoiceId","paymentId",amount,"recordedById","updatedAt") VALUES ('${id}','${matter}','${invoice}','${payment}',${amount},'trial-user',NOW())`;
  const correction = `INSERT INTO "FinanceCorrection" (id,"targetType","targetId",type,amount,reason,"createdById",status,"matterId","paymentId","requestPayload","occurredAt") VALUES ('correction','Payment','payment','REFUND',100,'trial','trial-user','PENDING','case-a','payment','{}',NOW())`;
  const settlement = `INSERT INTO "CommissionSettlement" (id,"commissionEntryId",kind,amount,"occurredAt","recordedById","voucherReference") VALUES ('settlement','commission','PAID',100,NOW(),'trial-user','trial-voucher')`;
  const effect = `INSERT INTO "FinanceCorrectionEffect" (id,"correctionId","effectKind",delta,"paymentId") VALUES ('effect','correction','PAYMENT_REFUND',100,'payment')`;
  await verify("同案部分票款关联", [invoiceLink()]);
  await verify("发票跨案关联", [invoiceLink("link", "case-a", "invoice-case-b")], "23503");
  await verify("实收跨案关联", [invoiceLink("link", "case-a", "invoice-case-a", "payment-b")], "23503");
  await verify("重复票款关系", [invoiceLink(), invoiceLink("link2")], "23505");
  await verify("零额票款关系", [invoiceLink("link", "case-a", "invoice-case-a", "payment", 0)], "23514");
  await verify("票款超额撤回", [invoiceLink(), `UPDATE "InvoicePaymentAllocation" SET "reversedAmount"=10001`], "23514");
  await verify("重复实收来源", [`INSERT INTO "Payment" (id,"matterId","feeEntryId",amount,"moneyKind","updatedAt") VALUES ('duplicate','case-a','fee',40000,'LAWYER_FEE',NOW())`], "23505");
  await verify("不存在的实收来源", [`UPDATE "Payment" SET "feeEntryId"='missing' WHERE id='payment'`], "23503");
  await verify("不存在的应收合同", [`UPDATE "Receivable" SET "billingId"='missing'`], "23503");
  await verify("重复应收来源键", [`UPDATE "Receivable" SET "sourceKey"='source'`, `INSERT INTO "Receivable" (id,"matterId",title,amount,"sourceKey","moneyKind","updatedAt") VALUES ('ar2','case-a','trial',100,'source','LAWYER_FEE',NOW())`], "23505");
  await verify("合同自引用", [`UPDATE "Billing" SET "sourceBillingId"=id`], "23514");
  await verify("应收调整后不足已核销", [`UPDATE "Receivable" SET "adjustmentAmount"=-60001`], "23514");
  await verify("解除核销并调整应收", [`UPDATE "Receivable" SET "adjustmentAmount"=-100,"settledAmount"=39900`]);
  await verify("退款侵占已核销余额", [`UPDATE "Payment" SET "refundedAmount"=100 WHERE id='payment'`], "23514");
  await verify("解除核销后退款", [`UPDATE "Payment" SET "refundedAmount"=100,"allocatedAmount"=39900 WHERE id='payment'`]);
  await verify("核销超额撤回", [`UPDATE "Allocation" SET "reversedAmount"=40001`], "23514");
  await verify("到期日期缺失", [`UPDATE "Receivable" SET "dueState"='DATE_SET'`], "23514");
  await verify("到期条件为空", [`UPDATE "Receivable" SET "dueState"='CONDITIONAL',"dueCondition"=' '`], "23514");
  await verify("到期条件缺确认人", [`UPDATE "Receivable" SET "conditionSatisfiedAt"=NOW()`], "23514");
  await verify("有日期的到期规则", [`UPDATE "Receivable" SET "dueState"='DATE_SET',"dueDate"=NOW()`]);
  for (const table of ["Billing", "Receivable", "Payment", "FeeEntry"]) {
    await verify(`${table} 款项性质必填`, [`UPDATE "${table}" SET "moneyKind"=NULL`], "23502");
    await verify(`${table} 不接受历史待核性质`, [`UPDATE "${table}" SET "moneyKind"='UNKNOWN'`], "22P02");
  }
  await verify("实收必须有来源", [`UPDATE "Payment" SET "feeEntryId"=NULL`], "23502");
  await verify("不接受历史更正例外状态", [correction, `UPDATE "FinanceCorrection" SET status='LEGACY_REVIEW'`], "22P02");
  await verify("新更正有效对象", [correction]);
  await verify("新更正缺对象", [correction, `UPDATE "FinanceCorrection" SET "paymentId"=NULL WHERE id='correction'`], "23514");
  await verify("新更正字符串目标不符", [correction, `UPDATE "FinanceCorrection" SET "targetType"='Receivable' WHERE id='correction'`], "23514");
  await verify("新更正多个对象", [correction, `UPDATE "FinanceCorrection" SET "receivableId"='ar' WHERE id='correction'`], "23514");
  await verify("确认更正缺确认凭据", [correction, `UPDATE "FinanceCorrection" SET status='CONFIRMED' WHERE id='correction'`], "23514");
  await verify("完整更正确认", [correction, `UPDATE "FinanceCorrection" SET status='CONFIRMED',"confirmedById"='trial-user',"confirmedAt"=NOW() WHERE id='correction'`]);
  await verify("退款执行明细", [correction, effect]);
  await verify("重复更正执行目标", [correction, effect, effect.replace("'effect'", "'effect2'")], "23505");
  await verify("错误更正执行类型", [correction, effect.replace("PAYMENT_REFUND", "ALLOCATION_REVERSAL")], "23514");
  await verify("负数退款执行额", [correction, effect.replace(",100,", ",-100,")], "23514");
  await verify("真实分成支付记录", [settlement]);
  await verify("分成支付缺凭据", [settlement.replace("trial-voucher", " ")], "23514");
  await verify("分成支付作废缺说明", [settlement, `UPDATE "CommissionSettlement" SET "voidedAt"=NOW()`], "23514");
  assert.equal(JSON.stringify(await snapshot()), before, "测试应全部回滚");
  for (const table of tables) {
    const [row]: { count: bigint }[] = await test.$queryRawUnsafe(`SELECT count(*) FROM "${table}"`);
    assert.equal(Number(row.count), 0, "约束测试未回滚");
  }
  assert(sql === readFileSync(migration, "utf8"));
  const report = { at: new Date().toISOString(), database, baselineSchemaSha256: hash(schema), candidateSchemaSha256: hash(candidate), migrationSha256: hash(migration), baselineSqlSha256: hash(baseline), accepted, rejected, checkConstraints: expectedChecks, results, status: "PASS" };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`PASS: ${accepted} allowed + ${rejected} rejected cases; all test mutations rolled back; database retained`);
  console.log(`Report: ${output}`);
}
main().catch((error: unknown) => {
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "VALIDATION_OR_CONNECTION";
  console.error(`FAIL: stage=${stage}; code=${code}; database=${database}; database retained if created`);
  // 断言文字只有测试名称，不输出底层 SQL 错误或连接信息。
  if (error instanceof assert.AssertionError) console.error(error.message.split("\n")[0]);
  process.exitCode = 1;
}).finally(async () => { await test?.$disconnect(); await source.$disconnect(); });
