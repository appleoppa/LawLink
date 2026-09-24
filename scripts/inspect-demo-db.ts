/** 只读巡检：本机各功能状态的演示数据覆盖情况，便于发现「哪种状态没有样本」。 */
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient({ log: [] });
const section = (name: string, rows: (string | number)[][]) => {
  console.log(`\n== ${name} ==`);
  if (!rows.length) console.log('（无记录）');
  for (const row of rows) console.log(row.join('\t'));
};
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('只允许巡检本机数据库');
  section('账号', (await db.user.findMany({ select: { role: true, systemRole: true, managerAuthorized: true, active: true, name: true, id: true }, orderBy: { role: 'asc' } })).map(u => [u.role, u.systemRole, `mgr=${u.managerAuthorized}`, `active=${u.active}`, u.name, u.id]));
  section('案件（演示）', (await db.matter.findMany({ where: { internalCode: { startsWith: 'DEMO-WORKFLOW-' } }, select: { internalCode: true, title: true, status: true, serviceStatus: true, category: true, _count: { select: { procedures: true, billings: true, feeEntries: true, documents: true, tasks: true, notes: true, parties: true } } }, orderBy: { internalCode: 'asc' } })).map(m => [m.internalCode, m.status, m.serviceStatus, `P${m._count.procedures}`, `B${m._count.billings}`, `F${m._count.feeEntries}`, `D${m._count.documents}`, `T${m._count.tasks}`, `N${m._count.notes}`, m.title]));
  section('收案', (await db.intake.findMany({ select: { title: true, status: true, _count: { select: { revisions: true, conflictChecks: true, parties: true } } }, orderBy: { createdAt: 'asc' } })).map(i => [i.status, `rev${i._count.revisions}`, `chk${i._count.conflictChecks}`, `pty${i._count.parties}`, i.title]));
  section('程序', (await db.matterProcedure.findMany({ select: { type: true, status: true, outcome: true, engagement: true, matter: { select: { internalCode: true } } }, orderBy: { matterId: 'asc' } })).map(p => [p.matter.internalCode, p.type, p.engagement, p.status, p.outcome ?? '-']));
  section('合同/应收', (await db.billing.findMany({ select: { title: true, status: true, moneyKind: true, amendmentType: true, sourceBillingId: true, contractAmount: true, _count: { select: { receivables: true, amendments: true } } }, orderBy: { createdAt: 'asc' } })).map(b => [b.status, b.amendmentType ?? '-', b.moneyKind, String(b.contractAmount), `R${b._count.receivables}`, b.sourceBillingId ? '补充协议' : '原始', b.title]));
  section('应收分期', (await db.receivable.findMany({ select: { title: true, dueState: true, status: true, amount: true, settledAmount: true, dueDate: true, conditionSatisfiedAt: true }, orderBy: { createdAt: 'asc' } })).map(r => [r.status, r.dueState, `${r.settledAmount}/${r.amount}`, r.conditionSatisfiedAt ? '条件已成就' : '-', r.title]));
  section('流水', (await db.feeEntry.findMany({ select: { type: true, confirmState: true, moneyKind: true, amount: true, beneficiaryUserId: true, parentFeeEntryId: true }, orderBy: { createdAt: 'asc' } })).map(f => [f.type, f.confirmState, f.moneyKind, String(f.amount), f.beneficiaryUserId ? '分成' : '-', f.parentFeeEntryId ? '子' : '-']));
  section('实收/核销', (await db.payment.findMany({ select: { amount: true, status: true, allocatedAmount: true, refundedAmount: true, _count: { select: { Allocation: true, invoiceAllocations: true } } }, orderBy: { createdAt: 'asc' } })).map(p => [p.status, `${p.allocatedAmount}/${p.amount}`, `退${p.refundedAmount}`, `A${p._count.Allocation}`, `票${p._count.invoiceAllocations}`]));
  section('发票申请', (await db.invoiceRequest.findMany({ select: { status: true, invoiceType: true, amount: true, invoiceNo: true, noMatterReason: true, _count: { select: { paymentAllocations: true, invoiceAdjustments: true, terminationRequests: true } } }, orderBy: { createdAt: 'asc' } })).map(i => [i.status, i.invoiceType ?? '-', String(i.amount), i.invoiceNo ?? '-', `款${i._count.paymentAllocations}`, `调${i._count.invoiceAdjustments}`, i._count.terminationRequests ? '终止中' : '-', i.noMatterReason ? '无案件' : '-']));
  section('财务更正/分成结算', [
    ...(await db.financeCorrection.findMany({ select: { type: true, status: true, amount: true }, orderBy: { createdAt: 'asc' } })).map(c => [`更正 ${c.type}`, c.status, String(c.amount)]),
    ...(await db.commissionSettlement.findMany({ select: { kind: true, amount: true, voidedAt: true }, orderBy: { createdAt: 'asc' } })).map(s => [`分成 ${s.kind}`, s.voidedAt ? '已作废' : '有效', String(s.amount)]),
  ]);
  section('用章申请', (await db.sealRequest.findMany({ select: { code: true, sealType: true, status: true, urgency: true }, orderBy: { createdAt: 'asc' } })).map(s => [`用章 ${s.code}`, s.sealType, s.status, s.urgency]));
  section('归档', (await db.archiveRecord.findMany({ select: { archiveNo: true, status: true, closedReason: true, matter: { select: { internalCode: true } } }, orderBy: { archivedAt: 'asc' } })).map(a => [a.status, a.closedReason ?? '-', a.matter.internalCode, a.archiveNo]));
  section('冲突检索', (await db.conflictCheck.findMany({ select: { conclusion: true, intakeId: true, matterId: true, note: true, _count: { select: { hits: true } } }, orderBy: { checkedAt: 'asc' } })).map(c => [c.conclusion, c.intakeId ? '收案' : c.matterId ? '案件' : '预检', `命中${c._count.hits}`, c.note ?? '-']));
  section('期限', (await db.deadline.findMany({ select: { category: true, confirmStatus: true, completed: true, dueAt: true, title: true }, orderBy: { dueAt: 'asc' } })).map(d => [d.category, d.confirmStatus, d.completed ? '已办' : '未办', d.dueAt.toISOString().slice(0, 10), d.title]));
  section('开庭', (await db.hearing.findMany({ select: { title: true, startsAt: true }, orderBy: { startsAt: 'asc' } })).map(h => [h.startsAt.toISOString().slice(0, 16), h.title]));
  section('任务', (await db.task.groupBy({ by: ['completed'], _count: true })).map(g => [g.completed ? '已完成' : '未完成', g._count]));
  section('短信', (await db.smsMessage.groupBy({ by: ['smsType', 'processed'], _count: true, orderBy: { smsType: 'asc' } })).map(s => [s.smsType, s.processed ? '已处理' : '未处理', s._count]));
  section('保全', (await db.preservationCase.findMany({ select: { type: true, status: true, _count: { select: { targets: true } } }, orderBy: { createdAt: 'asc' } })).map(p => [p.type, p.status, `被保全人${p._count.targets}`]));
  section('交接/责任', [
    ...(await db.matterHandover.findMany({ select: { status: true, emergency: true } })).map(h => ['案件交接', h.status, h.emergency ? '紧急' : '普通']),
    ...(await db.intakeHandover.findMany({ select: { status: true, emergency: true } })).map(h => ['收案交接', h.status, h.emergency ? '紧急' : '普通']),
    ...(await db.workResponsibility.groupBy({ by: ['state'], _count: true })).map(w => ['工作责任', w.state, w._count]),
    ...(await db.intakeUrgentItem.groupBy({ by: ['state'], _count: true })).map(w => ['收案急办', w.state, w._count]),
  ]);
  section('客户', (await db.client.findMany({ select: { name: true, type: true, cooperationStatus: true, idType: true, internalCode: true, deletedAt: true, _count: { select: { contacts: true, intakes: true, matterLinks: true } } }, orderBy: { createdAt: 'asc' } })).map(c => [c.type, c.cooperationStatus, c.idType ?? '-', c.internalCode ?? '-', `联系人${c._count.contacts}`, c.deletedAt ? '已删除' : '-', c.name]));
  section('通知/队列', [
    ...(await db.notification.groupBy({ by: ['type', 'read'], _count: true, orderBy: { type: 'asc' } })).map(n => [n.type, n.read ? '已读' : '未读', n._count]),
    ...(await db.jobQueue.groupBy({ by: ['status'], _count: true })).map(j => [`队列 ${j.status}`, '', j._count]),
  ]);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
