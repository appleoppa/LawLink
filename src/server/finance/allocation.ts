"use server";
import {insertFinanceRowTx} from "@/server/finance/allocation-internals";

/**
 * 财务核销服务层（P1 §二）。
 *
 * 口径：Billing 签署 → 生成应收；收款确认（FeeEntry RECEIVED 确认时）→ 生成实收；
 * 一次实收可核销多项应收 / 一项应收可分次收清；已确认记录更正走带原因的
 * FinanceCorrection（P0 守卫已禁物理删除，本层提供记录 + 事务审计）。
 * FeeEntry 保留为流水台账，核销余额以本组表为准（报表口径切换随 UI 批次）。
 * 事务内 helper（generateReceivableForBilling 等）在 allocation-internals.ts，不进 RPC 面。
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { auditTx } from "@/server/audit";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanAccessMatterFinance } from "@/lib/permissions";
import { financeLedgerReady } from "./ledger-storage";
import { allocateLedger } from "./ledger-actions";

const allocateSchema = z.object({
  paymentId: z.string().cuid(),
  revision: z.number().int().nonnegative().optional(),
  items: z
    .array(
      z.object({
        receivableId: z.string().cuid(),
        amount: z.coerce.number().positive()
      })
    )
    .min(1, "至少核销一项应收")
});

/**
 * 核销：一次实收分配到多项应收。事务内校验——
 * 分配合计 ≤ 实收未核销余额；每项分配 ≤ 应收未核销余额；
 * 冲突（P2034/P2025）转中文提示。
 */
export async function allocatePayment(input: z.infer<typeof allocateSchema>) {
  const session = await requireSession("finance.write");
  const data = allocateSchema.parse(input);
  if (await financeLedgerReady(prisma)) {
    if (data.revision === undefined) throw new Error("请从账务核对与分配页面刷新实收版本后操作");
    return allocateLedger({ paymentId: data.paymentId, revision: data.revision, kind: "RECEIVABLE", items: data.items.map(i => ({ targetId: i.receivableId, amount: i.amount })) });
  }

  try {
    // Serializable：无锁的 check-then-write 在并发下会把实收/应收推过余额上限（ReadCommitted 下两个事务都能通过余量检查）；
    // 冲突事务以 P2034 失败并转中文提示重试。新账本路径（allocateLedgerTx）本身 Serializable+行锁，不受影响。
    return await prisma.$transaction(async tx => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: data.paymentId },
        select: { matterId: true, amount: true, allocatedAmount: true, status: true }
      });
      if (payment.status === "FULLY_ALLOCATED") throw new Error("该笔实收已全额核销");
      await assertMatterWritable(payment.matterId, { allowFinanceRole: true });

      const remaining = payment.amount.minus(payment.allocatedAmount);
      const total = data.items.reduce((s, i) => s + i.amount, 0);
      if (total > remaining.toNumber() + 1e-9) {
        throw new Error(`核销合计 ${total.toFixed(2)} 超过该笔实收未核销余额 ${remaining.toNumber().toFixed(2)}`);
      }

      for (const item of data.items) {
        const ar = await tx.receivable.findUniqueOrThrow({
          where: { id: item.receivableId },
          select: { matterId: true, title: true, amount: true, settledAmount: true, status: true }
        });
        if (ar.matterId !== payment.matterId) throw new Error("应收与实收不属于同一案件");
        if (ar.status === "CANCELLED") throw new Error(`应收「${ar.title}」已作废，不可核销`);
        const arRemaining = ar.amount.minus(ar.settledAmount).toNumber();
        if (item.amount > arRemaining + 1e-9) {
          throw new Error(`「${ar.title}」核销 ${item.amount.toFixed(2)} 超过其未核销余额 ${arRemaining.toFixed(2)}`);
        }
      }

      for (const item of data.items) {
        const amount = new Prisma.Decimal(item.amount.toFixed(2));
        await tx.allocation.create({
          data: {
            paymentId: data.paymentId,
            receivableId: item.receivableId,
            amount,
            allocatedById: session.user.id
          }
        });
        const ar = await tx.receivable.update({
          where: { id: item.receivableId },
          data: { settledAmount: { increment: amount } },
          select: { amount: true, settledAmount: true }
        });
        await tx.receivable.update({
          where: { id: item.receivableId },
          data: { status: ar.settledAmount.gte(ar.amount) ? "SETTLED" : "OPEN" }
        });
      }

      const after = await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          allocatedAmount: { increment: new Prisma.Decimal(total.toFixed(2)) },
          status: "PARTIAL" as const
        },
        select: { amount: true, allocatedAmount: true }
      });
      await tx.payment.update({
        where: { id: data.paymentId },
        data: { status: after.allocatedAmount.gte(after.amount) ? "FULLY_ALLOCATED" : "PARTIAL" }
      });

      await auditTx(tx, {
        userId: session.user.id,
        action: "FINANCE_ALLOCATION",
        targetType: "Payment",
        targetId: data.paymentId,
        detail: { items: data.items, matterId: payment.matterId }
      });
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2025"].includes(err.code)) {
      throw new Error("实收或应收状态已变化，请刷新后重新核销");
    }
    throw err;
  }
}

const correctionSchema = z.object({
  targetType: z.enum(["FeeEntry", "Payment", "Receivable"]),
  targetId: z.string().cuid(),
  type: z.enum(["REFUND", "DISCOUNT", "REVERSAL"]),
  amount: z.coerce.number().positive(),
  reason: z.string().min(1, "请填写更正原因").max(300),
  relatedDocNo: z.string().max(80).optional().or(z.literal(""))
});

/** 冲正/更正记录：带原因与凭证号，同事务审计（替代物理删除的正式更正口径） */
export async function recordFinanceCorrection(input: z.infer<typeof correctionSchema>) {
  const session = await requireSession("finance.write");
  const data = correctionSchema.parse(input);
  if (await financeLedgerReady(prisma)) throw new Error("请到“应收与收款分配”的退款与账务更正区提交申请，旧入口不直接更改余额");

  return prisma.$transaction(async tx => {
    // 冲正必须挂在真实存在的记录上，否则只产出一行悬空审计与更正流水
    const targetExists =
      data.targetType === "FeeEntry"
        ? await tx.feeEntry.findUnique({ where: { id: data.targetId }, select: { id: true, matterId: true } })
        : data.targetType === "Payment"
          ? await tx.payment.findUnique({ where: { id: data.targetId }, select: { id: true, matterId: true } })
          : await tx.receivable.findUnique({ where: { id: data.targetId }, select: { id: true, matterId: true } });
    if (!targetExists) throw new Error("更正对象不存在或已删除，请刷新后重试");
    await assertMatterWritable(targetExists.matterId, { allowFinanceRole: true });

    const created = await insertFinanceRowTx(tx,'FinanceCorrection',{
        targetType: data.targetType,
        targetId: data.targetId,
        type: data.type,
        amount: new Prisma.Decimal(data.amount.toFixed(2)),
        reason: data.reason,
        relatedDocNo: data.relatedDocNo || null,
        createdById: session.user.id
      });
    await auditTx(tx, {
      userId: session.user.id,
      action: "FINANCE_CORRECTION",
      targetType: data.targetType,
      targetId: data.targetId,
      detail: { correctionId: created.id, type: data.type, amount: data.amount, reason: data.reason }
    });
    return { ok: true as const, id: created.id };
  });
}

/** 案件核销概览（UI 批次用）：应收未核销余额 / 未分配实收 */
export async function getMatterAllocationSummary(matterId: string) {
  const session = await requireSession("finance.read");
  // requireSession 对内置角色不设门禁，必须落到案件级授权，否则任意账号可直传 matterId 查他人收付
  await assertCanAccessMatterFinance(session.user.id, session.user.role, matterId, session.user.rolePermissions);
  const [receivables, payments] = await Promise.all([
    prisma.receivable.findMany({
      where: { matterId, status: { in: ["OPEN", "SETTLED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, amount: true, settledAmount: true, status: true, dueDate: true, billingId: true }
    }),
    prisma.payment.findMany({
      where: { matterId },
      orderBy: { occurredAt: "asc" },
      select: { id: true, amount: true, allocatedAmount: true, status: true, occurredAt: true, feeEntryId: true }
    })
  ]);
  const outstanding = receivables.reduce(
    (s, r) => s.plus(r.amount.minus(r.settledAmount)), new Prisma.Decimal(0)
  );
  const unallocated = payments.reduce(
    (s, p) => s.plus(p.amount.minus(p.allocatedAmount)), new Prisma.Decimal(0)
  );
  return { receivables, payments, outstanding, unallocated };
}
