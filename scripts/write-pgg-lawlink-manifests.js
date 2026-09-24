#!/usr/bin/env node
/* Write reciprocal LawLink sync manifest into each PGG case archive. */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = process.env.LAWLINK_BASE_URL || 'http://localhost:3100';
const OUT_NAME = 'LawLink-OA同步.json';

async function main() {
  const matters = (await prisma.matter.findMany({
    orderBy: { internalCode: 'asc' },
    select: { id:true, internalCode:true, title:true, customValues:true, _count:{ select:{ documents:true, parties:true, tasks:true, timelineEvents:true, notes:true, folders:true } } }
  })).filter((m) => typeof m.customValues?.pgg_source_path === 'string');
  const written=[];
  for (const m of matters) {
    const source = m.customValues?.pgg_source_path;
    if (!source || typeof source !== 'string' || !fs.existsSync(source)) continue;
    const stageDirs = fs.readdirSync(source, {withFileTypes:true}).filter(d=>d.isDirectory() && /PGG-/.test(d.name));
    const targetDir = stageDirs.length ? path.join(source, stageDirs[0].name, '案件过程报告') : source;
    fs.mkdirSync(targetDir, {recursive:true});
    const manifest = {
      schema: 'pgg_lawlink_sync_manifest_v1',
      generatedAt: new Date().toISOString(),
      lawlink: {
        baseUrl: BASE_URL,
        matterUrl: `${BASE_URL}/matters/${m.id}`,
        matterId: m.id,
        internalCode: m.internalCode,
        title: m.title,
      },
      pgg: {
        sourcePath: source,
        stageName: m.customValues?.pgg_stage_name || null,
      },
      counts: m._count,
      status: m.customValues?.pgg_sync_status || '深度同步',
      boundary: '历史案卷与 OA 台账/材料索引双向链接；不代表法律事实、证据原件或终版文书已经复核通过。'
    };
    const out = path.join(targetDir, OUT_NAME);
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
    written.push(out);
  }
  console.log(JSON.stringify({written: written.length, files: written}, null, 2));
}
main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
