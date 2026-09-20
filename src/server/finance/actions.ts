"use server";
import {insertFinanceRowTx} from "@/server/finance/allocation-internals";
import { financeLedgerReady } from "./ledger-storage";
import type { MoneyKind } from "@/lib/finance/ledger-labels";
import { confirmReceiptTx,rejectReceiptTx,deleteBillingDraftTx } from "./ledger-registration";
import { commissionPositions } from "./ledger-corrections";
import { getFinanceFacts, periodReceipts, sumAmounts, shMonthStart, shYearStart, financeTrend } from "./facts";
import { roleMutation, checkRoleMutation } from "@/lib/roles/service";
import { scopeFor } from "@/lib/roles/catalog";
import { canReadDocument } from "@/lib/approvals/documents";
import { requireApprovalRoute } from "@/lib/approvals/service";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { requireSession } from "@/lib/auth/session";
import { audit,auditTx } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { generateReceivableForBilling, generatePaymentForReceivedEntry } from "@/server/finance/allocation-internals";
import { serializeDecimals } from "@/lib/decimal";
import {
  assertCanAccessMatterFinance,
  assertCanAssociateMatter,
  assertCanLeadMatter,
  canConfirmReceipt,
  isManager,
  matterFinanceVisibilityFilter
} from "@/lib/permissions";
import {
  billingCreateSchema,
  feeEntryCreateSchema,
  commissionPlanSetSchema,
  type BillingCreateInput,
  type FeeEntryCreateInput,
  type CommissionPlanSetInput
} from "./schemas";
import { notifyRoleApprovers } from "@/server/notifications/approval";
import { createNotification } from "@/server/notifications/create";
import {
  invoiceMatterSearchLimit,
  invoiceMatterSearchWhere
} from "./invoice-matter-search";
import { revalidateMatter } from "@/server/matters/route";
import { allocateCommissions } from "./commissions";
import { recordTimelineEvent } from "@/server/timeline/record";

// ============ Billing ============

export async function createBilling(input: BillingCreateInput) {
  const session = await requireSession("finance.write");
  if(await financeLedgerReady(prisma))throw new Error("请在应收与收款分配页面登记收费及分期");
  const data = billingCreateSchema.parse(input);
  await assertMatterWritable(data.matterId, { allowFinanceRole: true });

  // v1.x §二：合同与应收同事务创建（签署即确认收费安排 → 应收立项）
  const created = await prisma.$transaction(async tx => {
    await checkRoleMutation(tx, session.user, "finance.write");
    const billing = await insertFinanceRowTx(tx,'Billing',{
        matterId: data.matterId,
        title: data.title,
        contractAmount: new Prisma.Decimal(data.contractAmount),
        schedule: data.schedule || null,
        status: data.status,
        signedAt: data.signedAt
      });
    if (billing.signedAt) {
      await generateReceivableForBilling(tx, {
        matterId: data.matterId,
        billingId: billing.id,
        title: billing.title,
        amount: billing.contractAmount
      });
    }
    return billing;
  });

  await audit({
    userId: session.user.id,
    action: "BILLING_CREATE",
    targetType: "Billing",
    targetId: created.id,
    detail: { matterId: data.matterId }
  });

  await revalidateMatter(data.matterId);
  return { ok: true, id: created.id };
}

export async function deleteBilling(id: string) {
  const session = await requireSession("finance.write");
  if(await financeLedgerReady(prisma)) {
    const result=await prisma.$transaction(tx=>deleteBillingDraftTx(tx,session.user.id,id),{isolationLevel:"Serializable"});
    await revalidateMatter(result.matterId);revalidatePath("/finance/reconciliation");
    return {ok:true};
  }
  const billing = await prisma.billing.findUnique({
    where: { id },
    select: { matterId: true, signedAt: true, title: true }
  });
  if (!billing) return { ok: false };

  // P0-6：已签署的合同（收费安排）是已确认记录，不得物理删除；
  // 更正需求待 P1 核销/冲正机制，现阶段如需调整请联系管理员按审计流程处理。
  if (billing.signedAt) {
    throw new Error("该合同已签署，属于已确认记录，不可删除");
  }

  if (session.user.role === "FINANCE" || (session.user.role === "CUSTOM" && scopeFor(session.user, "finance.write") === "ALL")) {
    await assertMatterWritable(billing.matterId, { allowFinanceRole: true });
  } else {
    await assertMatterWritable(billing.matterId);
    await assertCanLeadMatter(session.user.id, billing.matterId, "仅案件主办/协办或财务可删除合同");
  }

  await roleMutation(session.user, "finance.write", async roleDb => roleDb.billing.delete({ where: { id } }));
  await audit({
    userId: session.user.id,
    action: "BILLING_DELETE",
    targetType: "Billing",
    targetId: id
  });
  await revalidateMatter(billing.matterId);
  return { ok: true };
}

// ============ FeeEntry + 自动分成 ============

/**
 * 创建一条收付记录。
 * - RECEIVED 一律先挂「待确认」，确认（confirmFeeEntry）时才生成实收、派生 COMMISSION 子条目并写时间线
 * - parent / children 通过 parentFeeEntryId 关联
 */
export async function createFeeEntry(input: FeeEntryCreateInput) {
  const session = await requireSession("finance.write");
  if(await financeLedgerReady(prisma))throw new Error("请在应收与收款分配页面登记收款；退款须通过财务更正处理");
  const data = feeEntryCreateSchema.parse(input);
  await assertMatterWritable(data.matterId, { allowFinanceRole: true });

  // 2026-09-19 用户确认：实收一律先挂「待确认」，谁登记的都一样（含主任律师自己收的案件），
  // 不生成实收、不派生分成、不进时间线，也不计入已实收；须由具「确认实收到账」权限的人确认。
  const pendingConfirm = data.type === "RECEIVED";

  const created = await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "finance.write");
    const entry = await insertFinanceRowTx(tx,'FeeEntry',{
        matterId: data.matterId,
        billingId: data.billingId || null,
        type: data.type,
        amount: new Prisma.Decimal(data.amount),
        occurredAt: data.occurredAt,
        invoiceNo: data.invoiceNo || null,
        payerOrPayee: data.payerOrPayee || null,
        method: data.method || null,
        note: data.note || null,
        recordedById: session.user.id,
        confirmState: pendingConfirm ? "PENDING" : "CONFIRMED"
      });

    if (pendingConfirm) return entry;

    return entry;
  });

  await audit({
    userId: session.user.id,
    action: pendingConfirm ? "FEE_ENTRY_SUBMIT" : "FEE_ENTRY_CREATE",
    targetType: "FeeEntry",
    targetId: created.id,
    detail: { matterId: data.matterId, type: data.type, amount: data.amount, pendingConfirm }
  });

  if (pendingConfirm) {
    // 记录已落库：通知属于事后副作用，失败只记日志，不能把成功的登记报成失败（重试会重复登记）
    try {
      const matter = await prisma.matter.findUnique({ where: { id: data.matterId }, select: { internalCode: true, title: true } });
      const receivers = await usersWhoCanConfirmReceipt(session.user.id);
      await Promise.all(receivers.map((userId) => createNotification({
        userId,
        type: "SYSTEM",
        priority: "NORMAL",
        title: "有实收待确认",
        content: `${session.user.name ?? "有用户"} 登记了实收 ¥${data.amount.toLocaleString("zh-CN")}${matter ? `：${matter.internalCode} ${matter.title}` : ""}，请核对到账后确认`,
        href: "/finance",
        refType: "FeeEntry",
        refId: created.id
      })));
    } catch (err) {
      console.error("[finance] 待确认实收通知发送失败：", err);
      // 通知失败不影响登记，但必须留痕，否则「发不出去」会长期没人发现
      await audit({
        userId: session.user.id,
        action: "FEE_ENTRY_NOTIFY_FAILED",
        targetType: "FeeEntry",
        targetId: created.id,
        detail: { matterId: data.matterId, reason: err instanceof Error ? err.message : String(err) }
      });
    }
  }

  await revalidateMatter(data.matterId);
  revalidatePath("/finance");
  revalidatePath("/approvals");
  return { ok: true, id: created.id, pendingConfirm };
}

/** 持有「确认实收到账」的人：内置财务岗 + 自定义角色里勾了 finance.confirm 的账号 */
async function usersWhoCanConfirmReceipt(excludeUserId?: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      OR: [
        { role: "FINANCE" },
        { role: "CUSTOM", roleDefinition: { active: true, permissions: { some: { permissionKey: "finance.confirm", scope: "ALL" } } } }
      ]
    },
    select: { id: true }
  });
  return rows.map((r) => r.id);
}

/**
 * 确认实收（2026-09-19 口径）：确认后才生成实收 Payment、派生分成、写案件时间线并计入统计。
 * 仅限具备「确认实收到账」（finance.confirm）的财务管理人员；确认金额与登记金额一致，需要改额就退回重登。
 */
export async function confirmFeeEntry(id: string) {
  const session = await requireSession("finance.confirm");
  if (!canConfirmReceipt(session.user)) throw new Error("仅具备「确认实收到账」权限的财务管理人员可确认实收");
  if(await financeLedgerReady(prisma)) {
    const result=await prisma.$transaction(tx=>confirmReceiptTx(tx,session.user.id,id),{isolationLevel:"Serializable",timeout:20000});
    await revalidateMatter(result.matterId);revalidatePath("/finance");revalidatePath("/finance/reconciliation");return {ok:true};
  }
  const entry = await prisma.feeEntry.findUnique({ where: { id }, select: { id: true, matterId: true, type: true, amount: true, occurredAt: true, billingId: true, confirmState: true } });
  if (!entry) throw new Error("记录不存在");
  if (entry.type !== "RECEIVED") throw new Error("只有实收需要确认");
  if (entry.confirmState === "CONFIRMED") throw new Error("此笔已确认");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, entry.matterId, session.user.rolePermissions);
  await assertMatterWritable(entry.matterId, { allowFinanceRole: true });

  await prisma.$transaction(async (tx) => {
    // 与 setCommissionPlan / ledger 路径共用同一事务级咨询锁：读取分成方案与整体替换互斥，防止按旧方案派生分成
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await checkRoleMutation(tx, session.user, "finance.confirm");
    const updated = await tx.feeEntry.updateMany({
      where: { id, confirmState: "PENDING" },
      data: { confirmState: "CONFIRMED", confirmedById: session.user.id, confirmedAt: new Date() }
    });
    if (updated.count === 0) throw new Error("此笔已被处理，请刷新后重试");

    const amount = Number(entry.amount);
    if (amount > 0) {
      await generatePaymentForReceivedEntry(tx, {
        matterId: entry.matterId,
        feeEntryId: entry.id,
        amount: entry.amount,
        occurredAt: entry.occurredAt,
        recordedById: session.user.id
      });
      const plans = await tx.commissionPlan.findMany({ where: { matterId: entry.matterId, active: true } });
      const shares = allocateCommissions(amount, plans);
      for (const [index, plan] of plans.entries()) {
        const share = shares[index];
        if (share.lte(0)) continue;
        await insertFinanceRowTx(tx,'FeeEntry',{
            matterId: entry.matterId,
            billingId: entry.billingId,
            type: "COMMISSION",
            amount: share,
            occurredAt: entry.occurredAt,
            parentFeeEntryId: entry.id,
            beneficiaryUserId: plan.userId,
            note: plan.label ? `按方案 [${plan.label}] 自动分成 ${plan.percent}%` : `自动分成 ${plan.percent}%`,
            recordedById: session.user.id
          });
      }
    }
    await recordTimelineEvent(tx, {
      matterId: entry.matterId,
      eventType: "FEE_RECEIVED",
      title: `实收 ¥${Number(entry.amount).toLocaleString("zh-CN")}`,
      occurredAt: entry.occurredAt
    });
  });

  await audit({ userId: session.user.id, action: "FEE_ENTRY_CONFIRM", targetType: "FeeEntry", targetId: id, detail: { matterId: entry.matterId, amount: Number(entry.amount) } });
  await revalidateMatter(entry.matterId);
  revalidatePath("/finance");
  return { ok: true };
}

/** 退回待确认实收：删除该条并留审计与通知，登记人按实际到账重新登记 */
export async function rejectFeeEntry(id: string, reason: string) {
  const session = await requireSession("finance.confirm");
  if (!canConfirmReceipt(session.user)) throw new Error("仅具备「确认实收到账」权限的财务管理人员可退回实收");
  if(await financeLedgerReady(prisma)) {
    const result=await prisma.$transaction(tx=>rejectReceiptTx(tx,session.user.id,id,reason),{isolationLevel:"Serializable",timeout:20000});
    await revalidateMatter(result.matterId);revalidatePath("/finance");revalidatePath("/finance/reconciliation");return {ok:true};
  }
  const note = reason.trim();
  if (!note) throw new Error("请填写退回原因");
  const entry = await prisma.feeEntry.findUnique({ where: { id }, select: { id: true, matterId: true, type: true, amount: true, confirmState: true, recordedById: true, matter: { select: { internalCode: true, title: true } } } });
  if (!entry) throw new Error("记录不存在");
  if (entry.type !== "RECEIVED" || entry.confirmState !== "PENDING") throw new Error("只有待确认的实收可以退回");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, entry.matterId, session.user.rolePermissions);
  await assertMatterWritable(entry.matterId, { allowFinanceRole: true });

  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "finance.confirm");
    const removed = await tx.feeEntry.deleteMany({ where: { id, confirmState: "PENDING" } });
    if (removed.count === 0) throw new Error("此笔已被处理，请刷新后重试");
  });

  await audit({ userId: session.user.id, action: "FEE_ENTRY_REJECT", targetType: "FeeEntry", targetId: id, detail: { matterId: entry.matterId, amount: Number(entry.amount), reason: note } });
  // 条目已删除：通知属于事后副作用，失败不能把已成功的退回报成失败（重试只会得到「记录不存在」）
  try {
    await createNotification({
      userId: entry.recordedById,
      type: "SYSTEM",
      title: "实收登记被退回",
      content: `${entry.matter.internalCode} ${entry.matter.title} 的实收 ¥${Number(entry.amount).toLocaleString("zh-CN")} 被退回：${note}`,
      href: "/finance",
      refType: "FeeEntry",
      refId: id
    });
  } catch (err) {
    console.error("[finance] 退回实收通知发送失败：", err);
    await audit({
      userId: session.user.id,
      action: "FEE_ENTRY_NOTIFY_FAILED",
      targetType: "FeeEntry",
      targetId: id,
      detail: { matterId: entry.matterId, stage: "reject", reason: err instanceof Error ? err.message : String(err) }
    });
  }
  await revalidateMatter(entry.matterId);
  revalidatePath("/finance");
  return { ok: true };
}

export async function deleteFeeEntry(id: string) {
  const session = await requireSession("finance.write");
  if(await financeLedgerReady(prisma))throw new Error("待确认实收请填写原因退回；已入账收付请通过财务更正处理");
  if (session.user.role !== "CUSTOM" && !isManager(session.user.role) && session.user.role !== "FINANCE") {
    throw new Error("仅管理员、主办律师或财务可删除收付记录");
  }
  const entry = await prisma.feeEntry.findUnique({
    where: { id },
    select: { matterId: true, type: true, confirmState: true, parentFeeEntryId: true, invoiceNo: true, billing: { select: { signedAt: true } } }
  });
  if (!entry) return { ok: false };

  // P0-6：已确认的收付记录不得物理删除——
  // 属于已签署合同的条目、或已登记发票号的收款，均属已对外/已确认口径，
  // 更正需求待 P1 冲正机制，现阶段联系管理员按审计流程处理。
  if (entry.billing?.signedAt) {
    throw new Error("该记录关联已签署合同，属于已确认记录，不可删除");
  }
  if (entry.invoiceNo) {
    throw new Error("该记录已登记发票号，属于已确认记录，不可删除");
  }
  // 已确认的实收在确认时已生成实收 Payment（可能已被核销）与分成条目，
  // 物理删除会让 FeeEntry 口径与 Payment / 应收核销口径对不上，只能走冲正。
  if (entry.type === "RECEIVED" && entry.confirmState === "CONFIRMED") {
    throw new Error("该实收已确认到账并已入账，不可删除；如需更正请登记退款 / 冲正");
  }
  // 待确认实收只能走「退回」：需确认权、填原因、通知登记人；删除会绕过这三条
  if (entry.type === "RECEIVED" && entry.confirmState === "PENDING") {
    throw new Error("待确认实收请在财务页用「退回」处理，需填写原因并通知登记人");
  }
  // 确认时自动派生的分成与父实收绑定：单独删会让分成合计与父实收对不上，
  // 只能随父实收整体冲正；无父条目的手工分成不受此限
  if (entry.type === "COMMISSION" && entry.parentFeeEntryId) {
    throw new Error("该分成由实收确认时自动派生，不可单独删除；如需更正请登记退款 / 冲正");
  }

  await assertMatterWritable(entry.matterId, { allowFinanceRole: true });

  // 条件删除：读取与删除之间，发票号、合同签署都可能被改动，
  // 因此把判定一并放进 where，按受影响行数决定成败（0 行即说明期间已对外开票/签合同）。
  await prisma.$transaction(async (tx) => {
    await checkRoleMutation(tx, session.user, "finance.write");
    const removed = await tx.feeEntry.deleteMany({
      where: {
        id,
        invoiceNo: null,
        OR: [{ billingId: null }, { billing: { is: { signedAt: null } } }]
      }
    });
    if (removed.count === 0) throw new Error("该记录在此期间已对外开票或关联已签署合同，不可删除；如需更正请登记退款 / 冲正");
  });

  await audit({
    userId: session.user.id,
    action: "FEE_ENTRY_DELETE",
    targetType: "FeeEntry",
    targetId: id,
    detail: { matterId: entry.matterId, type: entry.type }
  });
  await revalidateMatter(entry.matterId);
  revalidatePath("/finance");
  revalidatePath("/approvals");
  return { ok: true };
}

// ============ CommissionPlan ============

/**
 * 整体替换案件的分成方案。
 * 简单策略：删除所有现有 plan，按 items 创建新的。
 */
export async function setCommissionPlan(input: CommissionPlanSetInput) {
  const session = await requireSession("finance.write");
  const data = commissionPlanSetSchema.parse(input);
  await assertMatterWritable(data.matterId);
  await assertCanLeadMatter(session.user.id, data.matterId, "仅案件主办/协办可设置分成方案");

  await prisma.$transaction(async db => {
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72606101)`;
    await checkRoleMutation(db, session.user, "finance.write");
    await db.commissionPlan.deleteMany({ where: { matterId: data.matterId } });
    await db.commissionPlan.createMany({
      data: data.items.map((it) => ({
        matterId: data.matterId,
        userId: it.userId,
        percent: new Prisma.Decimal(it.percent),
        label: it.label || null,
        active: true
      }))
    });
    await auditTx(db,{
    userId: session.user.id,
    action: "COMMISSION_PLAN_SET",
    targetType: "Matter",
    targetId: data.matterId,
    detail: { itemCount: data.items.length }
    });
  });

  await revalidateMatter(data.matterId);
  return { ok: true };
}

// ============ 全局财务统计 ============

export async function getMatterFinance(matterId: string) {
  const session = await requireSession("finance.read");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, matterId, session.user.rolePermissions);

  const [billings, entries, plans, issuedInvoices] = await Promise.all([
    prisma.billing.findMany({
      where: { matterId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.feeEntry.findMany({
      where: { matterId },
      orderBy: { occurredAt: "desc" },
      include: {
        beneficiaryUser: { select: { id: true, name: true } },
        parentFeeEntry: { select: { id: true, type: true } }
      }
    }),
    prisma.commissionPlan.findMany({
      where: { matterId },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: "asc" }
    }),
    // 开票金额：已开具发票合计（净额口径——扣减红冲/折让/换开调整，与对账页一致）
    prisma.invoiceRequest.findMany({
      where: { matterId, status: "ISSUED" },
      select: { id: true, amount: true }
    })
  ]);

  const sum = (filter: (e: (typeof entries)[number]) => boolean) =>
    entries.filter(filter).reduce((acc, e) => acc + Number(e.amount), 0);

  let invoiceAdjustmentTotal = 0;
  try {
    const rows = await prisma.invoiceAdjustment.groupBy({
      by: ["invoiceId"],
      _sum: { amount: true },
      where: { invoice: { matterId } }
    });
    invoiceAdjustmentTotal = rows.reduce((acc, r) => acc + Number(r._sum.amount ?? 0), 0);
  } catch {
    // InvoiceAdjustment 表尚未迁移的库：无红冲能力，净额即票面
    invoiceAdjustmentTotal = 0;
  }
  const facts = await getFinanceFacts({id:matterId});
  // 旧口径（未升级库）：应收/实收均来自 FeeEntry，无独立「已核销」口径；
  // 回款进度分子退回已确认实收合计（与 received 同源），使进度 = 已收/应收，与升级前展示一致
  const legacyReceivable = sum((e) => e.type === "RECEIVABLE");
  const legacyReceived = sum((e) => e.type === "RECEIVED" && e.confirmState === "CONFIRMED");
  const stats = {
    outstanding: facts ? Number(facts.lawyerSummary.outstanding) : Math.max(0,legacyReceivable-legacyReceived),
    allocated: facts ? Number(facts.lawyerSummary.receivable)-Number(facts.lawyerSummary.outstanding) : legacyReceived,
    clientFunds: facts ? Number(facts.summary.clientFundsReceived) : 0,
    contractAmount: facts ? sumAmounts(facts.billings.filter(b=>b.signedAt&&b.moneyKind==='LAWYER_FEE').map(b=>({amount:b.contractAmount}))) : billings.filter(b=>b.signedAt).reduce((acc, b) => acc + Number(b.contractAmount), 0),
    receivable: facts ? Number(facts.lawyerSummary.receivable) : legacyReceivable,
    received: facts ? Number(facts.lawyerSummary.netReceived) : legacyReceived,
    pendingReceived: sum((e) => e.type === "RECEIVED" && e.confirmState === "PENDING"),
    refund: facts ? sumAmounts(facts.refunds) : sum((e) => e.type === "REFUND"),
    cost: facts ? sumAmounts(facts.expenses.map(e=>({amount:e.amount.minus(e.reversed)}))) : sum((e) => e.type === "COST"),
    commission: facts ? sumAmounts(facts.commissions.map(c=>({amount:c.accrued}))) : sum((e) => e.type === "COMMISSION"),
    invoiced: issuedInvoices.reduce((acc, i) => acc + Number(i.amount), 0) - invoiceAdjustmentTotal
  };

  return serializeDecimals({ billings, entries, plans, stats, ledgerReady:Boolean(facts) });
}

/**
 * v0.11: 列出案件下的申请发票
 */
export async function listMatterInvoiceRequests(matterId: string) {
  const session = await requireSession("approval");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, matterId, session.user.rolePermissions);
  const rows = await prisma.invoiceRequest.findMany({
    where: { matterId },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      amount: true,
      title: true,
      status: true,
      processNote: true,
      requestedAt: true,
      processedAt: true,
      invoiceType: true,
      invoiceItem: true,
      buyerName: true,
      buyerTaxNo: true,
      evidenceDocIds: true,
      invoiceNo: true,
      issuedAt: true
    }
  });
  return serializeDecimals(rows);
}

/**
 * v0.12: 获取案件用于开票的默认信息（客户抬头 + 关联 Intake id）
 */
export async function getMatterInvoiceContext(matterId: string) {
  const session = await requireSession("approval");
  await assertCanAccessMatterFinance(session.user.id, session.user.role, matterId, session.user.rolePermissions);
  const m = await prisma.matter.findUnique({
    where: { id: matterId },
    select: {
      id: true,
      title: true,
      intakeId: true,
      intake: {
        select: {
          id: true,
          status: true,
          receivedAt: true,
          client: { select: { name: true } }
        }
      },
      primaryClientId: true,
      primaryClient: { select: { id: true, name: true, idNumber: true } },
      clientLinks: {
        select: {
          isPrimary: true,
          client: { select: { id: true, name: true, idNumber: true } }
        }
      }
    }
  });
  if (!m) throw new Error("案件不存在");

  // v0.42 项3：开票抬头下拉 = 本案关联的全部客户（去重，主要客户置顶）
  const clientMap = new Map<
    string,
    { id: string; name: string; taxNo: string | null; isPrimary: boolean }
  >();
  if (m.primaryClient) {
    clientMap.set(m.primaryClient.id, {
      id: m.primaryClient.id,
      name: m.primaryClient.name,
      taxNo: decryptIdNumber(m.primaryClient.idNumber) || null,
      isPrimary: true
    });
  }
  for (const link of m.clientLinks) {
    if (!link.client) continue;
    const existing = clientMap.get(link.client.id);
    if (existing) {
      existing.isPrimary = existing.isPrimary || link.isPrimary;
    } else {
      clientMap.set(link.client.id, {
        id: link.client.id,
        name: link.client.name,
        taxNo: decryptIdNumber(link.client.idNumber) || null,
        isPrimary: link.isPrimary
      });
    }
  }
  const clientOptions = Array.from(clientMap.values()).sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary)
  );

  return {
    matterId: m.id,
    matterTitle: m.title,
    intakeId: m.intakeId ?? null,
    intake: m.intake
      ? {
          id: m.intake.id,
          status: m.intake.status,
          receivedAt: m.intake.receivedAt,
          clientName: m.intake.client?.name ?? null
        }
      : null,
    clientOptions,
    defaultBuyerName:
      m.primaryClient?.name ?? m.intake?.client?.name ?? null
  };
}

/**
 * v0.12: 创建开票申请（带类型/名目/抬头/依据）
 */
export async function createInvoiceRequest(input: {
  // v0.43 项5：matterId 可空——无关联案件开票须填 noMatterReason
  matterId: string | null;
  noMatterReason?: string | null;
  amount: number;
  invoiceType: "PLAIN" | "SPECIAL";
  invoiceItem: "LAWYER_FEE" | "CONSULTING_FEE" | "AGENCY_FEE" | "OTHER";
  buyerName: string;
  buyerTaxNo?: string | null;
  // v0.42 项4：增值税专用发票购方六要素（专票必填）
  buyerAddress?: string | null;
  buyerPhone?: string | null;
  buyerBank?: string | null;
  buyerBankAccount?: string | null;
  evidenceDocIds: string[];
  requestNote?: string | null;
}) {
  const session = await requireSession("approval");
  if (input.matterId) {
    await assertCanAssociateMatter(session.user.id, input.matterId);
    await assertMatterWritable(input.matterId);
  } else {
    // 无关联案件开票仅财务 / 管理员 / 主任可发起，且必须说明原因
    if (!isManager(session.user.role) && session.user.role !== "FINANCE" && !(session.user.role === "CUSTOM" && scopeFor(session.user, "finance.write") === "ALL")) {
      throw new Error("无关联案件开票仅财务 / 管理员 / 主任律师可发起");
    }
    if (!input.noMatterReason?.trim()) {
      throw new Error("无关联案件时必须填写原因说明");
    }
  }

  if (input.amount <= 0) throw new Error("金额必须大于 0");
  if (input.invoiceType !== "PLAIN" && input.invoiceType !== "SPECIAL") {
    throw new Error("请选择开票类型");
  }
  if (!input.buyerName.trim()) throw new Error("请填写开票抬头");
  // 专票合规校验（《增值税专用发票使用与管理通知》第一条 + 购方六要素）
  if (input.invoiceType === "SPECIAL") {
    if (!input.buyerTaxNo?.trim()) throw new Error("增值税专用发票必须填写纳税人识别号");
    if (!input.buyerAddress?.trim()) throw new Error("增值税专用发票必须填写购方地址");
    if (!input.buyerPhone?.trim()) throw new Error("增值税专用发票必须填写购方电话");
    if (!input.buyerBank?.trim()) throw new Error("增值税专用发票必须填写开户银行");
    if (!input.buyerBankAccount?.trim()) throw new Error("增值税专用发票必须填写银行账号");
  }
  // 关联案件时必须上传开票依据（委托合同等）；无关联案件以原因说明替代，依据可选
  if (input.matterId && (input.evidenceDocIds ?? []).length === 0) {
    throw new Error("请上传至少一份开票依据（扫描版委托合同等）");
  }

  const isSpecial = input.invoiceType === "SPECIAL";
  const approvalMatter = input.matterId ? await prisma.matter.findUniqueOrThrow({ where: { id: input.matterId }, select: { category: true } }) : null;
  await requireApprovalRoute({ action: "INVOICE_APPROVE", category: approvalMatter?.category ?? null, requesterId: session.user.id });
  const evidenceDocIds = input.evidenceDocIds ?? [];
  if (evidenceDocIds.length) {
    // 开票依据是本案合规证据链（须为同案有效材料），仅"本人可读"不够——跨案材料可读不等于可作本案依据
    if (input.matterId) {
      const docs = await prisma.document.findMany({
        where: { id: { in: evidenceDocIds }, matterId: input.matterId, deletedAt: null },
        select: { id: true }
      });
      if (docs.length !== new Set(evidenceDocIds).size) throw new Error("开票依据必须为本案有效材料");
    } else {
      const docs = await prisma.document.findMany({
        where: { id: { in: evidenceDocIds }, deletedAt: null },
        select: { id: true }
      });
      if (docs.length !== new Set(evidenceDocIds).size) throw new Error("开票依据不存在或已删除");
    }
    for (const id of evidenceDocIds) {
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc || !await canReadDocument(session.user.id, doc)) throw new Error("开票依据不存在或无权访问");
    }
  }
  const created = await prisma.invoiceRequest.create({
    data: {
      matterId: input.matterId,
      noMatterReason: input.matterId ? null : input.noMatterReason?.trim() || null,
      amount: input.amount,
      invoiceType: input.invoiceType,
      invoiceItem: input.invoiceItem,
      buyerName: input.buyerName.trim(),
      buyerTaxNo: input.buyerTaxNo?.trim() || null,
      buyerAddress: isSpecial ? input.buyerAddress?.trim() || null : null,
      buyerPhone: isSpecial ? input.buyerPhone?.trim() || null : null,
      buyerBank: isSpecial ? input.buyerBank?.trim() || null : null,
      buyerBankAccount: isSpecial ? input.buyerBankAccount?.trim() || null : null,
      evidenceDocIds: input.evidenceDocIds,
      title: input.buyerName.trim(),
      requestNote: input.requestNote?.trim() || null,
      requestedById: session.user.id
    },
    select: { id: true }
  });

  const matter = input.matterId
    ? await prisma.matter.findUnique({
        where: { id: input.matterId },
        select: { internalCode: true, title: true }
      })
    : null;

  await notifyRoleApprovers({
    roles: ["PRINCIPAL_LAWYER", "FINANCE"],
    excludeUserId: session.user.id,
    title: "新的发票审批待处理",
    content: `${session.user.name ?? "有用户"} 提交了开票申请：${
      matter ? `${matter.internalCode} ${matter.title}` : input.noMatterReason?.trim() || "无关联案件"
    }，金额 ${input.amount.toLocaleString("zh-CN")} 元`,
    href: "/finance",
    refType: "InvoiceRequest",
    refId: created.id,
    priority: "HIGH"
  });

  revalidatePath("/finance");
  revalidatePath("/approvals");
  if (input.matterId) await revalidateMatter(input.matterId);
  return created;
}

/** v0.43 项5：财务页开票弹窗用——搜索当前用户可关联案件（轻量，返回编号+标题） */
export async function searchMattersForInvoice(q?: string) {
  const session = await requireSession("approval");
  return prisma.matter.findMany({
    where: invoiceMatterSearchWhere(session.user.id, q, session.user),
    select: { id: true, internalCode: true, title: true },
    orderBy: { createdAt: "desc" },
    take: invoiceMatterSearchLimit(q)
  });
}

async function withEntryKinds<T extends {id:string}>(rows:T[]) {
  const kinds=rows.length && await financeLedgerReady(prisma) ? await prisma.$queryRaw<{id:string;matterId:string;moneyKind:MoneyKind}[]>(Prisma.sql`SELECT id,"matterId","moneyKind"::text FROM "FeeEntry" WHERE id IN (${Prisma.join(rows.map(r=>r.id))})`) : [];
  const byId=new Map(kinds.map(k=>[k.id,k.moneyKind]));
  const positions=await commissionPositions(prisma,[...new Set(kinds.map(k=>k.matterId))]);
  const byCommission=new Map(positions.map(p=>[p.id,p]));
  return rows.map(r=>({...r,moneyKind:byId.get(r.id),commissionAccrued:byCommission.get(r.id)?.accrued.toNumber(),commissionNetPaid:byCommission.get(r.id)?.netPaid.toNumber(),commissionRecoverable:byCommission.get(r.id)?.recoverable.toNumber()}));
}

export async function listAllFeeEntries(params: {
  type?: "RECEIVABLE" | "RECEIVED" | "REFUND" | "COST" | "COMMISSION";
  limit?: number;
}) {
  const session = await requireSession("finance.read");
  const visFilter = matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const rows = await prisma.feeEntry.findMany({
    where: {
      ...(params.type ? { type: params.type } : {}),
      matter: { deletedAt: null, ...visFilter }
    },
    orderBy: { occurredAt: "desc" },
    take: params.limit ?? 100,
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      beneficiaryUser: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
      confirmedBy: { select: { id: true, name: true } },
      // P0-6 已确认口径（关联已签署合同或已登记发票号），列表展示用
      billing: { select: { signedAt: true } }
    }
  });
  return serializeDecimals(await withEntryKinds(rows));
}

/**
 * 财务页 KPI：本月 / 上月 / 本年实收与应收合计。
 * 必须在库里聚合——从「最近 500 条流水」里累加会在流水超限时少算（2026-09-19 修）。
 * 实收只计已确认到账。
 * confirmedReceiptInvoiceNos 同理：「已开票未收款」的发票号匹配不能依赖会被截断的流水窗口。
 */
export async function getFinanceKpis() {
  const session = await requireSession("finance.read");
  const visFilter = matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const matterWhere = { deletedAt: null, ...visFilter };
  const facts=await getFinanceFacts(matterWhere);
  if(facts) {
    const now=new Date(),month=shMonthStart(now),last=shMonthStart(now,-1),year=shYearStart(now);
    const ar=(start:Date)=>sumAmounts(facts.receivables.filter(r=>r.moneyKind==='LAWYER_FEE'&&r.createdAt>=start).map(r=>({amount:r.effectiveAmount})));
    const pending=facts.pending.filter(p=>p.occurredAt>=month);
    // D 批（2026-09-20）：本期应收核销率＝本期新增律师费应收中已核销额 / 本期新增有效应收额
    // （同批口径：分子分母同为「期内新建单」，旧账回收额不混入分母；当前核销额会随后续核销累加，
    // 属当前口径而非历史时点快照，历史回溯按 v3 §7 统计条另行核对逐次记录）。
    const monthArs=facts.receivables.filter(r=>r.moneyKind==='LAWYER_FEE'&&r.createdAt>=month);
    const monthArTotal=sumAmounts(monthArs.map(r=>({amount:r.effectiveAmount})));
    const monthArSettled=sumAmounts(monthArs.map(r=>({amount:r.settledAmount})));
    const writeOffRate=monthArTotal>0?Math.round(monthArSettled/monthArTotal*1000)/10:null;
    return {ledgerReady:true,monthlyReceived:sumAmounts(periodReceipts(facts,month)),monthlyReceivable:ar(month),lastMonthReceived:sumAmounts(periodReceipts(facts,last,month)),yearlyReceived:sumAmounts(periodReceipts(facts,year)),yearlyReceivable:ar(year),monthConfirmedCount:periodReceipts(facts,month).filter(p=>p.amount.gt(0)).length,monthPendingCount:pending.length,monthPendingAmount:sumAmounts(pending),writeOffRate,confirmedReceiptInvoiceNos:[] as string[]};
  }
  const now = new Date();
  // 上海月界/年界：避免 UTC 部署把月初 0-8 点归错月（与 facts 口径一致）
  const monthStart = shMonthStart();
  const lastMonthStart = shMonthStart(now, -1);
  const yearStart = shYearStart(now);
  const sum = async (type: "RECEIVED" | "RECEIVABLE", gte: Date, lt?: Date) => {
    const res = await prisma.feeEntry.aggregate({
      where: {
        type,
        ...(type === "RECEIVED" ? { confirmState: "CONFIRMED" as const } : {}),
        occurredAt: { gte, ...(lt ? { lt } : {}) },
        matter: matterWhere
      },
      _sum: { amount: true }
    });
    return Number(res._sum.amount ?? 0);
  };
  const countBy = async (confirmState: "CONFIRMED" | "PENDING") =>
    prisma.feeEntry.count({ where: { type: "RECEIVED", confirmState, occurredAt: { gte: monthStart }, matter: matterWhere } });
  const sumPending = async () => {
    const res = await prisma.feeEntry.aggregate({
      where: { type: "RECEIVED", confirmState: "PENDING", occurredAt: { gte: monthStart }, matter: matterWhere },
      _sum: { amount: true }
    });
    return Number(res._sum.amount ?? 0);
  };
  const [monthlyReceived, monthlyReceivable, lastMonthReceived, yearlyReceived, yearlyReceivable, monthConfirmedCount, monthPendingCount, monthPendingAmount, invoiceRows] = await Promise.all([
    sum("RECEIVED", monthStart),
    sum("RECEIVABLE", monthStart),
    sum("RECEIVED", lastMonthStart, monthStart),
    sum("RECEIVED", yearStart),
    sum("RECEIVABLE", yearStart),
    countBy("CONFIRMED"),
    countBy("PENDING"),
    sumPending(),
    prisma.feeEntry.findMany({
      where: { type: "RECEIVED", confirmState: "CONFIRMED", invoiceNo: { not: null }, matter: matterWhere },
      distinct: ["invoiceNo"],
      select: { invoiceNo: true }
    })
  ]);
  return {
    ledgerReady:false,
    monthlyReceived,
    monthlyReceivable,
    lastMonthReceived,
    yearlyReceived,
    yearlyReceivable,
    monthConfirmedCount,
    monthPendingCount,
    monthPendingAmount,
    confirmedReceiptInvoiceNos: invoiceRows.map((r) => r.invoiceNo as string)
  };
}

/** 全部待确认实收（不受流水条数上限影响）：财务页「待确认实收」用 */
export async function listPendingReceipts() {
  const session = await requireSession("finance.read");
  const visFilter = matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const rows = await prisma.feeEntry.findMany({
    where: { type: "RECEIVED", confirmState: "PENDING", matter: { deletedAt: null, ...visFilter } },
    orderBy: { occurredAt: "desc" },
    include: {
      matter: { select: { id: true, internalCode: true, title: true } },
      beneficiaryUser: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
      confirmedBy: { select: { id: true, name: true } },
      billing: { select: { signedAt: true } }
    }
  });
  return serializeDecimals(await withEntryKinds(rows));
}

export async function getMonthlyRevenue(months = 6) {
  const session = await requireSession("finance.read");
  const visFilter = matterFinanceVisibilityFilter(session.user.id, session.user.role, session.user.rolePermissions);
  const facts=await getFinanceFacts({deletedAt:null,...visFilter});
  if(facts)return financeTrend(facts,Math.max(1,Math.min(36,Math.floor(months))));
  const now = new Date();
  const start = shMonthStart(now, -(months - 1));

  const entries = await prisma.feeEntry.findMany({
    where: {
      type: { in: ["RECEIVABLE", "RECEIVED"] },
      confirmState: "CONFIRMED",
      occurredAt: { gte: start },
      matter: { deletedAt: null, ...visFilter }
    },
    select: { type: true, amount: true, occurredAt: true }
  });

  const buckets: { month: string; received: number; receivable: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({
      month: `${d.getMonth() + 1}月`,
      received: 0,
      receivable: 0
    });
  }

  for (const e of entries) {
    const d = new Date(e.occurredAt);
    const idx = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
    if (idx < 0 || idx >= months) continue;
    if (e.type === "RECEIVED") buckets[idx].received += Number(e.amount);
    if (e.type === "RECEIVABLE") buckets[idx].receivable += Number(e.amount);
  }

  return buckets;
}

export async function getPersonalRevenue(userId: string) {
  const session = await requireSession("finance.read");
  if (!isManager(session.user) && session.user.id !== userId) {
    throw new Error("只能查看自己的收入数据");
  }
  const monthStart = shMonthStart(), yearStart = shYearStart();
  if(await financeLedgerReady(prisma)) {
    const [totals]=await prisma.$queryRaw<{monthly:Prisma.Decimal;yearly:Prisma.Decimal}[]>`
      SELECT COALESCE(SUM(amount) FILTER (WHERE occurred>=${monthStart}),0) AS monthly, COALESCE(SUM(amount) FILTER (WHERE occurred>=${yearStart}),0) AS yearly FROM (
        SELECT amount,"occurredAt" AS occurred FROM "FeeEntry" WHERE type='COMMISSION' AND "beneficiaryUserId"=${userId}
        UNION ALL SELECT e.delta AS amount,c."occurredAt" AS occurred FROM "FinanceCorrectionEffect" e JOIN "FinanceCorrection" c ON c.id=e."correctionId" JOIN "FeeEntry" f ON f.id=e."commissionEntryId" WHERE c.status='CONFIRMED' AND f."beneficiaryUserId"=${userId}
      ) movements`;
    return {monthlyCommission:totals.monthly.toNumber(),yearlyCommission:totals.yearly.toNumber()};
  }

  const [monthly, yearly] = await Promise.all([
    prisma.feeEntry.aggregate({
      where: {
        type: "COMMISSION",
        beneficiaryUserId: userId,
        occurredAt: { gte: monthStart }
      },
      _sum: { amount: true }
    }),
    prisma.feeEntry.aggregate({
      where: {
        type: "COMMISSION",
        beneficiaryUserId: userId,
        occurredAt: { gte: yearStart }
      },
      _sum: { amount: true }
    })
  ]);

  return {
    monthlyCommission: Number(monthly._sum.amount ?? 0),
    yearlyCommission: Number(yearly._sum.amount ?? 0)
  };
}
