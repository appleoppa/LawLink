const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PREVIEW = process.env.PGG_EXTRACT_PREVIEW || path.join(process.cwd(), 'tmp', 'pgg-case-deep-extract-preview.json');
const USER_EMAIL = process.env.PGG_IMPORT_USER;
if (!USER_EMAIL) {
  console.error('PGG_IMPORT_USER is required (LawLink account email used as importer/owner).');
  process.exit(2);
}
const DRY_RUN = process.env.PGG_IMPORT_DRY_RUN === '1';

function dateFromYYYYMMDD(s) {
  return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00.000+08:00`);
}

function parseCode(code) {
  const match = String(code || '').match(/^PGG-([A-Z]+)-(\d{8})-(\d{4})$/);
  if (!match) throw new Error(`invalid PGG internal code: ${code}`);
  return { typ: match[1], date: match[2], seq: match[3] };
}

function loadCases() {
  const preview = JSON.parse(fs.readFileSync(PREVIEW, 'utf8'));
  if (!Array.isArray(preview.cases) || preview.cases.length === 0) {
    throw new Error('preview contains no cases');
  }
  const seen = new Set();
  return preview.cases.map((item) => {
    const { typ, date, seq } = parseCode(item.internalCode);
    if (seen.has(item.internalCode)) throw new Error(`duplicate PGG internal code: ${item.internalCode}`);
    seen.add(item.internalCode);
    return {
      code: item.internalCode,
      seq,
      typ,
      date,
      title: item.title,
      client: item.client,
      clientType: item.clientType,
      cause: item.title,
      category: item.category,
      procedure: item.procedureType,
      source: item.dir,
      files: item.counts?.files ?? item.documents?.length ?? 0,
    };
  });
}

async function main() {
  const cases = loadCases();
  if (DRY_RUN) {
    console.log(JSON.stringify({ dryRun: true, preview: PREVIEW, cases: cases.length, codes: cases.map((c) => c.code) }, null, 2));
    return;
  }

  const owner = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!owner) throw new Error(`missing import user: ${USER_EMAIL}`);

  const results = [];
  for (const c of cases) {
    const clientCode = `KH-${c.date.slice(0,4)}-${c.seq}`;
    const matter = await prisma.$transaction(async (tx) => {
      const client = await tx.client.upsert({
        where: { internalCode: clientCode },
        update: {
          name: c.client,
          type: c.clientType,
          source: 'PGG 本机历史案卷导入',
          notes: `来源案卷：${c.source}\n原目录标题：${c.title}\n案卷文件数：${c.files}`,
          tags: ['PGG历史导入']
        },
        create: {
          internalCode: clientCode,
          name: c.client,
          type: c.clientType,
          source: 'PGG 本机历史案卷导入',
          notes: `来源案卷：${c.source}\n原目录标题：${c.title}\n案卷文件数：${c.files}`,
          tags: ['PGG历史导入']
        }
      });
      const existingMatter = await tx.matter.findUnique({ where: { internalCode: c.code }, select: { customValues: true } });
      const customValues = Object.assign({}, existingMatter?.customValues || {}, {
        pgg_source_path: c.source,
        pgg_source_file_count: c.files,
        pgg_import_note: '从本机 PGG/苹果中枢办案库导入，仅填基础台账字段；事实/证据/财务细节未自动展开。'
      });
      const upserted = await tx.matter.upsert({
        where: { internalCode: c.code },
        update: {
          firmCaseNo: c.code,
          title: c.title,
          category: c.category,
          status: 'IN_PROGRESS',
          causeFreeText: c.cause,
          intakeDate: dateFromYYYYMMDD(c.date),
          firstAcceptedAt: dateFromYYYYMMDD(c.date),
          primaryClientId: client.id,
          ownerId: owner.id,
          customValues
        },
        create: {
          internalCode: c.code,
          firmCaseNo: c.code,
          title: c.title,
          category: c.category,
          status: 'IN_PROGRESS',
          causeFreeText: c.cause,
          intakeDate: dateFromYYYYMMDD(c.date),
          firstAcceptedAt: dateFromYYYYMMDD(c.date),
          primaryClientId: client.id,
          ownerId: owner.id,
          customValues
        }
      });
      await tx.matterClient.upsert({
        where: { matterId_clientId: { matterId: upserted.id, clientId: client.id } },
        update: { label: '主客户', isPrimary: true },
        create: { matterId: upserted.id, clientId: client.id, label: '主客户', isPrimary: true }
      });
      await tx.matterMember.upsert({
        where: { matterId_userId: { matterId: upserted.id, userId: owner.id } },
        update: { role: 'LEAD' },
        create: { matterId: upserted.id, userId: owner.id, role: 'LEAD' }
      });
      const existingProcedure = await tx.matterProcedure.findFirst({ where: { matterId: upserted.id, order: 1 } });
      if (existingProcedure) {
        await tx.matterProcedure.update({
          where: { id: existingProcedure.id },
          data: { type: c.procedure, customLabel: c.cause, engagement: 'ENGAGED', caseNumber: c.code, order: 1 }
        });
      } else {
        await tx.matterProcedure.create({
          data: { matterId: upserted.id, type: c.procedure, customLabel: c.cause, engagement: 'ENGAGED', caseNumber: c.code, order: 1 }
        });
      }
      return upserted;
    });

    results.push({ code: c.code, matterId: matter.id });
  }

  const counts = {
    matters: await prisma.matter.count(),
    clients: await prisma.client.count(),
    links: await prisma.matterClient.count(),
    members: await prisma.matterMember.count(),
    procedures: await prisma.matterProcedure.count(),
  };
  console.log(JSON.stringify({ preview: PREVIEW, imported: results, counts }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); }).finally(async () => prisma.$disconnect());
