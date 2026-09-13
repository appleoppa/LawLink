"use server";

/**
 * 客户查重与合并服务动作（报告 P0-1）。
 *
 * - checkClientDuplicate：三入口（建档/编辑/导入）统一查重——证件精确命中
 *   （含软删，身份持续唯一）+ 同名未删提示疑似；
 * - mergeClients：存量重复档案合并——只调整当前主体关联（联系人、收案、
 *   案件客户关联、主办客户指向），不改写历史冲突核查/审批/委托/正式成果
 *   中的身份快照；被合并档案软删并在审计中保留映射与依据。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";
import { auditTx } from "@/server/audit";
import {
  normalizeIdNumber,
  duplicateWhereInput,
  nameWhereInput,
  type ClientDuplicateCheck
} from "@/lib/clients/identity";
import type { ClientIdType } from "@prisma/client";
import { z } from "zod";

const candidateSelect = {
  id: true,
  name: true,
  type: true,
  internalCode: true,
  deletedAt: true
} as const;

export async function checkClientDuplicate(input: {
  idType?: ClientIdType | string | null;
  idNumber?: string | null;
  name?: string;
  excludeId?: string;
}): Promise<ClientDuplicateCheck> {
  await requireSession("clients.write");
  const idType = (input.idType || null) as ClientIdType | null;
  const idNumber = normalizeIdNumber(input.idNumber);

  if (!idType || !idNumber) {
    // 未提供证件信息：仅做同名提示
    const nameDuplicates = input.name
      ? await prisma.client.findMany({ where: nameWhereInput({ name: input.name, excludeId: input.excludeId }), select: candidateSelect })
      : [];
    return { idNumberDuplicate: null, nameDuplicates };
  }

  const [exact, names] = await Promise.all([
    prisma.client.findFirst({
      where: duplicateWhereInput({ idType, idNumber, excludeId: input.excludeId }),
      select: candidateSelect,
      orderBy: { deletedAt: { sort: "asc", nulls: "last" } }
    }),
    input.name
      ? prisma.client.findMany({ where: nameWhereInput({ name: input.name, excludeId: input.excludeId }), select: candidateSelect })
      : Promise.resolve([])
  ]);
  return { idNumberDuplicate: exact, nameDuplicates: names };
}

const mergeSchema = z.object({
  keepId: z.string().cuid(),
  mergeId: z.string().cuid(),
  basis: z.string().min(1, "请填写合并依据").max(200)
}).refine(v => v.keepId !== v.mergeId, { message: "不能与自身合并" });

/** 按客户编号（KH-…）发起合并（页面入口用；编号解析后走 mergeClients 同一事务） */
export async function mergeClientsByCode(input: {
  keepId: string;
  mergeCode: string;
  basis: string;
}) {
  const code = input.mergeCode.trim();
  const target = await prisma.client.findFirst({
    where: { internalCode: code, deletedAt: null },
    select: { id: true, name: true }
  });
  if (!target) throw new Error(`未找到编号为 ${code} 的有效客户`);
  if (target.id === input.keepId) throw new Error("不能与自身合并");
  return mergeClients({ keepId: input.keepId, mergeId: target.id, basis: input.basis });
}

export async function mergeClients(input: z.infer<typeof mergeSchema>) {
  const session = await requireSession("clients.write");
  if (session.user.role !== "CUSTOM" && !isManager(session.user.role)) {
    throw new Error("仅管理员可合并客户档案");
  }
  const data = mergeSchema.parse(input);

  const result = await prisma.$transaction(async tx => {
    const [keep, merge] = await Promise.all([
      tx.client.findUnique({ where: { id: data.keepId }, select: { id: true, name: true, deletedAt: true } }),
      tx.client.findUnique({ where: { id: data.mergeId }, select: { id: true, name: true, deletedAt: true, internalCode: true } })
    ]);
    if (!keep || keep.deletedAt) throw new Error("保留的客户不存在或已删除");
    if (!merge || merge.deletedAt) throw new Error("被合并的客户不存在或已删除");

    // 1. 联系人迁移
    await tx.contact.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });

    // 2. 收案归属迁移
    await tx.intake.updateMany({ where: { clientId: merge.id }, data: { clientId: keep.id } });

    // 3. 案件-客户关联：跳过已存在关联（matterId+clientId 复合主键），其余迁移
    const links = await tx.matterClient.findMany({ where: { clientId: merge.id }, select: { matterId: true } });
    for (const link of links) {
      const exists = await tx.matterClient.findUnique({
        where: { matterId_clientId: { matterId: link.matterId, clientId: keep.id } }
      });
      if (!exists) {
        await tx.matterClient.update({
          where: { matterId_clientId: { matterId: link.matterId, clientId: merge.id } },
          data: { clientId: keep.id }
        });
      }
    }

    // 4. 主办客户指向迁移
    await tx.matter.updateMany({ where: { primaryClientId: merge.id }, data: { primaryClientId: keep.id } });

    // 5. 被合并档案软删 + 名称标注（保留可读的合并痕迹；身份仍被占用）
    await tx.client.update({
      where: { id: merge.id },
      data: {
        deletedAt: new Date(),
        name: `${merge.name}（已并入 ${keep.name}）`
      }
    });

    // 6. 关键动作审计：同事务记录映射与依据（P0-7）
    await auditTx(tx, {
      userId: session.user.id,
      action: "CLIENT_MERGE",
      targetType: "Client",
      targetId: keep.id,
      detail: {
        keptId: keep.id,
        mergedId: merge.id,
        mergedInternalCode: merge.internalCode,
        basis: data.basis
      }
    });

    return { keptId: keep.id, mergedId: merge.id };
  });

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/clients");
  return { ok: true, ...result };
}
