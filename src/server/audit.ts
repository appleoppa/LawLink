import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type AuditParams = {
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

/**
 * 写一条审计日志。失败不抛错（业务流程不应被审计失败阻塞）。
 *
 * 用法：
 *   await audit({ userId, action: "CLIENT_CREATE", targetType: "Client", targetId, detail })
 */
export async function audit(params: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        detail: params.detail as object | undefined,
        ip: params.ip,
        userAgent: params.userAgent
      }
    });
  } catch (err) {
    console.error("[audit] 写入失败：", err);
    // 降级：打印到 stderr 以便外部日志采集（systemd/journald/launchd）
    console.error(`[audit] 降级日志: action=${params.action} targetType=${params.targetType ?? "-"} targetId=${params.targetId ?? "-"}`);
    // TODO: 后续接入指标打点（如 Prometheus counter）
  }
}

/**
 * 关键"读取类"动作的严格审计（报告 P0-7）。
 *
 * 与 auditTx 的区别：不处于业务变更事务中，用于证件明文查看等
 * "读敏感数据 + 必须留痕"的入口——审计写入失败时抛错，
 * 调用方据此不返回敏感内容（审计失败 ≠ 操作成功）。
 */
export async function auditStrict(params: AuditParams) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail as object | undefined,
      ip: params.ip,
      userAgent: params.userAgent
    }
  });
}

/**
 * 关键动作审计：与业务变更同一事务提交（报告 P0-7）。
 *
 * 适用范围：权限/角色变更、审批处理、已确认财务记录更正等关键动作——
 * 这些操作的审计失败不得仍返回业务成功（否则出现"操作成功但无审计记录"
 * 的不可核验状态）。接收 Prisma 事务客户端，写入失败抛错使整个事务回滚。
 *
 * 普通运行日志仍走 audit()（吞错），两者职责分离。
 */
export async function auditTx(
  tx: Prisma.TransactionClient,
  params: AuditParams
) {
  await tx.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail as object | undefined,
      ip: params.ip,
      userAgent: params.userAgent
    }
  });
}
