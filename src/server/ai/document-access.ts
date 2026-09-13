"use server";

/**
 * AI 入口的文档归属断言（v1.x 安全核验修复，对应报告 P0 第 4 项 / 证据 C07）。
 *
 * 背景：reviewDocument 会把库内文档全文发送到外部 AI 服务，此前仅当
 * doc.matterId 存在时执行案件级访问断言；收案材料（intakeId）分支没有
 * 对象级校验，任何持 documents.write 的账号凭 documentId 即可对他人
 * 收案材料发起审查，且此类外发不写审查历史。同一份材料的上传路径
 * （documents/actions.ts）有明确的收案归属校验——审查入口遗漏属实现
 * 遗漏，此处补齐同一口径：
 *   - matterId 存在 → assertCanAccessMatter；
 *   - 否则 intakeId 存在 → 创建人 / 主办 / 协办 / 管理岗可访问（与上传一致）；
 *   - 两者皆无 → 拒绝（防御无归属数据）。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanAccessMatter, isManager } from "@/lib/permissions";

type AppSession = Awaited<ReturnType<typeof requireSession>>;

export async function assertCanReviewDocument(
  session: AppSession,
  doc: { matterId: string | null; intakeId: string | null }
): Promise<void> {
  if (doc.matterId) {
    await assertCanAccessMatter(
      session.user.id,
      session.user.role,
      doc.matterId,
      session.user.rolePermissions
    );
    return;
  }

  if (doc.intakeId) {
    const intake = await prisma.intake.findUnique({
      where: { id: doc.intakeId },
      select: { createdById: true, ownerUserId: true, coUserIds: true }
    });
    if (!intake) throw new Error("所属收案不存在");
    const uid = session.user.id;
    if (
      !isManager(session.user.role) &&
      intake.createdById !== uid &&
      intake.ownerUserId !== uid &&
      !intake.coUserIds.includes(uid)
    ) {
      throw new Error("无权审查该收案的材料");
    }
    return;
  }

  throw new Error("该材料未关联案件或收案，无法发起审查");
}
