#!/usr/bin/env node
/*
 * Extract PGG/苹果中枢 case archives into a structured JSON preview.
 * Read-only. Does not touch LawLink DB.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.PGG_CASE_ROOT;
if (!ROOT) {
  console.error('PGG_CASE_ROOT is required (absolute path of the case archive root to scan).');
  process.exit(2);
}
const OUT = process.env.PGG_EXTRACT_OUT || path.join(process.cwd(), 'tmp', 'pgg-case-deep-extract-preview.json');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function safeRead(file, max=300000) {
  try {
    const st = fs.statSync(file);
    if (st.size > max) return '';
    const ext = path.extname(file).toLowerCase();
    if (!['.md','.txt','.json','.html','.doc','.docx'].includes(ext)) return '';
    if (['.doc','.docx'].includes(ext)) return ''; // binary; indexed by metadata only
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}
function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function codeFromDirName(name) {
  const m = name.match(/^(\d{4})-PGG([A-Z]+)-(\d{8})-(.+)$/);
  if (!m) return null;
  return `PGG-${m[2]}-${m[3]}-${m[1]}`;
}
function categoryFromTitle(title) {
  if (/工伤|劳动/.test(title)) return 'LABOR_ARBITRATION';
  if (/刑事|交通肇事|有毒有害/.test(title)) return 'CRIMINAL';
  if (/顾问|合同审阅|合同审查/.test(title)) return 'LEGAL_COUNSEL';
  return 'CIVIL_COMMERCIAL';
}
function procedureFromStage(stage, category) {
  if (/侦查/.test(stage)) return 'INVESTIGATION';
  if (/审查起诉/.test(stage)) return 'PROSECUTION_REVIEW';
  if (/二审|上诉/.test(stage)) return 'SECOND_INSTANCE';
  if (/再审/.test(stage)) return 'RETRIAL_REVIEW';
  if (/仲裁/.test(stage) || category === 'LABOR_ARBITRATION') return 'LABOR_ARBITRATION';
  if (/合同审阅|顾问|非诉/.test(stage) || category === 'LEGAL_COUNSEL') return 'CUSTOM';
  return 'FIRST_INSTANCE';
}
function clientFromTitle(title) {
  return title.split('+')[0].replace(/案$|纠纷$|审阅$/g,'').trim();
}
function clientType(name) {
  return /(公司|有限公司|财险|热力|银行|集团|中心|局|厂|店|合作社)/.test(name) ? 'COMPANY' : 'INDIVIDUAL';
}
function documentCategory(rel) {
  if (/判决|裁定|调解书|judg/.test(rel)) return 'JUDGMENT';
  if (/合同|协议/.test(rel)) return 'CONTRACT';
  if (/起诉状|答辩|申请书|法律意见|代理词|文书|plead/.test(rel)) return 'PLEADING';
  if (/证据|材料|发票|病历|认定书|图片|照片|pdf|jpg|png/.test(rel)) return 'EVIDENCE';
  if (/过程|台账|回执|审计|巡视|任务|日志|receipt|json/.test(rel)) return 'PROCEDURE';
  return 'OTHER';
}
function statusFromRel(rel) {
  if (/FINAL|终版|对外交付|正式/.test(rel) && !/草稿|待补|OBSOLETE|废弃|事实错误/.test(rel)) return 'APPROVED';
  if (/提交|已提交|归档/.test(rel) && !/待补/.test(rel)) return 'FILED';
  if (/审查|待审|待复核/.test(rel)) return 'PENDING_REVIEW';
  return 'DRAFT';
}
function extractDates(text) {
  const vals = new Set();
  for (const m of text.matchAll(/(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/g)) {
    const y=m[1], mo=m[2].padStart(2,'0'), d=m[3].padStart(2,'0');
    vals.add(`${y}-${mo}-${d}`);
  }
  return [...vals].slice(0,30);
}
function extractAmounts(text) {
  const vals = new Set();
  for (const m of text.matchAll(/(?:人民币)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(元|万元)/g)) {
    vals.add(`${m[1]}${m[2]}`);
  }
  return [...vals].slice(0,40);
}
function extractParties(text, title, client) {
  const parties = new Map();
  parties.set(client, {name: client, role:'CLIENT_PARTY', partyType: clientType(client)==='COMPANY'?'COMPANY':'NATURAL_PERSON', source:'title'});
  const patterns = [
    /(?:原告|申请人|上诉人|委托人|当事人)[:：\s]+([^\n，,；;。]{2,40})/g,
    /(?:被告|被申请人|被上诉人|犯罪嫌疑人|被告人)[:：\s]+([^\n，,；;。]{2,40})/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) {
    let n=m[1].replace(/[\s。；;，,]+$/,'').trim();
    if (n && n.length <= 40 && !/[：:]/.test(n)) parties.set(n, {name:n, role: re.source.includes('被告')||re.source.includes('犯罪')?'OPPOSING_PARTY':'CLIENT_PARTY', partyType: clientType(n)==='COMPANY'?'COMPANY':'NATURAL_PERSON', source:'text'});
  }
  return [...parties.values()].slice(0,20);
}
function snippets(text, terms) {
  const res=[];
  for (const t of terms) {
    const i=text.indexOf(t); if (i>=0) res.push(text.slice(Math.max(0,i-80), Math.min(text.length,i+180)).replace(/\s+/g,' '));
  }
  return [...new Set(res)].slice(0,12);
}

const caseDirs = fs.readdirSync(ROOT, {withFileTypes:true})
  .filter(d => d.isDirectory() && /^\d{4}-PGG/.test(d.name))
  .map(d => path.join(ROOT, d.name))
  .sort();

const extracted=[];
for (const dir of caseDirs) {
  const base = path.basename(dir);
  const internalCode = codeFromDirName(base);
  const title = base.replace(/^\d{4}-PGG[A-Z]+-\d{8}-/,'');
  const category = categoryFromTitle(title);
  const client = clientFromTitle(title);
  const files = walk(dir);
  let textCorpus='';
  const documents=[];
  for (const file of files) {
    const rel = path.relative(dir, file);
    const st = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    const txt = safeRead(file);
    if (txt) textCorpus += `\n\n# FILE ${rel}\n` + txt.slice(0, 20000);
    const tags = ['PGG历史导入','PGG深度导入'];
    if (/OBSOLETE|废弃|事实错误/i.test(file)) tags.push('历史废弃/事实错误');
    if (/receipt|回执|审计|巡视|trusted|gate|日志/i.test(file)) tags.push('receipt/审计');
    documents.push({
      rel, abs:file, name:path.basename(file), ext, size:st.size, sha256:sha256(file),
      category:documentCategory(rel), status:statusFromRel(rel), tags,
      folder: path.dirname(rel)==='.' ? '根目录' : path.dirname(rel),
    });
  }
  const stageDir = fs.readdirSync(dir, {withFileTypes:true}).find(d => d.isDirectory() && /PGG-/.test(d.name));
  const stageName = stageDir ? stageDir.name : '';
  const procedureType = procedureFromStage(stageName + title, category);
  const amounts = extractAmounts(textCorpus);
  const dates = extractDates(textCorpus);
  const parties = extractParties(textCorpus, title, client);
  const receiptFiles = documents.filter(d => d.tags.includes('receipt/审计'));
  const formalDocs = documents.filter(d => d.category === 'PLEADING' || d.status === 'APPROVED' || d.status === 'FILED');
  const evidenceDocs = documents.filter(d => d.category === 'EVIDENCE');
  const taskHints = [];
  if (/待补|待核实|待明确|WATCH|BLOCKED|缺/.test(textCorpus)) taskHints.push('复核案卷中“待补/待核实/WATCH/BLOCKED”事项');
  if (evidenceDocs.length) taskHints.push(`核验证据/材料 ${evidenceDocs.length} 份的原件、真实性、关联性`);
  if (formalDocs.length) taskHints.push(`复核正式/草稿文书 ${formalDocs.length} 份，确认是否可对外交付`);
  const summary = [
    `来源：PGG/苹果中枢历史案卷 ${base}`,
    `阶段：${stageName || '未识别'}`,
    `材料索引：${documents.length} 份；证据/材料 ${evidenceDocs.length}，文书 ${formalDocs.length}，receipt/审计 ${receiptFiles.length}`,
    amounts.length ? `识别金额片段：${amounts.slice(0,10).join('、')}` : '未从可读文本中稳定识别金额片段',
    dates.length ? `识别日期片段：${dates.slice(0,10).join('、')}` : '未从可读文本中稳定识别日期片段',
    '边界：本次为历史案卷结构化同步；具体事实、法律结论和对外交付状态仍以律师复核/原件核验为准。'
  ].join('\n');
  extracted.push({
    dir, base, internalCode, title, category, client, clientType:clientType(client), stageName, procedureType,
    counts:{files:documents.length, evidence:evidenceDocs.length, pleadings:formalDocs.length, receipts:receiptFiles.length},
    parties, amounts, dates, documents,
    factSnippets: snippets(textCorpus, ['基本事实','案件事实','争议焦点','诉讼请求','审查意见','证据目录','责任','金额','待补','管辖']),
    taskHints,
    summary,
  });
}
fs.mkdirSync(path.dirname(OUT), {recursive:true});
fs.writeFileSync(OUT, JSON.stringify({generatedAt:new Date().toISOString(), root:ROOT, cases:extracted}, null, 2));
console.log(JSON.stringify({out:OUT, cases:extracted.length, totalFiles:extracted.reduce((a,c)=>a+c.counts.files,0), counts:extracted.map(c=>({code:c.internalCode, files:c.counts.files, evidence:c.counts.evidence, pleadings:c.counts.pleadings, receipts:c.counts.receipts, parties:c.parties.length, amounts:c.amounts.length, dates:c.dates.length}))}, null, 2));
