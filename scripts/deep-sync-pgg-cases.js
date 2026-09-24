#!/usr/bin/env node
/*
 * Deep-sync PGG historical case archives into LawLink OA.
 * Repeatable: removes only rows tagged/marked as PGG深度导入 for each matched matter.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PREVIEW = process.env.PGG_EXTRACT_PREVIEW || path.join(process.cwd(), 'tmp', 'pgg-case-deep-extract-preview.json');
const TAG = 'PGG深度导入';
const USER_EMAIL = process.env.PGG_IMPORT_USER;
if (!USER_EMAIL) {
  console.error('PGG_IMPORT_USER is required (LawLink account email used as importer/owner).');
  process.exit(2);
}

function isoDate(d) { return new Date(`${d}T09:00:00+08:00`); }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0,n-1)+'…' : s; }
function cleanPartyName(name) {
  return String(name||'').replace(/^[:：\s]+|[\s。；;,，]+$/g,'').trim().slice(0,80);
}
function inferPartyType(name, fallback) {
  return /(公司|有限公司|集团|银行|财险|热力|中心|局|政府|委员会|律所|事务所)/.test(name) ? 'COMPANY' : (fallback || 'NATURAL_PERSON');
}
function standingFor(caseCat, role) {
  if (caseCat === 'CRIMINAL') return role === 'CLIENT_PARTY' ? 'CRIMINAL_DEFENDANT' : 'CRIMINAL_VICTIM';
  if (caseCat === 'LABOR_ARBITRATION') return role === 'CLIENT_PARTY' ? 'ARBITRATION_CLAIMANT' : 'ARBITRATION_RESPONDENT';
  return role === 'CLIENT_PARTY' ? 'PLAINTIFF' : 'DEFENDANT';
}
async function ensureCustomFields() {
  const defs = [
    ['pgg_source_path','PGG案卷路径','TEXT',1],
    ['pgg_stage_name','PGG阶段目录','TEXT',2],
    ['pgg_document_count','PGG材料数','NUMBER',3],
    ['pgg_evidence_count','PGG证据/材料数','NUMBER',4],
    ['pgg_receipt_count','PGG回执/审计数','NUMBER',5],
    ['pgg_amount_fragments','PGG金额片段','TEXT',6],
    ['pgg_date_fragments','PGG日期片段','TEXT',7],
    ['pgg_extraction_summary','PGG同步摘要','TEXT',8],
    ['pgg_sync_status','PGG同步状态','SELECT',9],
  ];
  for (const [key,label,fieldType,order] of defs) {
    await prisma.customFieldDef.upsert({
      where: { entityType_key: { entityType:'MATTER', key } },
      update: { label, fieldType, order, enabled:true, options: key==='pgg_sync_status' ? ['基础台账','深度同步','需人工复核'] : [] },
      create: { entityType:'MATTER', key, label, fieldType, order, enabled:true, options: key==='pgg_sync_status' ? ['基础台账','深度同步','需人工复核'] : [] }
    });
  }
}
async function main() {
  const preview = JSON.parse(fs.readFileSync(PREVIEW, 'utf8'));
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);
  await ensureCustomFields();
  const totals = { matters:0, documents:0, folders:0, notes:0, parties:0, relatedEntities:0, tasks:0, timelineEvents:0, procedureMemos:0, customFields:0 };

  for (const c of preview.cases) {
    const matter = await prisma.matter.findUnique({ where: { internalCode:c.internalCode }, include:{ procedures:true, primaryClient:true } });
    if (!matter) { console.warn('skip missing matter', c.internalCode); continue; }
    totals.matters++;
    // Clean previous deep-sync rows only.
    await prisma.document.deleteMany({ where:{ matterId:matter.id, tags:{ has: TAG } } });
    await prisma.note.deleteMany({ where:{ matterId:matter.id, tags:{ has: TAG } } });
    await prisma.task.deleteMany({ where:{ matterId:matter.id, title:{ startsWith:'[PGG]' } } });
    await prisma.timelineEvent.deleteMany({ where:{ matterId:matter.id, eventType:{ in:['PGG_DEEP_IMPORT','PGG_EXTRACTED_DATE'] } } });
    await prisma.relatedEntity.deleteMany({ where:{ matterId:matter.id, relationship:{ startsWith:'PGG提取' } } });
    await prisma.party.deleteMany({ where:{ matterId:matter.id, notes:{ contains:'PGG深度导入' } } });
    for (const p of matter.procedures) {
      await prisma.procedureMemo.deleteMany({ where:{ procedureId:p.id, content:{ startsWith:'[PGG]' } } });
    }

    const procedure = matter.procedures[0] || await prisma.matterProcedure.create({ data:{ matterId:matter.id, type:c.procedureType, order:1, status:'IN_PROGRESS', customLabel:c.stageName || 'PGG历史导入阶段', leadLawyerId:user.id } });
    await prisma.matterProcedure.update({ where:{ id:procedure.id }, data:{ type:c.procedureType, customLabel:c.stageName || procedure.customLabel || 'PGG历史导入阶段', status:'IN_PROGRESS', leadLawyerId:user.id } });

    // Folders and documents.
    const folderMap = new Map();
    for (const d of c.documents) {
      const folderName = truncate(d.folder || '根目录', 180);
      if (!folderMap.has(folderName)) {
        const folder = await prisma.documentFolder.upsert({
          where: { matterId_name: { matterId:matter.id, name:folderName } },
          update: {},
          create: { matterId:matter.id, name:folderName, orderIndex:folderMap.size+20, isDefault:false }
        });
        folderMap.set(folderName, folder.id);
        totals.folders++;
      }
      await prisma.document.create({ data:{
        matterId:matter.id,
        procedureId:procedure.id,
        name:truncate(d.name, 240),
        category:d.category,
        status:d.status,
        path:d.abs,
        mimeType:null,
        size:d.size,
        sha256:d.sha256,
        folderId:folderMap.get(folderName),
        uploadedById:user.id,
        tags:d.tags,
        sourceParty: c.client,
        reviewedById: ['APPROVED','FILED'].includes(d.status) ? user.id : null,
        reviewedAt: ['APPROVED','FILED'].includes(d.status) ? new Date() : null,
        approvedById: d.status === 'FILED' ? user.id : null,
        approvedAt: d.status === 'FILED' ? new Date() : null,
      }});
      totals.documents++;
    }

    // Parties and related entities. Only extracted candidates; flagged as needs review.
    let ordinal=1;
    const seenParty = new Set();
    for (const pp of c.parties || []) {
      const name = cleanPartyName(pp.name);
      if (!name || seenParty.has(name)) continue;
      seenParty.add(name);
      const party = await prisma.party.create({ data:{
        matterId:matter.id,
        role: pp.role === 'OPPOSING_PARTY' ? 'OPPOSING_PARTY' : 'CLIENT_PARTY',
        standing: standingFor(c.category, pp.role),
        ordinal: ordinal++,
        name,
        partyType: inferPartyType(name, pp.partyType),
        notes:`PGG深度导入：来源=${pp.source || 'text'}；需人工复核后用于正式文书。`,
      }});
      await prisma.procedureParty.create({ data:{ procedureId:procedure.id, partyId:party.id, standing:standingFor(c.category, pp.role), ordinal:ordinal-1, note:'PGG深度导入候选，当事人地位需复核' } }).catch(()=>{});
      totals.parties++;
      if (name !== c.client) {
        await prisma.relatedEntity.create({ data:{ matterId:matter.id, name, relationship:'PGG提取关联方/当事人候选', notes:'从历史案卷文本规则提取，需人工复核。' } });
        totals.relatedEntities++;
      }
    }

    // Summary note.
    await prisma.note.create({ data:{
      matterId:matter.id,
      authorId:user.id,
      channel:'OTHER',
      withWhom:'PGG/苹果中枢案卷同步',
      content:`[PGG深度导入]\n${c.summary}\n\n事实片段：\n${(c.factSnippets||[]).map((s,i)=>`${i+1}. ${s}`).join('\n') || '无稳定片段'}\n\n来源路径：${c.dir}`,
      tags:[TAG,'PGG历史导入','案卷摘要'],
      attachments:[c.dir],
    }});
    totals.notes++;

    // Tasks and procedure memos.
    for (const hint of c.taskHints || []) {
      await prisma.task.create({ data:{ matterId:matter.id, title:`[PGG] ${hint}`, description:`由 PGG 深度导入生成。案卷路径：${c.dir}`, assigneeId:user.id, priority:2 } });
      totals.tasks++;
      await prisma.procedureMemo.create({ data:{ procedureId:procedure.id, content:`[PGG] ${hint}`, createdById:user.id } });
      totals.procedureMemos++;
    }

    // Timeline: import event + extracted date anchors.
    await prisma.timelineEvent.create({ data:{ matterId:matter.id, eventType:'PGG_DEEP_IMPORT', title:'PGG历史案卷深度同步', content:`同步 ${c.counts.files} 份材料、${c.counts.receipts} 个回执/审计、${c.counts.evidence} 份证据/材料索引。`, occurredAt:new Date() } });
    totals.timelineEvents++;
    for (const dt of (c.dates || []).slice(0, 12)) {
      await prisma.timelineEvent.create({ data:{ matterId:matter.id, eventType:'PGG_EXTRACTED_DATE', title:`PGG文本识别日期：${dt}`, content:'从历史案卷可读文本中识别的日期锚点，未自动推定法律意义。', occurredAt:isoDate(dt) } });
      totals.timelineEvents++;
    }

    // Client enrichment and matter custom fields.
    if (matter.primaryClientId) {
      const existingClient = await prisma.client.findUnique({ where:{ id:matter.primaryClientId } });
      await prisma.client.update({ where:{ id:matter.primaryClientId }, data:{
        tags: Array.from(new Set([...(existingClient.tags||[]), 'PGG历史导入', TAG])),
        notes: truncate(`${existingClient.notes || ''}\n\n[PGG深度导入] 对应案卷：${c.dir}\n${c.summary}`, 5000),
        source: existingClient.source || 'PGG/苹果中枢历史案卷',
      }});
    }
    const cv = Object.assign({}, matter.customValues || {}, {
      pgg_source_path: c.dir,
      pgg_stage_name: c.stageName,
      pgg_document_count: c.counts.files,
      pgg_evidence_count: c.counts.evidence,
      pgg_receipt_count: c.counts.receipts,
      pgg_amount_fragments: (c.amounts || []).join('、'),
      pgg_date_fragments: (c.dates || []).join('、'),
      pgg_extraction_summary: c.summary,
      pgg_sync_status: '深度同步',
      pgg_deep_import: {
        syncedAt: new Date().toISOString(),
        sourceRoot: c.dir,
        counts: c.counts,
        parties: c.parties,
        factSnippets: c.factSnippets,
        taskHints: c.taskHints,
      }
    });
    await prisma.matter.update({ where:{ id:matter.id }, data:{
      customValues: cv,
      serviceScope: matter.serviceScope || (c.category==='LEGAL_COUNSEL' ? 'PGG历史合同审阅/法律顾问案卷同步' : matter.serviceScope),
      deliverables: matter.deliverables || (c.counts.pleadings ? `PGG历史案卷中识别文书 ${c.counts.pleadings} 份` : matter.deliverables),
    }});
    totals.customFields++;
  }
  console.log(JSON.stringify({ ok:true, preview:PREVIEW, totals }, null, 2));
}
main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
