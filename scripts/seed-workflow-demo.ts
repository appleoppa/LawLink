/**
 * 本机新模型演示样本：不清理数据，不创建或改变账号/配置。
 * 按场景幂等补种：每个场景以 WORKFLOW_DEMO_SEED 审计标记判重，已存在的场景自动跳过，
 * 重复执行只补缺失部分。财务链路全部走 ledger 事务函数，保持业务不变量。
 */
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { financeLedgerReady } from '../src/server/finance/ledger-storage';
import { registerBillingTx, registerReceiptTx, registerExpenseTx, confirmReceiptTx, confirmDueConditionTx, createIntakeBillingDraftTx } from '../src/server/finance/ledger-registration';
import { allocateLedgerTx } from '../src/server/finance/ledger-mutations';
import { submitCorrectionTx, decideCorrectionTx, settleCommissionTx, commissionPositions } from '../src/server/finance/ledger-corrections';
import { draftAmendmentTx, activateAmendmentTx } from '../src/server/finance/ledger-contracts';
import { currentActor, intakeState, submitIntakeTx, fingerprint } from '../src/server/intakes/workflow';
import { runConflictCheck } from '../src/server/conflicts/algorithm';
import { scopeFor } from '../src/lib/roles/catalog';
import { storage } from '../src/lib/storage';
import { sha256 } from '../src/lib/storage/crypto';
import { encryptIdNumber, blindIdNumber } from '../src/lib/clients/id-number-crypto';
import { recordTimelineEvent } from '../src/server/timeline/record';
import { handoverSnapshot } from '../src/server/matters/handover';
import { intakeHandoverSnapshot } from '../src/server/intakes/handover';
import { checklistForCategory } from '../src/lib/archive/checklists';

const TAG = '演示 · ';
const fp = (s: string) => createHash('sha256').update(s).digest('hex');
const OPPOSING = '演示 · 恒昇置业有限公司（虚构）';

export async function seedWorkflowDemo(db: PrismaClient, ownerId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(20260919, 9001)`;
    if (!await financeLedgerReady(tx)) throw new Error('请先完成新模型切换，再生成演示数据');
    const owner = await currentActor(tx, ownerId, 'matters.write');
    if (owner.role === 'FINANCE' || (owner.role === 'CUSTOM' && (!scopeFor(owner, 'matters.write') || !scopeFor(owner, 'finance.write')))) throw new Error('承办账号须有案件与财务登记权限');
    const ownerName = (await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { name: true } })).name;
    const finance = await tx.user.findFirst({ where: { role: 'FINANCE', active: true } });
    if (!finance) throw new Error('本机没有启用中的财务账号，无法生成含确认/核销/更正的演示链路');
    const principal = await tx.user.findFirst({ where: { role: 'PRINCIPAL_LAWYER', active: true, id: { not: ownerId } } });
    const lawyer = await tx.user.findFirst({ where: { role: 'LAWYER', active: true, id: { not: ownerId } } });
    const assistant = await tx.user.findFirst({ where: { role: 'ASSISTANT', active: true } });
    const now = new Date();
    const at = (days: number, hours = 0) => new Date(now.getTime() + days * 86400000 + hours * 3600000);
    const created: string[] = [];
    const skipped: string[] = [];
    const matterIds: string[] = [];
    const intakeIds: string[] = [];

    async function scenario(name: string, exists: () => Promise<unknown>, run: () => Promise<void>) {
      if (await exists()) { skipped.push(name); return; }
      await run();
      await tx.auditLog.create({ data: { userId: ownerId, action: 'WORKFLOW_DEMO_SEED', targetType: 'DemoScenario', targetId: name, detail: { scenario: name, synthetic: true } } });
      created.push(name);
    }
    const byCode = (code: string) => tx.matter.findUnique({ where: { internalCode: code }, select: { id: true } });
    const byMarker = (name: string) => tx.auditLog.findFirst({ where: { action: 'WORKFLOW_DEMO_SEED', detail: { path: ['scenario'], equals: name } }, select: { id: true } });

    async function client(input: Parameters<typeof tx.client.create>[0]['data']) { return tx.client.create({ data: input }); }
    async function matter(code: string, data: Omit<Parameters<typeof tx.matter.create>[0]['data'], 'internalCode'>) {
      const m = await tx.matter.create({ data: { internalCode: code, ...data } as Parameters<typeof tx.matter.create>[0]['data'] });
      matterIds.push(m.id);
      return m;
    }
    async function doc(matterId: string, name: string, opts: { category?: string; status?: string; sourceOrigin?: string; uploadedById: string; procedureId?: string; folderId?: string; approved?: boolean; invoiceNo?: string } ) {
      const buf = Buffer.from(`LawLink 演示材料：${name}\n合成演示数据 · 文本占位文件 · 生成于 ${now.toISOString()}\n`, 'utf8');
      const path = await storage.writeFile(`m_${matterId}`, buf);
      return tx.document.create({ data: { matterId, name, category: (opts.category ?? 'OTHER') as never, status: (opts.status ?? 'DRAFT') as never, sourceOrigin: opts.sourceOrigin as never, procedureId: opts.procedureId, folderId: opts.folderId, path, mimeType: 'text/plain', size: buf.length, sha256: sha256(buf), uploadedById: opts.uploadedById, ...(opts.approved ? { status: 'APPROVED' as never, reviewedById: opts.uploadedById, reviewedAt: at(-14), approvedById: opts.uploadedById, approvedAt: at(-14) } : {}) } });
    }
    async function sealCode() {
      const rows = await tx.sealRequest.findMany({ where: { code: { startsWith: 'SEAL-2026-' } }, select: { code: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(-4)) || 0), 0);
      return `SEAL-2026-${String(max + 1).padStart(4, '0')}`;
    }
    /** 复刻 runCheckAndSave 的收案正式检索分支：真实跑算法并写 subjectFingerprint。 */
    async function attachIntakeCheck(intakeId: string) {
      const state = await intakeState(tx, intakeId);
      const result = await runConflictCheck(state.queries, { excludeIntakeId: intakeId, db: tx });
      const noHits = result.hits.length === 0;
      const check = await tx.conflictCheck.create({ data: { intakeId, queryPayload: { queries: state.queries, sameNameClients: result.sameNameClients, idMatchedClients: result.idMatchedClients } as object, conclusion: noHits ? 'DIFFERENT' : 'PENDING', decidedById: noHits ? ownerId : null, decidedAt: noHits ? new Date() : null, note: noHits ? '系统自动标记：未命中历史案件冲突。' : null, hits: { create: result.hits.map(h => ({ hitType: h.hitType, targetType: h.targetType, targetId: h.targetId, matchedName: h.matchedName, matchedField: h.matchedField, matchedValue: h.matchedValue, matchedRatio: h.matchedRatio, severity: h.severity, reason: h.reason })) } } });
      await tx.$executeRaw`UPDATE "ConflictCheck" SET "subjectFingerprint"=${state.subjectFingerprint} WHERE id=${check.id}`;
      return check;
    }
    async function paymentOf(feeEntryId: string) { return tx.payment.findUniqueOrThrow({ where: { feeEntryId }, select: { id: true, revision: true } }); }
    async function receivableOf(billingId: string, n = 0) { return tx.receivable.findMany({ where: { billingId }, orderBy: { installmentNumber: 'asc' }, select: { id: true, revision: true } }).then(rs => rs[n]!); }

    // ── M4 民商一审胜诉 + 执行中：正向财务全链路（应收→确认→核销→发票关联→分成→用章已盖章）
    await scenario('m4-litigation-win', () => byCode('DEMO-WORKFLOW-4'), async () => {
      const c2 = await client({ name: `${TAG}蒋雨桐（虚构）`, type: 'INDIVIDUAL', idType: 'ID_CARD', idNumber: encryptIdNumber('310101199003070000'), idNumberBlind: blindIdNumber('310101199003070000'), phone: '13800000002', cooperationStatus: 'SIGNED', tags: ['演示数据'], industry: '教育' });
      const cause = await tx.causeOfAction.findFirst({ where: { category: 'CIVIL_COMMERCIAL', active: true }, select: { id: true } });
      const m = await matter('DEMO-WORKFLOW-4', { title: `${TAG}蒋雨桐诉恒昇置业商品房买卖合同纠纷`, category: 'CIVIL_COMMERCIAL', status: 'IN_PROGRESS', ownerId, primaryClientId: c2.id, causeId: cause?.id, ourStanding: 'PLAINTIFF', claimAmount: new Prisma.Decimal('1200000'), clientLinks: { create: { clientId: c2.id, isPrimary: true, label: '主要委托方' } }, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(principal ? [{ userId: principal.id, role: 'CO_LEAD' as const }] : [])] } });
      const pClient = await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'PLAINTIFF', name: c2.name, partyType: 'NATURAL_PERSON', idType: 'ID_CARD', idNumber: '310101199003070000', phone: '13800000002' } });
      const pOpp = await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'DEFENDANT', name: OPPOSING, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL00X00', legalRep: '霍某（虚构）', address: '上海市黄浦区（虚构）' } });
      await tx.party.create({ data: { matterId: m.id, role: 'THIRD_PARTY', standing: 'THIRD_PARTY', name: `${TAG}王建国（虚构）`, partyType: 'NATURAL_PERSON' } });
      void pOpp;
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'FIRST_INSTANCE', order: 1, caseNumber: '（2026）沪0105民初1234号', handlingAgency: '上海市黄浦区人民法院', panel: '民事审判第三庭', presidingJudge: '吴法官（虚构）', ourStanding: 'PLAINTIFF', acceptedAt: at(-60), concludedAt: at(-20), status: 'CONCLUDED', outcome: 'WON', outcomeNote: '全部诉讼请求获支持', leadLawyerId: ownerId } });
      const p2 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'ENFORCEMENT', order: 2, caseNumber: '（2026）沪0105执567号', handlingAgency: '上海市黄浦区人民法院执行局', acceptedAt: at(-10), status: 'IN_PROGRESS', leadLawyerId: ownerId } });
      await tx.procedureParty.createMany({ data: [{ procedureId: p1.id, partyId: pClient.id, standing: 'PLAINTIFF' }, { procedureId: p1.id, partyId: pOpp.id, standing: 'DEFENDANT' }] });
      const s1 = await tx.matterStage.create({ data: { procedureId: p1.id, name: '起诉准备', order: 1, startedAt: at(-60), completedAt: at(-52) } });
      const s2 = await tx.matterStage.create({ data: { procedureId: p1.id, name: '庭审', order: 2, startedAt: at(-50), completedAt: at(-25) } });
      await tx.matterStage.create({ data: { procedureId: p1.id, name: '整理备用思路（已隐藏）', order: 3, status: 'HIDDEN', startedAt: at(-45) } });
      const folderLit = await tx.documentFolder.create({ data: { matterId: m.id, name: '程序卷', orderIndex: 1 } });
      const folderEv = await tx.documentFolder.create({ data: { matterId: m.id, name: '证据卷', orderIndex: 2 } });
      const contractDoc = await doc(m.id, '委托代理合同（蒋雨桐）.txt', { category: 'CONTRACT', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId, folderId: folderLit.id });
      await doc(m.id, '民事起诉状.txt', { category: 'PLEADING', status: 'APPROVED', approved: true, sourceOrigin: 'TEAM_PRODUCED', uploadedById: ownerId, procedureId: p1.id, folderId: folderLit.id });
      const evidenceCatalog = await doc(m.id, '证据目录及证据材料.txt', { category: 'EVIDENCE', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId, procedureId: p1.id, folderId: folderEv.id });
      await doc(m.id, '民事判决书（一审）.txt', { category: 'JUDGMENT', status: 'FILED', sourceOrigin: 'COURT_SERVED', uploadedById: ownerId, procedureId: p1.id, folderId: folderLit.id });
      const execDraft = await doc(m.id, '强制执行申请书（草稿）.txt', { category: 'PROCEDURE', status: 'DRAFT', sourceOrigin: 'SELF_COLLECTED', uploadedById: ownerId, procedureId: p2.id, folderId: folderLit.id });
      const stampedScan = await doc(m.id, '强制执行申请书（盖章扫描件）.txt', { category: 'PROCEDURE', status: 'FILED', sourceOrigin: 'TEAM_PRODUCED', uploadedById: ownerId, procedureId: p2.id, folderId: folderLit.id });
      await tx.task.create({ data: { matterId: m.id, stageId: s1.id, title: '演示 · 完成起诉材料并递交立案', assigneeId: ownerId, dueAt: at(-52), completed: true, completedAt: at(-53) } });
      await tx.task.create({ data: { matterId: m.id, stageId: s2.id, title: '演示 · 庭后补充代理意见', assigneeId: principal?.id ?? ownerId, dueAt: at(-22), completed: true, completedAt: at(-23) } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 跟进执行财产线索（逾期）', assigneeId: principal?.id ?? ownerId, dueAt: at(-3), priority: 2 } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 向法院提交执行立案材料', assigneeId: ownerId, dueAt: at(7), priority: 1 } });
      const appealRule = await tx.deadlineRule.findFirst({ where: { name: '民事上诉期（不服一审判决）' }, select: { id: true } });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 举证期限', category: 'EVIDENCE', dueAt: at(-45), basis: '法院举证通知', completed: true, completedAt: at(-46) } });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 上诉期（规则生成待确认）', category: 'APPEAL', dueAt: at(12), sourceRuleId: appealRule?.id, startFact: '一审判决送达之日（演示）', confirmStatus: 'PENDING' } });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 答辩期（人工调整）', category: 'RESPONSE', dueAt: at(-5), confirmStatus: 'ADJUSTED', adjustedById: ownerId, adjustedAt: at(-6) } });
      await tx.deadline.create({ data: { procedureId: p2.id, title: '演示 · 执行申请期限', category: 'ENFORCEMENT', dueAt: at(30), basis: '民事诉讼法第二百五十条（演示）' } });
      const hearing = await tx.hearing.create({ data: { procedureId: p1.id, title: '演示 · 一审开庭', room: '第三法庭', address: '上海市黄浦区（虚构）', judge: '吴法官（虚构）', startsAt: at(-25, 2), endsAt: at(-25, 5) } });
      // Task/Deadline/Hearing 插入时由 lawlink_assign_work 触发器自动建责任行；此处把开庭责任闭环为已完成
      await tx.workResponsibility.updateMany({ where: { hearingId: hearing.id }, data: { acceptedAt: at(-30), state: 'DONE', closedAt: at(-24), reason: '演示 · 庭后责任闭环' } });
      for (const [channel, day, whom, content] of [['PHONE', -30, '蒋雨桐', '演示沟通：确认委托范围与首期费用支付安排。'], ['WECHAT', -22, '蒋雨桐', '演示沟通：发送一审庭审要点提示。'], ['COURT', -20, '黄浦法院', '演示记录：收到一审判决书，向当事人转达。']] as const) {
        await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: channel as never, withWhom: whom, occurredAt: at(day), content } });
      }
      await tx.evidenceItem.create({ data: { matterId: m.id, title: '事实：购房款已全额支付', content: '转账凭证显示购房款 120 万元已于 2025-06 全额支付（演示）。', kind: 'FACT', sourceDocumentId: evidenceCatalog.id, sourcePage: 3, createdById: ownerId } });
      await tx.evidenceItem.create({ data: { matterId: m.id, title: '待核实：逾期交付天数', content: '对方主张的交付时间与物业记录不一致，需调取（演示）。', kind: 'TODO_VERIFY', createdById: ownerId } });
      await recordTimelineEvent(tx, { matterId: m.id, eventType: 'PROCEDURE_ACCEPTED', title: '一审立案受理', occurredAt: at(-60), refType: 'MatterProcedure', refId: p1.id });
      await recordTimelineEvent(tx, { matterId: m.id, eventType: 'HEARING_HELD', title: '一审开庭审理', occurredAt: at(-25), refType: 'Hearing', refId: hearing.id });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 一审及执行阶段律师费', moneyKind: 'LAWYER_FEE', amount: '100000', signedAt: at(-60), installments: [{ title: '首期', amount: '40000', dueState: 'DATE_SET', dueDate: at(-30) }, { title: '第二期（执行到账后）', amount: '60000', dueState: 'CONDITIONAL', dueCondition: '执行款项到账后 5 日内支付' }] });
      await tx.commissionPlan.createMany({ data: [{ matterId: m.id, userId: ownerId, percent: new Prisma.Decimal('60'), label: '主办' }, ...(principal ? [{ matterId: m.id, userId: principal.id, percent: new Prisma.Decimal('40'), label: '协办' }] : [])] });
      const r1 = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '40000', occurredAt: at(-25), payerOrPayee: c2.name, note: '演示 · 首期律师费' });
      await confirmReceiptTx(tx, finance.id, r1.id);
      const pay1 = await paymentOf(r1.id);
      const ar1 = await receivableOf(billing.id, 0);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay1.id, revision: pay1.revision, kind: 'RECEIVABLE', items: [{ targetId: ar1.id, amount: 40000 }] });
      const r2 = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '20000', occurredAt: at(-5), payerOrPayee: c2.name, note: '演示 · 部分第二期' });
      await confirmReceiptTx(tx, finance.id, r2.id);
      const pay2 = await paymentOf(r2.id);
      const ar2 = await receivableOf(billing.id, 1);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay2.id, revision: pay2.revision, kind: 'RECEIVABLE', items: [{ targetId: ar2.id, amount: 20000 }] });
      const invoice = await tx.invoiceRequest.create({ data: { matterId: m.id, amount: new Prisma.Decimal('40000'), invoiceType: 'SPECIAL', invoiceItem: 'LAWYER_FEE', buyerName: '蒋雨桐（虚构个人）', buyerTaxNo: null, requestNote: '演示 · 首期律师费专票', status: 'ISSUED', invoiceNo: '04812345（演示）', issuedAt: at(-20), requestedById: ownerId, requestedAt: at(-24), processedById: finance.id, processedAt: at(-20), processNote: '演示 · 财务开具电子发票并回传', evidenceDocIds: [contractDoc.id], invoiceFileId: (await doc(m.id, '电子发票-04812345.txt', { category: 'PROCEDURE', status: 'FILED', sourceOrigin: 'TEAM_PRODUCED', uploadedById: finance.id })).id } });
      await allocateLedgerTx(tx, ownerId, { paymentId: pay1.id, revision: 1, kind: 'INVOICE', items: [{ targetId: invoice.id, amount: 40000 }] });
      const purpose = await tx.sealPurposeConfig.findFirst({ where: { name: { contains: '律师函' } } });
      const stamped = await tx.sealRequest.create({ data: { code: await sealCode(), sealType: 'OFFICIAL_SEAL', matterId: m.id, purposeConfigId: purpose?.id, purposeLabel: purpose?.name, purpose: '演示 · 执行立案材料用印', documentTitle: '强制执行申请书', pageCount: 3, copies: 2, urgency: 'NORMAL', draftDocId: execDraft.id, stampedDocId: stampedScan.id, status: 'STAMPED', requestedById: ownerId, requestedAt: at(-12), approvedById: principal?.id, approvedAt: at(-11), stampedById: principal?.id, stampedAt: at(-10) } });
      void stamped;
      // 已收清后的折让申请被财务驳回：覆盖更正 REJECTED
      const ar2After = await tx.receivable.findUniqueOrThrow({ where: { id: ar2.id }, select: { revision: true } });
      const discount = await submitCorrectionTx(tx, ownerId, { targetKind: 'LEDGER', targetId: ar2.id, revision: ar2After.revision, type: 'DISCOUNT', amount: '20000', occurredAt: at(-2), reason: '演示 · 客户困难申请减免（被驳回）', voucherReference: '演示-减免申请-001', allocationReversals: [], invoiceReversals: [], waivers: [] });
      await decideCorrectionTx(tx, finance.id, { id: discount.id, revision: 0, decision: 'REJECTED', note: '演示 · 不符合减免条件，维持应收' });
    });

    // ── M5 二审进行中：待确认实收 / 待批发票与用章 / 条件应收已成就 / 保全 / 短信 / 快递 / 交接历史
    await scenario('m5-second-instance', () => byCode('DEMO-WORKFLOW-5'), async () => {
      const c5 = await client({ name: `${TAG}梁咏琳（虚构·港澳居民）`, type: 'INDIVIDUAL', idType: 'HK_MACAO_MAINLAND_PERMIT', idNumber: encryptIdNumber('H12345678'), idNumberBlind: blindIdNumber('H12345678'), cooperationStatus: 'SIGNED', tags: ['演示数据'] });
      const cause = await tx.causeOfAction.findFirst({ where: { category: 'CIVIL_COMMERCIAL', active: true }, select: { id: true } });
      const m = await matter('DEMO-WORKFLOW-5', { title: `${TAG}梁咏琳与鼎盛贸易买卖合同纠纷二审`, category: 'CIVIL_COMMERCIAL', status: 'IN_PROGRESS', ownerId, primaryClientId: c5.id, causeId: cause?.id, ourStanding: 'APPELLANT', claimAmount: new Prisma.Decimal('800000'), clientLinks: { create: { clientId: c5.id, isPrimary: true } }, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(lawyer ? [{ userId: lawyer.id, role: 'CO_LEAD' as const }] : [])] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'APPELLANT', name: c5.name, partyType: 'NATURAL_PERSON', idType: 'HK_MACAO_MAINLAND_PERMIT', idNumber: 'H12345678' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'APPELLEE', name: `${TAG}鼎盛贸易有限公司（虚构）`, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL22Y22', legalRep: '丁某（虚构）' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'FIRST_INSTANCE', order: 1, caseNumber: '（2026）沪0105民初4321号', handlingAgency: '上海市黄浦区人民法院', acceptedAt: at(-80), concludedAt: at(-35), status: 'CONCLUDED', outcome: 'PARTIAL_WON', outcomeNote: '部分诉请获支持' } });
      void p1;
      const p2 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'SECOND_INSTANCE', order: 2, caseNumber: '（2026）沪01民终888号', handlingAgency: '上海市第一中级人民法院', ourStanding: 'APPELLANT', acceptedAt: at(-30), status: 'IN_PROGRESS', leadLawyerId: ownerId } });
      await doc(m.id, '民事上诉状.txt', { category: 'PLEADING', status: 'APPROVED', approved: true, sourceOrigin: 'TEAM_PRODUCED', uploadedById: ownerId, procedureId: p2.id });
      const evidenceDoc = await doc(m.id, '二审代理合同（开票依据）.txt', { category: 'CONTRACT', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 二审律师费', moneyKind: 'LAWYER_FEE', amount: '80000', signedAt: at(-75), installments: [{ title: '二审费（开庭前支付）', amount: '80000', dueState: 'CONDITIONAL', dueCondition: '二审开庭前 10 日支付' }] });
      const ar = await receivableOf(billing.id);
      await confirmDueConditionTx(tx, ownerId, { id: ar.id, revision: ar.revision, satisfiedAt: at(-20), note: '演示 · 双方确认开庭日期，付款条件成就' });
      await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '30000', occurredAt: at(-3), payerOrPayee: c5.name, note: '演示 · 待财务确认的二审实收' });
      await tx.invoiceRequest.create({ data: { matterId: m.id, amount: new Prisma.Decimal('30000'), invoiceType: 'PLAIN', invoiceItem: 'LAWYER_FEE', buyerName: '梁咏琳（虚构个人）', requestNote: '演示 · 二审费普票申请（待批）', status: 'PENDING', requestedById: ownerId, evidenceDocIds: [evidenceDoc.id] } });
      const sealDraft = await doc(m.id, '二审代理词（待盖章稿）.txt', { category: 'PLEADING', status: 'DRAFT', sourceOrigin: 'TEAM_PRODUCED', uploadedById: ownerId, procedureId: p2.id });
      const purpose = await tx.sealPurposeConfig.findFirst({ where: { name: { contains: '律师函' } } });
      await tx.sealRequest.create({ data: { code: await sealCode(), sealType: 'OFFICIAL_SEAL', matterId: m.id, purposeConfigId: purpose?.id, purposeLabel: purpose?.name, purpose: '演示 · 二审代理词用印', documentTitle: '二审代理词', pageCount: 5, urgency: 'URGENT', draftDocId: sealDraft.id, status: 'PENDING', requestedById: ownerId } });
      await tx.deadline.create({ data: { procedureId: p2.id, title: '演示 · 二审答辩与补充证据期限', category: 'RESPONSE', dueAt: at(8), basis: '法院通知（演示）' } });
      await tx.deadline.create({ data: { procedureId: p2.id, title: '演示 · 保全续期截止', category: 'PRESERVATION', dueAt: at(25) } });
      const hearing = await tx.hearing.create({ data: { procedureId: p2.id, title: '演示 · 二审开庭', room: '第十七法庭', address: '上海市第一中级人民法院（虚构）', startsAt: at(15, 2), endsAt: at(15, 5) } });
      void hearing;
      if (lawyer) {
        const cancelledTask = await tx.task.create({ data: { matterId: m.id, title: '演示 · 调取一审卷宗（已取消分派）', assigneeId: lawyer.id, dueAt: at(5) } });
        await tx.workResponsibility.updateMany({ where: { taskId: cancelledTask.id }, data: { state: 'CANCELLED', reason: '演示 · 改由主办自行调取', closedAt: at(-1) } });
        // 交接快照走真实 handoverSnapshot（面板按 work/procedures 等数组渲染，占位快照会 500）
        const hs5 = await handoverSnapshot(tx, m.id);
        await tx.matterHandover.create({ data: { matterId: m.id, fromUserId: lawyer.id, toUserId: ownerId, initiatedById: lawyer.id, emergency: false, reason: '演示 · 律师调岗，历史交接记录', snapshot: JSON.parse(JSON.stringify(hs5.snapshot)) as object, fingerprint: hs5.fingerprint, status: 'ACCEPTED', reviewedAt: at(-15) } });
      }
      const pc = await tx.preservationCase.create({ data: { matterId: m.id, type: 'LITIGATION', status: 'ACTIVE', court: '上海市黄浦区人民法院', rulingNumber: '（2026）沪0105民初4321号之一', guaranteeType: 'CASH_DEPOSIT', appliedAt: at(-70), ownerId, note: '演示 · 诉中保全' } });
      const target = await tx.preservationTarget.create({ data: { caseId: pc.id, name: `${TAG}鼎盛贸易有限公司（虚构）` } });
      await tx.preservationProperty.create({ data: { targetId: target.id, propertyType: 'REAL_ESTATE', propertyDetail: '虚构商铺一处', amount: new Prisma.Decimal('800000'), startDate: at(-60), duration: 90, expiryDate: at(30), status: 'ACTIVE' } });
      const pcRenew = await tx.preservationCase.create({ data: { matterId: m.id, type: 'LITIGATION', status: 'RENEWED', court: '上海市黄浦区人民法院', appliedAt: at(-100), ownerId } });
      const targetRenew = await tx.preservationTarget.create({ data: { caseId: pcRenew.id, name: `${TAG}鼎盛贸易有限公司（虚构）` } });
      const propRenew = await tx.preservationProperty.create({ data: { targetId: targetRenew.id, propertyType: 'BANK_DEPOSIT', amount: new Prisma.Decimal('100000'), startDate: at(-95), duration: 30, expiryDate: at(-5), status: 'RENEWED' } });
      await tx.preservationPropertyRenewal.create({ data: { propertyId: propRenew.id, renewedAt: at(-35), oldExpiryDate: at(-65), newExpiryDate: at(-5), renewalDuration: 30, note: '演示 · 已办理续保', performedById: ownerId } });
      await tx.expressTracking.create({ data: { matterId: m.id, trackingNo: 'SF1234567890', companyCode: '顺丰速运', direction: 'OUTBOUND', purpose: '上诉状寄上海市第一中级人民法院', recipient: '上海市第一中级人民法院立案庭', recipientPhone: '021-00000000', lastState: '已签收', lastUpdateAt: at(-28), tracesJson: { traces: [{ time: at(-29).toISOString(), state: '已收件' }, { time: at(-28).toISOString(), state: '已签收' }] }, createdById: ownerId } });
      await tx.smsMessage.create({ data: { rawText: '【上海一中院】（2026）沪01民终888号 定于2026年10月开庭，请准时到庭。', receivedAt: at(-2), receivedById: ownerId, smsType: 'HEARING_NOTICE', parsedJson: { caseNumbers: ['（2026）沪01民终888号'], court: '上海市第一中级人民法院' }, matchedMatterId: m.id, matchedBy: 'AUTO_CASE_NUMBER' } });
      await tx.smsMessage.create({ data: { rawText: '【黄浦法院】（2026）沪0105民初4321号 诉讼文书已电子送达，请查收。', receivedAt: at(-33), receivedById: ownerId, smsType: 'SERVICE_NOTICE', parsedJson: { caseNumbers: ['（2026）沪0105民初4321号'], court: '上海市黄浦区人民法院' }, matchedMatterId: m.id, matchedBy: 'AUTO_CASE_NUMBER', processed: true, processedAt: at(-32) } });
      await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: 'MEETING', withWhom: '梁咏桐', occurredAt: at(-18), content: '演示 · 二审策略会谈，确认上诉重点。' } });
    });

    // ── M6 劳动仲裁：收案已转化、案件待受理、收费草稿带出（覆盖 PENDING_ACCEPTANCE / CONVERTED）
    await scenario('m6-labor-from-intake', async () => {
      const row = await tx.matter.findFirst({ where: { internalCode: 'DEMO-WORKFLOW-6' }, select: { id: true } });
      return row ?? byMarker('m6-labor-from-intake');
    }, async () => {
      const c3 = await client({ name: `${TAG}临港智造行业协会（虚构）`, type: 'ORGANIZATION', idType: 'USCC', idNumber: encryptIdNumber('51310000500000000X'), idNumberBlind: blindIdNumber('51310000500000000X'), cooperationStatus: 'NEGOTIATING', tags: ['演示数据'], legalRep: '阮某（虚构）' });
      await tx.contact.create({ data: { clientId: c3.id, name: '阮明（虚构）', title: '协会秘书长', phone: '13900000003', isPrimary: true } });
      await tx.contact.create({ data: { clientId: c3.id, name: '苏珊（虚构）', title: '人事主管', phone: '13900000004' } });
      const intake = await tx.intake.create({ data: { title: `${TAG}协会员工沈慧劳动仲裁`, category: 'LABOR_ARBITRATION', description: '演示 · 产后返岗争议，协会拟应诉', status: 'CONVERTED', receivedAt: at(-12), clientId: c3.id, clientType: 'ORGANIZATION', contactName: '苏珊（虚构）', contactPhone: '13900000004', firstProcedureType: 'LABOR_ARBITRATION', firstAgency: '上海市劳动人事争议仲裁委员会', ourStanding: 'ARBITRATION_RESPONDENT', claimAmount: new Prisma.Decimal('180000'), feeType: 'FIXED', feeAmount: new Prisma.Decimal('20000'), feeSchedule: '立案后支付 50%，结案后支付 50%', ownerUserId: ownerId, createdById: ownerId } });
      intakeIds.push(intake.id);
      await tx.party.create({ data: { intakeId: intake.id, role: 'CLIENT_PARTY', standing: 'ARBITRATION_RESPONDENT', name: c3.name, partyType: 'ORGANIZATION', enterpriseSocialCode: '51310000500000000X', legalRep: '阮某（虚构）' } });
      await tx.party.create({ data: { intakeId: intake.id, role: 'OPPOSING_PARTY', standing: 'ARBITRATION_CLAIMANT', name: `${TAG}沈慧（虚构）`, partyType: 'NATURAL_PERSON' } });
      await attachIntakeCheck(intake.id);
      const cause = await tx.causeOfAction.findFirst({ where: { category: 'LABOR_ARBITRATION', active: true }, select: { id: true } });
      const m = await matter('DEMO-WORKFLOW-6', { title: intake.title, category: 'LABOR_ARBITRATION', status: 'PENDING_ACCEPTANCE', ownerId, registeredById: ownerId, intakeId: intake.id, intakeDate: at(-12), primaryClientId: c3.id, causeId: cause?.id, ourStanding: 'ARBITRATION_RESPONDENT', claimAmount: new Prisma.Decimal('180000'), clientLinks: { create: { clientId: c3.id, isPrimary: true } }, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(assistant ? [{ userId: assistant.id, role: 'ASSISTANT' as const }] : [])] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'ARBITRATION_RESPONDENT', name: c3.name, partyType: 'ORGANIZATION', enterpriseSocialCode: '51310000500000000X' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'ARBITRATION_CLAIMANT', name: `${TAG}沈慧（虚构）`, partyType: 'NATURAL_PERSON' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'LABOR_ARBITRATION', order: 1, handlingAgency: '上海市劳动人事争议仲裁委员会', status: 'PENDING', ourStanding: 'ARBITRATION_RESPONDENT' } });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 仲裁答辩期', category: 'RESPONSE', dueAt: at(10), basis: '仲裁通知书（演示）' } });
      await createIntakeBillingDraftTx(tx, ownerId, { matterId: m.id, title: '演示 · 收案带入的收费约定（草稿）', amount: new Prisma.Decimal('20000'), schedule: '立案后支付 50%，结案后支付 50%' });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 整理员工档案与考勤记录', assigneeId: assistant?.id ?? ownerId, dueAt: at(5) } });
    });

    // ── M7 常年顾问结案：终止结算补充协议 + 归档待审（CLOSED / SERVICE_COMPLETED / ArchiveClosurePlan）
    await scenario('m7-counsel-closing', () => byCode('DEMO-WORKFLOW-7'), async () => {
      const c1 = await tx.client.findFirst({ where: { name: { contains: '明川咨询' } } });
      const m = await matter('DEMO-WORKFLOW-7', { title: `${TAG}明川咨询 2025-2026 年度常年法律顾问`, category: 'LEGAL_COUNSEL', status: 'CLOSED', serviceStatus: 'SERVICE_COMPLETED', closedAt: at(-8), ownerId, primaryClientId: c1?.id, counselType: '常年', serviceStart: at(-370), serviceEnd: at(-10), clientLinks: c1 ? { create: { clientId: c1.id, isPrimary: true } } : undefined, members: { create: [{ userId: ownerId, role: 'LEAD' }] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'NON_LITIGATION_PARTY', name: c1?.name ?? OPPOSING, partyType: 'COMPANY' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'NON_LITIGATION_PHASE', order: 1, acceptedAt: at(-370), concludedAt: at(-10), status: 'CONCLUDED', outcome: 'COMPLETED', outcomeNote: '全年顾问服务完成并验收' } });
      const confirmDoc = await doc(m.id, '顾问期满结项确认函.txt', { category: 'CONTRACT', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 顾问费支付期限', category: 'PERFORMANCE', dueAt: at(-350), completed: true, completedAt: at(-348) } });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 年度顾问费', moneyKind: 'LAWYER_FEE', amount: '30000', signedAt: at(-360), installments: [{ title: '年度顾问费', amount: '30000', dueState: 'UNKNOWN' }] });
      const receipt = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '30000', occurredAt: at(-350), payerOrPayee: c1?.name, note: '演示 · 年度顾问费已收清' });
      await confirmReceiptTx(tx, finance.id, receipt.id);
      const pay = await paymentOf(receipt.id);
      const ar = await receivableOf(billing.id);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay.id, revision: pay.revision, kind: 'RECEIVABLE', items: [{ targetId: ar.id, amount: 30000 }] });
      const alloc = await tx.allocation.findFirstOrThrow({ where: { paymentId: pay.id }, select: { id: true } });
      const term = await draftAmendmentTx(tx, ownerId, { sourceBillingId: billing.id, sourceRevision: 0, title: '演示 · 顾问期满终止结算', type: 'TERMINATION', amount: '0', signedAt: at(-12), effectiveAt: at(-10), endsAt: at(-9), reason: '演示 · 顾问合同期满终止，双方确认无未结服务', completedWork: '全年顾问服务完成（演示）', handoverWork: '无', documentIds: [confirmDoc.id], installments: [], reductions: [{ receivableId: ar.id, revision: 1, amount: '30000', allocationReversals: [{ targetId: alloc.id, amount: '30000' }] }] });
      await activateAmendmentTx(tx, finance.id, term.id, 0);
      await tx.archiveClosurePlan.create({ data: { matterId: m.id, financeOwnerId: finance.id, serviceCompletedAt: at(-8), reason: '顾问期满，双方确认服务完成', snapshot: { note: '演示 · 收尾快照' }, fingerprint: fp('demo-closure-m7') } });
      await tx.archiveRecord.create({ data: { matterId: m.id, archiveNo: '演示-GD-2026-0001', summary: '演示 · 常年顾问期满归档（待审批）', judgmentSummary: null, closedReason: 'OTHER', completedAt: at(-8), checklistJson: checklistForCategory('LEGAL_COUNSEL') as object, missingItems: ['办案小结（演示缺项说明）'], archivedBy: ownerName ?? '演示', archivedById: ownerId, status: 'PENDING_REVIEW' } });
    });

    // ── M8 刑事已归档：归档通过 + 退款更正待确认 + 发票被拒（ARCHIVED 全链）
    await scenario('m8-criminal-archived', () => byCode('DEMO-WORKFLOW-8'), async () => {
      const c4 = await client({ name: `${TAG}岑氏家族贸易行（虚构）`, type: 'COMPANY', idType: 'USCC', idNumber: encryptIdNumber('91310000MA1FL88H66'), idNumberBlind: blindIdNumber('91310000MA1FL88H66'), cooperationStatus: 'TERMINATED', tags: ['演示数据'], notes: '演示 · 合作已终止的历史客户' });
      const m = await matter('DEMO-WORKFLOW-8', { title: `${TAG}岑某涉嫌合同诈骗辩护`, category: 'CRIMINAL', status: 'CLOSED', serviceStatus: 'SERVICE_COMPLETED', closedAt: at(-35), ownerId, primaryClientId: c4.id, ourStanding: 'CRIMINAL_DEFENDANT', barFiling: 'SENSITIVE', clientLinks: { create: { clientId: c4.id, isPrimary: true } }, members: { create: [{ userId: ownerId, role: 'LEAD' }] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'CRIMINAL_INCIDENTAL_PLAINTIFF', name: c4.name, partyType: 'COMPANY' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'CRIMINAL_DEFENDANT', name: `${TAG}岑某（虚构）`, partyType: 'NATURAL_PERSON' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'INVESTIGATION', order: 1, handlingAgency: '上海市公安局黄浦分局（虚构）', acceptedAt: at(-120), concludedAt: at(-95), status: 'CONCLUDED', outcome: 'OTHER', outcomeNote: '侦查阶段辩护工作完成' } });
      const p2 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'PROSECUTION_REVIEW', order: 2, handlingAgency: '上海市黄浦区人民检察院（虚构）', acceptedAt: at(-95), concludedAt: at(-40), status: 'CONCLUDED', outcome: 'WITHDRAWN', outcomeNote: '检察院撤回起诉（演示）' } });
      await doc(m.id, '不起诉决定书（演示）.txt', { category: 'JUDGMENT', status: 'FILED', sourceOrigin: 'COURT_SERVED', uploadedById: ownerId, procedureId: p2.id });
      await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: 'COURT', withWhom: '黄浦检察院', occurredAt: at(-40), content: '演示 · 领取撤诉决定书。' } });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 刑事辩护费', moneyKind: 'LAWYER_FEE', amount: '50000', signedAt: at(-120), installments: [{ title: '辩护费', amount: '50000', dueState: 'DATE_SET', dueDate: at(-110) }] });
      const receipt = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '50000', occurredAt: at(-115), payerOrPayee: c4.name, note: '演示 · 辩护费' });
      await confirmReceiptTx(tx, finance.id, receipt.id);
      const pay = await paymentOf(receipt.id);
      const ar = await receivableOf(billing.id);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay.id, revision: pay.revision, kind: 'RECEIVABLE', items: [{ targetId: ar.id, amount: 50000 }] });
      const alloc = await tx.allocation.findFirstOrThrow({ where: { paymentId: pay.id }, select: { id: true } });
      await submitCorrectionTx(tx, ownerId, { targetKind: 'LEDGER', targetId: pay.id, revision: 1, type: 'REFUND', amount: '3000', occurredAt: at(-1), reason: '演示 · 多收部分退还应退（待财务确认）', voucherReference: '演示-退款申请-001', allocationReversals: [{ targetId: alloc.id, amount: '3000' }], invoiceReversals: [], waivers: [] });
      await tx.invoiceRequest.create({ data: { matterId: m.id, amount: new Prisma.Decimal('5000'), invoiceType: 'PLAIN', invoiceItem: 'CONSULTING_FEE', buyerName: '岑氏家族贸易行（虚构）', requestNote: '演示 · 咨询费开票', status: 'REJECTED', requestedById: ownerId, requestedAt: at(-60), processedById: finance.id, processedAt: at(-58), processNote: '演示 · 购方信息不完整，补正后重新申请' } });
      await tx.archiveRecord.create({ data: { matterId: m.id, archiveNo: '演示-GD-2026-0002', summary: '演示 · 刑事辩护卷归档（已通过）', judgmentSummary: '检察院撤回起诉（演示）', closedReason: 'OTHER', completedAt: at(-32), checklistJson: checklistForCategory('CRIMINAL') as object, missingItems: [], archivedBy: ownerName ?? '演示', archivedById: ownerId, status: 'APPROVED', reviewedAt: at(-30), reviewNote: '演示 · 材料齐全，同意归档', reviewedById: principal?.id } });
      // 归档后财务新增被服务端禁止（须 finance.tail 收尾权限），故先在 CLOSED 状态完成全部财务再翻归档
      await tx.matter.update({ where: { id: m.id }, data: { status: 'ARCHIVED', archivedAt: at(-30) } });
      await recordTimelineEvent(tx, { matterId: m.id, eventType: 'MATTER_ARCHIVED', title: '案件归档', occurredAt: at(-30) });
      void p1;
    });

    // ── M9 财务更正全家桶：退款冲销 + 支出冲销 + 分成支付/扣回/作废 + 追加协议草稿 + 无案件发票 + 代收款
    await scenario('m9-finance-corrections', () => byCode('DEMO-WORKFLOW-9'), async () => {
      const c9 = await client({ name: `${TAG}聆风科技有限公司（虚构）`, type: 'COMPANY', idType: 'USCC', idNumber: encryptIdNumber('91310000MA1FL99T77'), idNumberBlind: blindIdNumber('91310000MA1FL99T77'), cooperationStatus: 'SIGNED', tags: ['演示数据'], legalRep: '凌某（虚构）' });
      const m = await matter('DEMO-WORKFLOW-9', { title: `${TAG}聆风科技与微澜电子技术合同纠纷`, category: 'CIVIL_COMMERCIAL', status: 'IN_PROGRESS', ownerId, primaryClientId: c9.id, ourStanding: 'DEFENDANT', claimAmount: new Prisma.Decimal('2000000'), clientLinks: { create: { clientId: c9.id, isPrimary: true } }, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(lawyer ? [{ userId: lawyer.id, role: 'CO_LEAD' as const }] : [])] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'DEFENDANT', name: c9.name, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL99T77' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'PLAINTIFF', name: `${TAG}微澜电子（虚构）`, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL77U55' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'FIRST_INSTANCE', order: 1, caseNumber: '（2026）沪0105民初999号', handlingAgency: '上海市黄浦区人民法院', acceptedAt: at(-40), status: 'IN_PROGRESS', ourStanding: 'DEFENDANT' } });
      const amendmentDoc = await doc(m.id, '补充收费协议（依据材料）.txt', { category: 'CONTRACT', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId, procedureId: p1.id });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 一审律师费', moneyKind: 'LAWYER_FEE', amount: '200000', signedAt: at(-45), installments: [{ title: '一审律师费', amount: '200000', dueState: 'UNKNOWN' }] });
      await tx.commissionPlan.createMany({ data: [{ matterId: m.id, userId: ownerId, percent: new Prisma.Decimal('70'), label: '主办' }, ...(lawyer ? [{ matterId: m.id, userId: lawyer.id, percent: new Prisma.Decimal('30'), label: '协办' }] : [])] });
      const receipt = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'LAWYER_FEE', amount: '200000', occurredAt: at(-30), payerOrPayee: c9.name, note: '演示 · 全额预付律师费' });
      await confirmReceiptTx(tx, finance.id, receipt.id);
      const pay = await paymentOf(receipt.id);
      const ar = await receivableOf(billing.id);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay.id, revision: pay.revision, kind: 'RECEIVABLE', items: [{ targetId: ar.id, amount: 200000 }] });
      const alloc = await tx.allocation.findFirstOrThrow({ where: { paymentId: pay.id }, select: { id: true } });
      const invoiceFile = await doc(m.id, '电子发票-04866001.txt', { category: 'PROCEDURE', status: 'FILED', sourceOrigin: 'TEAM_PRODUCED', uploadedById: finance.id });
      const invoice = await tx.invoiceRequest.create({ data: { matterId: m.id, amount: new Prisma.Decimal('200000'), invoiceType: 'PLAIN', invoiceItem: 'LAWYER_FEE', buyerName: '聆风科技有限公司（虚构）', buyerTaxNo: '91310000MA1FL99T77', status: 'ISSUED', invoiceNo: '04866001（演示）', issuedAt: at(-25), requestedById: ownerId, requestedAt: at(-28), processedById: finance.id, processedAt: at(-25), invoiceFileId: invoiceFile.id, evidenceDocIds: [amendmentDoc.id] } });
      await allocateLedgerTx(tx, ownerId, { paymentId: pay.id, revision: 1, kind: 'INVOICE', items: [{ targetId: invoice.id, amount: 150000 }] });
      const invoiceLink = await tx.invoicePaymentAllocation.findFirstOrThrow({ where: { paymentId: pay.id }, select: { id: true } });
      const refund = await submitCorrectionTx(tx, ownerId, { targetKind: 'LEDGER', targetId: pay.id, revision: 2, type: 'REFUND', amount: '30000', occurredAt: at(-2), reason: '演示 · 阶段和解，按约定退还部分律师费', voucherReference: '演示-退款凭证-6688', allocationReversals: [{ targetId: alloc.id, amount: '30000' }], invoiceReversals: [{ targetId: invoiceLink.id, amount: '30000' }], waivers: [] });
      await decideCorrectionTx(tx, finance.id, { id: refund.id, revision: 0, decision: 'CONFIRMED', note: '演示 · 财务已核对退款凭证' });
      // 分成：先支付、部分扣回，再作废一条错误支付
      const positions = await commissionPositions(tx, [m.id]);
      const ownerPos = positions.find(p => p.beneficiaryUserId === ownerId);
      if (ownerPos) {
        const paid = await settleCommissionTx(tx, finance.id, { commissionEntryId: ownerPos.id, revision: ownerPos.revision, kind: 'PAID', amount: '50000', occurredAt: at(-5), voucherReference: '演示-银行回单-C001', note: '演示 · 分成支付' });
        await settleCommissionTx(tx, finance.id, { commissionEntryId: ownerPos.id, revision: ownerPos.revision + 1, kind: 'RECOVERED', amount: '5000', occurredAt: at(-3), voucherReference: '演示-扣回凭证-R001', note: '演示 · 退款联动扣回' });
        void paid;
      }
      if (lawyer) {
        const lawyerPos = (await commissionPositions(tx, [m.id])).find(p => p.beneficiaryUserId === lawyer.id);
        if (lawyerPos) {
          const s = await settleCommissionTx(tx, finance.id, { commissionEntryId: lawyerPos.id, revision: lawyerPos.revision, kind: 'PAID', amount: '20000', occurredAt: at(-4), voucherReference: '演示-银行回单-C002' });
          await tx.$executeRaw`UPDATE "CommissionSettlement" SET "voidedAt"=${at(-3)}, "voidReason"='演示 · 银行退票作废' WHERE id=${s.id}`;
        }
      }
      // 支出冲销：原支出全部金额一次性冲回
      const expense = await registerExpenseTx(tx, ownerId, { matterId: m.id, moneyKind: 'EXPENSE_RECOVERY', amount: '5000', occurredAt: at(-20), note: '演示 · 误登的垫付鉴定费（待冲销）' });
      const expCorrection = await submitCorrectionTx(tx, ownerId, { targetKind: 'EXPENSE', targetId: expense.id, revision: 0, type: 'REVERSAL', amount: '5000', occurredAt: at(-18), reason: '演示 · 鉴定费由对方承担，冲销误登支出', voucherReference: '演示-冲销凭证-E001' });
      await decideCorrectionTx(tx, finance.id, { id: expCorrection.id, revision: 0, decision: 'CONFIRMED', note: '演示 · 已核对鉴定费承担协议' });
      // 折让申请后由申请人撤销
      const arNow = await tx.receivable.findUniqueOrThrow({ where: { id: ar.id }, select: { revision: true } });
      const cancelled = await submitCorrectionTx(tx, ownerId, { targetKind: 'LEDGER', targetId: ar.id, revision: arNow.revision, type: 'DISCOUNT', amount: '5000', occurredAt: at(-1), reason: '演示 · 试提交的折让（将撤销）', voucherReference: '演示-折让-D001' });
      await decideCorrectionTx(tx, ownerId, { id: cancelled.id, revision: 0, decision: 'CANCELLED', note: '演示 · 申请人撤销' });
      // 追加补充协议草稿（未生效）
      await draftAmendmentTx(tx, ownerId, { sourceBillingId: billing.id, sourceRevision: 0, title: '演示 · 二审阶段追加费用协议', type: 'ADDITION', amount: '30000', signedAt: at(-1), effectiveAt: now, reason: '演示 · 客户追加二审代理，费用另计', completedWork: '', handoverWork: '', documentIds: [amendmentDoc.id], installments: [{ title: '二审追加费用', amount: '30000', dueState: 'CONDITIONAL', dueCondition: '二审程序启动后支付' }], reductions: [] });
      // 无关联案件开票（待开票）与代收款项待确认
      await tx.invoiceRequest.create({ data: { amount: new Prisma.Decimal('12000'), noMatterReason: '演示 · 律所办公场地物业费开票（无关联案件）', invoiceType: 'PLAIN', invoiceItem: 'OTHER', buyerName: '汇德物业（虚构）', status: 'APPROVED', requestedById: ownerId, requestedAt: at(-6), processedById: finance.id, processedAt: at(-4), processNote: '演示 · 已批准，待执行开票' } });
      await registerReceiptTx(tx, ownerId, { matterId: m.id, moneyKind: 'CLIENT_FUNDS', amount: '8000', occurredAt: at(-2), payerOrPayee: c9.name, note: '演示 · 代收款项（性质：代收款，待确认）' });
    });

    // ── M10 行政复议中止：保全到期/解除、逾期任务、短信队列、快递在途、待交接（ON_HOLD）
    await scenario('m10-admin-onhold', () => byCode('DEMO-WORKFLOW-10'), async () => {
      const c3 = await tx.client.findFirst({ where: { name: { contains: '临港智造' } } }) ?? await tx.client.findFirst();
      const m = await matter('DEMO-WORKFLOW-10', { title: `${TAG}临港智造协会不服市场监管行政处罚复议`, category: 'ADMINISTRATIVE', status: 'ON_HOLD', ownerId, primaryClientId: c3?.id, ourStanding: 'ADMIN_RECONSIDERATION_APPLICANT', clientLinks: c3 ? { create: { clientId: c3.id, isPrimary: true } } : undefined, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(principal ? [{ userId: principal.id, role: 'CO_LEAD' as const }] : [])] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'ADMIN_RECONSIDERATION_APPLICANT', name: c3?.name ?? `${TAG}申请人`, partyType: 'ORGANIZATION' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'ADMIN_RECONSIDERATION_RESPONDENT', name: `${TAG}某区市场监督管理局（虚构）`, partyType: 'GOVERNMENT' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'ADMIN_RECONSIDERATION', order: 1, caseNumber: '沪府复〔2026〕89号', handlingAgency: '上海市人民政府（虚构）', acceptedAt: at(-50), status: 'IN_PROGRESS', ourStanding: 'ADMIN_RECONSIDERATION_APPLICANT' } });
      await tx.deadline.create({ data: { procedureId: p1.id, title: '演示 · 复议不利时的诉讼时效', category: 'LIMITATION', dueAt: at(60), basis: '行政诉讼法（演示）' } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 补充复议理由书（已逾期）', assigneeId: principal?.id ?? ownerId, dueAt: at(-2), priority: 2 } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 整理处罚卷宗', assigneeId: ownerId, dueAt: at(-10), completed: true, completedAt: at(-9) } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 备忘：等待复议中止期间关注新规', assigneeId: ownerId } });
      await tx.procedureMemo.create({ data: { procedureId: p1.id, content: '演示 · 对方提交了新证据，注意质证。', createdById: ownerId } });
      await tx.procedureMemo.create({ data: { procedureId: p1.id, content: '演示 · 已向复议机关申请中止审理。', done: true, doneAt: at(-8), createdById: ownerId } });
      const pcExpired = await tx.preservationCase.create({ data: { matterId: m.id, type: 'PRE_LITIGATION', status: 'EXPIRED', court: '上海市黄浦区人民法院', appliedAt: at(-95), ownerId, note: '演示 · 未续期已到期' } });
      const t1 = await tx.preservationTarget.create({ data: { caseId: pcExpired.id, name: `${TAG}案外人李某（虚构）` } });
      await tx.preservationProperty.create({ data: { targetId: t1.id, propertyType: 'BANK_DEPOSIT', amount: new Prisma.Decimal('50000'), startDate: at(-95), duration: 30, expiryDate: at(-65), status: 'EXPIRED' } });
      const pcLifted = await tx.preservationCase.create({ data: { matterId: m.id, type: 'LITIGATION', status: 'LIFTED', court: '上海市黄浦区人民法院', appliedAt: at(-60), ownerId, note: '演示 · 担保置换后解除' } });
      const t2 = await tx.preservationTarget.create({ data: { caseId: pcLifted.id, name: `${TAG}鼎盛贸易有限公司（虚构）` } });
      await tx.preservationProperty.create({ data: { targetId: t2.id, propertyType: 'EQUITY', propertyDetail: '持有的某公司 10% 股权（虚构）', amount: new Prisma.Decimal('300000'), startDate: at(-60), duration: 90, expiryDate: at(30), status: 'LIFTED' } });
      await tx.smsMessage.create({ data: { rawText: '【某区法院】（2026）沪0105行初12号 行政判决书已作出。', receivedAt: at(-6), receivedById: ownerId, smsType: 'JUDGMENT_NOTICE', parsedJson: { caseNumbers: ['（2026）沪0105行初12号'], court: '上海市黄浦区人民法院' } } });
      await tx.smsMessage.create({ data: { rawText: '【上海一中院】（2026）沪01行初45号 案件已立案。', receivedAt: at(-15), receivedById: ownerId, smsType: 'FILING_NOTICE', parsedJson: { caseNumbers: ['（2026）沪01行初45号'], court: '上海市第一中级人民法院' }, matchedMatterId: m.id, matchedBy: 'MANUAL', processed: true, processedAt: at(-14) } });
      await tx.smsMessage.create({ data: { rawText: '【电子送达平台】请登录平台查收传票附件（需验证码）。', receivedAt: at(-1), receivedById: ownerId, smsType: 'SERVICE_NOTICE', parsedJson: { urls: ['https://example.invalid/demo'], needsLogin: true }, needsManualAction: true } });
      await tx.expressTracking.create({ data: { matterId: m.id, trackingNo: 'ZT8888888888', companyCode: '中通快递', direction: 'INBOUND', purpose: '复议机关退回的补正材料', recipient: '律所收发室', lastState: '在途', lastUpdateAt: at(-1), tracesJson: { traces: [{ time: at(-2).toISOString(), state: '揽件' }, { time: at(-1).toISOString(), state: '在途' }] }, createdById: ownerId } });
      if (principal) {const hs10=await handoverSnapshot(tx,m.id);await tx.matterHandover.create({ data: { matterId: m.id, fromUserId: ownerId, toUserId: principal.id, initiatedById: ownerId, emergency: false, reason: '演示 · 中止期间移交对方跟进（待接收）', snapshot: JSON.parse(JSON.stringify(hs10.snapshot)) as object, fingerprint: hs10.fingerprint, status: 'PENDING' } });}
      await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: 'MEETING', withWhom: c3?.name ?? '客户', occurredAt: at(-20), content: '演示 · 复议策略会谈。' } });
      await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: 'EMAIL', withWhom: '复议机关', occurredAt: at(-8), content: '演示 · 提交中止审理申请。' } });
    });

    // ── M11 商事仲裁 + 对方申请撤销裁决：代管款合同与知情程序（INFORMATIONAL）
    await scenario('m11-arbitration-award', () => byCode('DEMO-WORKFLOW-11'), async () => {
      const c1 = await tx.client.findFirst({ where: { name: { contains: '明川咨询' } } });
      const m = await matter('DEMO-WORKFLOW-11', { title: `${TAG}明川咨询与华振设备仲裁`, category: 'COMMERCIAL_ARBITRATION', status: 'IN_PROGRESS', ownerId, primaryClientId: c1?.id, ourStanding: 'ARBITRATION_CLAIMANT', claimAmount: new Prisma.Decimal('600000'), clientLinks: c1 ? { create: { clientId: c1.id, isPrimary: true } } : undefined, members: { create: [{ userId: ownerId, role: 'LEAD' }] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'ARBITRATION_CLAIMANT', name: c1?.name ?? `${TAG}申请人`, partyType: 'COMPANY' } });
      await tx.party.create({ data: { matterId: m.id, role: 'OPPOSING_PARTY', standing: 'ARBITRATION_RESPONDENT', name: `${TAG}华振设备有限公司（虚构）`, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL33Z11' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'COMMERCIAL_ARBITRATION', order: 1, caseNumber: '（2026）沪仲案字第666号', handlingAgency: '上海仲裁委员会（虚构）', acceptedAt: at(-90), concludedAt: at(-40), status: 'CONCLUDED', outcome: 'WON', outcomeNote: '仲裁庭支持主要请求' } });
      const p2 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'ARBITRATION_SET_ASIDE', order: 2, caseNumber: '（2026）沪02民特77号', handlingAgency: '上海市第二中级人民法院', engagement: 'INFORMATIONAL', ourStanding: 'ARBITRATION_RESPONDENT', status: 'PENDING', customLabel: '对方申请撤销裁决（知情跟进）' } });
      await doc(m.id, '仲裁裁决书.txt', { category: 'JUDGMENT', status: 'FILED', sourceOrigin: 'COURT_SERVED', uploadedById: ownerId, procedureId: p1.id });
      await tx.deadline.create({ data: { procedureId: p2.id, title: '演示 · 撤销裁决申请审查期', category: 'ARBITRATION_SET_ASIDE', dueAt: at(20) } });
      const billing = await registerBillingTx(tx, ownerId, { matterId: m.id, title: '演示 · 仲裁代管费用', moneyKind: 'CLIENT_FUNDS', amount: '50000', signedAt: at(-85), installments: [{ title: '仲裁费代管款', amount: '50000', dueState: 'DATE_SET', dueDate: at(-80) }] });
      const receipt = await registerReceiptTx(tx, ownerId, { matterId: m.id, billingId: billing.id, moneyKind: 'CLIENT_FUNDS', amount: '50000', occurredAt: at(-80), payerOrPayee: c1?.name, note: '演示 · 代管款到账' });
      await confirmReceiptTx(tx, finance.id, receipt.id);
      const pay = await paymentOf(receipt.id);
      const ar = await receivableOf(billing.id);
      await allocateLedgerTx(tx, ownerId, { paymentId: pay.id, revision: pay.revision, kind: 'RECEIVABLE', items: [{ targetId: ar.id, amount: 50000 }] });
      await doc(m.id, '撤销裁决申请书（对方提交）.txt', { category: 'PROCEDURE', status: 'FILED', sourceOrigin: 'COURT_SERVED', uploadedById: ownerId, procedureId: p2.id });
    });

    // ── M12 专项尽调：文书送审中、证据要点、无期限备忘式任务（SPECIAL_PROJECT）
    await scenario('m12-duediligence', () => byCode('DEMO-WORKFLOW-12'), async () => {
      const c1 = await tx.client.findFirst({ where: { name: { contains: '明川咨询' } } });
      const m = await matter('DEMO-WORKFLOW-12', { title: `${TAG}明川咨询收购目标公司法律尽调`, category: 'SPECIAL_PROJECT', status: 'IN_PROGRESS', ownerId, primaryClientId: c1?.id, businessType: '尽职调查', serviceScope: '目标公司主体、资产、诉讼与合规核查（演示）', deliverables: '法律尽职调查报告', clientLinks: c1 ? { create: { clientId: c1.id, isPrimary: true } } : undefined, members: { create: [{ userId: ownerId, role: 'LEAD' }, ...(assistant ? [{ userId: assistant.id, role: 'ASSISTANT' as const }] : [])] } });
      await tx.party.create({ data: { matterId: m.id, role: 'CLIENT_PARTY', standing: 'NON_LITIGATION_PARTY', name: c1?.name ?? `${TAG}委托方`, partyType: 'COMPANY' } });
      const p1 = await tx.matterProcedure.create({ data: { matterId: m.id, type: 'NON_LITIGATION_PHASE', order: 1, customLabel: '尽调实施阶段', acceptedAt: at(-15), status: 'IN_PROGRESS' } });
      const charter = await doc(m.id, '目标公司章程.txt', { category: 'CONTRACT', status: 'FILED', sourceOrigin: 'CLIENT_PROVIDED', uploadedById: ownerId, procedureId: p1.id });
      await doc(m.id, '尽调报告初稿（送审中）.txt', { category: 'OTHER', status: 'PENDING_REVIEW', sourceOrigin: 'TEAM_PRODUCED', uploadedById: ownerId, procedureId: p1.id });
      await doc(m.id, '管理层访谈笔记.txt', { category: 'EVIDENCE', status: 'DRAFT', sourceOrigin: 'TEAM_PRODUCED', uploadedById: assistant?.id ?? ownerId, procedureId: p1.id });
      await tx.evidenceItem.create({ data: { matterId: m.id, title: '事实：目标公司股权已质押 40%', content: '章程与工商记录显示 40% 股权已质押给银行（演示）。', kind: 'FACT', sourceDocumentId: charter.id, sourcePage: 5, createdById: ownerId } });
      await tx.evidenceItem.create({ data: { matterId: m.id, title: '待核实：对外担保余额', content: '访谈口径与审计报告不一致，需进一步函证（演示）。', kind: 'TODO_VERIFY', createdById: ownerId } });
      await tx.task.create({ data: { matterId: m.id, title: '演示 · 完成诉讼记录核查底稿', assigneeId: assistant?.id ?? ownerId, dueAt: at(10) } });
      await tx.note.create({ data: { matterId: m.id, authorId: ownerId, channel: 'OTHER', withWhom: '项目组', occurredAt: at(-5), content: '演示 · 尽调周会纪要。' } });
    });

    // ── I2 收案待补正 + 紧急交接待接收
    await scenario('i2-needs-revision', () => byMarker('i2-needs-revision'), async () => {
      const c5 = await tx.client.findFirst({ where: { name: { contains: '梁咏琳' } } });
      const intake = await tx.intake.create({ data: { title: `${TAG}商铺租赁纠纷（待补正）`, category: 'CIVIL_COMMERCIAL', description: '演示 · 租金欠付纠纷，材料不全待补正', status: 'NEEDS_REVISION', declinedReason: '演示 · 请补充租赁合同原件与近一年租金支付记录后重新提交', receivedAt: at(-8), clientId: c5?.id, clientType: 'INDIVIDUAL', contactName: '梁咏琳（虚构）', contactPhone: '13700000005', firstProcedureType: 'FIRST_INSTANCE', firstAgency: '上海市闵行区人民法院（虚构）', ourStanding: 'PLAINTIFF', claimAmount: new Prisma.Decimal('150000'), ownerUserId: ownerId, createdById: ownerId } });
      intakeIds.push(intake.id);
      await tx.party.create({ data: { intakeId: intake.id, role: 'CLIENT_PARTY', standing: 'PLAINTIFF', name: c5?.name ?? `${TAG}梁咏琳（虚构）`, partyType: 'NATURAL_PERSON' } });
      await tx.party.create({ data: { intakeId: intake.id, role: 'OPPOSING_PARTY', standing: 'DEFENDANT', name: `${TAG}吴某（虚构）`, partyType: 'NATURAL_PERSON' } });
      if (lawyer) {const is2=await intakeHandoverSnapshot(tx,intake.id);await tx.intakeHandover.create({ data: { intakeId: intake.id, fromUserId: ownerId, toUserId: lawyer.id, initiatedById: ownerId, emergency: true, reason: '演示 · 补正期间当事人对接移交（紧急）', snapshot: JSON.parse(JSON.stringify(is2)) as object, fingerprint: fingerprint(is2), status: 'PENDING' } });}
    });

    // ── I3 收案待审批：真实冲突命中 + 送审轮次（PENDING_CONFIRMATION + IntakeRevision）
    await scenario('i3-pending-approval', () => byMarker('i3-pending-approval'), async () => {
      const c1 = await tx.client.findFirst({ where: { name: { contains: '明川咨询' } } });
      const intake = await tx.intake.create({ data: { title: `${TAG}恒昇置业股权回购纠纷（新收案·冲突命中）`, category: 'CIVIL_COMMERCIAL', description: '演示 · 与在办案件对方主体同名，走冲突复核送审', status: 'INTAKE', receivedAt: at(-1), clientId: c1?.id, clientType: 'COMPANY', contactName: '明川法务（虚构）', contactPhone: '13600000006', firstProcedureType: 'FIRST_INSTANCE', firstAgency: '上海市黄浦区人民法院', ourStanding: 'PLAINTIFF', claimAmount: new Prisma.Decimal('900000'), ownerUserId: ownerId, createdById: ownerId } });
      intakeIds.push(intake.id);
      await tx.party.create({ data: { intakeId: intake.id, role: 'CLIENT_PARTY', standing: 'PLAINTIFF', name: c1?.name ?? `${TAG}委托方`, partyType: 'COMPANY' } });
      await tx.party.create({ data: { intakeId: intake.id, role: 'OPPOSING_PARTY', standing: 'DEFENDANT', name: OPPOSING, partyType: 'COMPANY', enterpriseSocialCode: '91310000MA1FL00X00' } });
      const check = await attachIntakeCheck(intake.id);
      if (check.conclusion === 'PENDING') {
        await tx.conflictCheck.update({ where: { id: check.id }, data: { note: '演示 · 命中在办案件对方主体，正人工复核排除中' } });
      }
      await submitIntakeTx(tx, ownerId, intake.id);
      await tx.intakeUrgentItem.create({ data: { intakeId: intake.id, title: '演示 · 固定股权回购协议原件', dueAt: at(2), kind: 'TASK', assigneeId: ownerId, state: 'OPEN' } });
    });

    // ── I4 收案已拒绝（DECLINED）
    await scenario('i4-declined', () => byMarker('i4-declined'), async () => {
      const intake = await tx.intake.create({ data: { title: `${TAG}合伙份额转让咨询（不承接）`, category: 'NON_LITIGATION', description: '演示 · 对方同时接触本所另一团队，冲突风险高', status: 'DECLINED', declinedReason: '演示 · 对方同时与本所另一团队接触，利益冲突风险高，经沟通不承接', receivedAt: at(-20), ownerUserId: ownerId, createdById: ownerId } });
      intakeIds.push(intake.id);
      await tx.party.create({ data: { intakeId: intake.id, role: 'CLIENT_PARTY', standing: 'NON_LITIGATION_PARTY', name: `${TAG}吕某（虚构）`, partyType: 'NATURAL_PERSON' } });
    });

    // ── 附加样本：工作区冲突预检（无收案归属、恒 PENDING）+ 通知中心样本
    await scenario('extra-precheck-notifications', () => byMarker('extra-precheck-notifications'), async () => {
      const queries = [{ role: 'OPPOSING_PARTY' as const, name: OPPOSING }];
      const result = await runConflictCheck(queries, { db: tx });
      await tx.conflictCheck.create({ data: { queryPayload: { queries, sameNameClients: result.sameNameClients, idMatchedClients: result.idMatchedClients } as object, conclusion: 'PENDING', hits: { create: result.hits.map(h => ({ hitType: h.hitType, targetType: h.targetType, targetId: h.targetId, matchedName: h.matchedName, matchedField: h.matchedField, matchedValue: h.matchedValue, matchedRatio: h.matchedRatio, severity: h.severity, reason: h.reason })) } } });
      const m4 = await tx.matter.findUnique({ where: { internalCode: 'DEMO-WORKFLOW-4' }, select: { id: true } });
      await tx.notification.createMany({ data: [
        { userId: ownerId, type: 'DEADLINE_REMINDER', priority: 'HIGH', title: '演示 · 期限临近：上诉期待确认', content: '案件「蒋雨桐诉恒昇置业」有规则生成的上诉期待确认', href: m4 ? `/matters/${m4.id}` : '/matters' },
        { userId: ownerId, type: 'HEARING_REMINDER', priority: 'HIGH', title: '演示 · 开庭提醒', content: '二审开庭将于 15 天后举行' },
        { userId: ownerId, type: 'TASK_ASSIGNED', priority: 'NORMAL', title: '演示 · 新任务分派', content: '「整理员工档案与考勤记录」已分派给你' },
        { userId: ownerId, type: 'SMS_ARRIVAL', priority: 'NORMAL', title: '演示 · 收到法院短信', content: '收到 1 条需人工处理的电子送达通知', href: '/inbox' },
        { userId: ownerId, type: 'SEAL_STATUS_CHANGE', priority: 'NORMAL', title: '演示 · 用章申请已盖章', content: '强制执行申请书用章已完成', read: true, readAt: at(-10) },
      ] });
    });

    return { matterIds, intakeIds, created, skipped, financeId: finance.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
}
