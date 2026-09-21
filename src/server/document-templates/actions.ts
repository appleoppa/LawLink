"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSystemAdmin } from "@/lib/auth/session";
import { audit, auditTx } from "@/server/audit";
import { shDayKey } from "@/lib/ui/sh-time";
import { storage } from "@/lib/storage";
import { assertMatterWritable } from "@/lib/archive/guard";
import { assertCanLeadMatter } from "@/lib/permissions";
import { decryptBuffer, encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { buildContext, renderDocxBuffer, detectMissing, extractDocxVariables } from "@/lib/template-engine";
import { suggestFolderByTemplateCategory } from "@/lib/default-folders";
import {
  templateListFilterSchema,
  templateToggleSchema,
  templateRenderSchema
} from "./schemas";
import { revalidateMatter } from "@/server/matters/route";
import { ActionError } from "@/lib/action-error";

export async function listTemplates(input?: z.input<typeof templateListFilterSchema>) {
  await requireSession("personal");
  const filter = templateListFilterSchema.parse(input ?? {});

  const where: Prisma.DocumentTemplateWhereInput = {};
  if (filter.onlyEnabled) where.enabled = true;
  if (filter.category) where.category = filter.category;
  if (filter.matterCategory) {
    // applicableCategories 为空数组 = 全适用；包含目标也匹配
    where.OR = [
      { applicableCategories: { isEmpty: true } },
      { applicableCategories: { has: filter.matterCategory } }
    ];
  }

  return prisma.documentTemplate.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      description: true,
      applicableCategories: true,
      variables: true,
      isBuiltIn: true,
      enabled: true,
      updatedAt: true
    }
  });
}

export async function getTemplate(id: string) {
  await requireSession("personal");
  return prisma.documentTemplate.findUnique({
    where: { id },
    include: {
      docxBlob: { select: { id: true, name: true, size: true } },
      createdBy: { select: { id: true, name: true } }
    }
  });
}

export async function toggleTemplate(input: z.infer<typeof templateToggleSchema>) {
  const session = await requireSystemAdmin();
  const data = templateToggleSchema.parse(input);

  await prisma.documentTemplate.update({
    where: { id: data.id },
    data: { enabled: data.enabled }
  });

  await audit({
    userId: session.user.id,
    action: "TEMPLATE_TOGGLE",
    targetType: "DocumentTemplate",
    targetId: data.id,
    detail: { enabled: data.enabled }
  });

  revalidatePath("/admin/templates");
  revalidatePath("/admin/templates");
  return { ok: true };
}

/**
 * 模板渲染 + 归档
 *   1. 校验输入与权限
 *   2. 读取并解密模板 docx
 *   3. 拼装上下文（含行内补全 overrides 的回写）
 *   4. 渲染 → 加密入库 Document（关联 matter / folder / template / 上下文快照）
 *   5. 返回新 documentId，UI 拿去下载
 */
export async function renderTemplate(input: z.infer<typeof templateRenderSchema>) {
  const session = await requireSession("documents.write");
  const data = templateRenderSchema.parse(input);

  await assertMatterWritable(data.matterId);
  await assertCanLeadMatter(session.user.id, data.matterId, "仅案件主办/协办可生成文书");

  // 取模板 + docxBlob
  const tmpl = await prisma.documentTemplate.findUnique({
    where: { id: data.templateId },
    include: { docxBlob: true }
  });
  if (!tmpl || !tmpl.enabled) throw new ActionError("模板不存在或已禁用");
  if (!tmpl.docxBlob) throw new ActionError("模板源文件缺失");

  // 校验 folder 同案件
  if (data.folderId) {
    const folder = await prisma.documentFolder.findUnique({
      where: { id: data.folderId },
      select: { matterId: true }
    });
    if (!folder || folder.matterId !== data.matterId) {
      throw new ActionError("目标卷宗与案件不匹配");
    }
  }

  // 取案件 + 模板源文件
  const matter = await prisma.matter.findUnique({
    where: { id: data.matterId },
    select: { internalCode: true, category: true }
  });
  if (!matter) throw new ActionError("案件不存在");

  const rawCt = await storage.readFile(tmpl.docxBlob.path);
  const templateBuffer = tmpl.docxBlob.encrypted
    ? decryptBuffer(rawCt, tmpl.docxBlob.iv ?? "", tmpl.docxBlob.authTag ?? "")
    : rawCt;

  // 上下文（应用 overrides 行内补全）
  const context = await buildContext({
    matterId: data.matterId,
    userId: session.user.id,
    overrides: data.overrides
  });

  // 检测未填变量（行内补全已落库 → buildContext 会读到；剩下的是真缺）
  const required = Array.isArray(tmpl.variables) ? (tmpl.variables as string[]) : [];
  const missing = detectMissing(required, context);

  // 渲染
  const renderedBuf = renderDocxBuffer(templateBuffer, context);
  const enc = encryptBuffer(renderedBuf);
  const path = await storage.writeFile(`m_${data.matterId}`, enc.ciphertext);

  // 若未指定 folder，按模板大类推荐
  let folderId = data.folderId;
  if (!folderId) {
    const suggestedName = suggestFolderByTemplateCategory(tmpl.category, matter.category);
    if (suggestedName) {
      const f = await prisma.documentFolder.findFirst({
        where: { matterId: data.matterId, name: suggestedName },
        select: { id: true }
      });
      if (f) folderId = f.id;
    }
  }

  const today = shDayKey(new Date());
  const fileName = `${tmpl.name}_${matter.internalCode}_${today}.docx`;

  const doc = await prisma.document.create({
    data: {
      matterId: data.matterId,
      folderId: folderId ?? undefined,
      templateId: tmpl.id,
      templateContextSnapshot: context as unknown as Prisma.InputJsonValue,
      name: fileName,
      category: "OTHER",
      path,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: renderedBuf.length,
      sha256: sha256(renderedBuf),
      encrypted: true,
      algorithm: enc.algorithm,
      iv: enc.iv.toString("base64"),
      authTag: enc.authTag.toString("base64"),
      tags: ["模板生成", tmpl.name],
      uploadedById: session.user.id
    }
  });

  await audit({
    userId: session.user.id,
    action: "TEMPLATE_RENDER",
    targetType: "Document",
    targetId: doc.id,
    detail: { templateId: tmpl.id, templateName: tmpl.name, matterId: data.matterId }
  });

  await revalidateMatter(data.matterId);
  return { ok: true, documentId: doc.id, fileName, missing };
}

/* ---------- v1.x 收尾：律师自定义文书模板上传（v5 §4.4 挂账清偿） ---------- */

const uploadTemplateSchema = z.object({
  name: z.string().min(1, "模板名称必填").max(80),
  category: z.enum([
    "INTAKE", "RETAINER", "LITIGATION", "HEARING",
    "WORK_PRODUCT", "ARCHIVE", "CLOSING", "BLANK"
  ]),
  description: z.string().max(300).optional().or(z.literal("")),
  applicableCategories: z.array(z.enum([
    "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL",
    "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"
  ])).default([]),
  extraVariables: z.array(z.string().regex(/^[A-Za-z_$][\w$.]*$/, "变量须为点分路径，如 client.name")).default([])
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024;

/**
 * 上传自定义 docx 模板。文件加密落 storage，元数据与 blob Document 同事务创建；
 * 变量清单自动提取（页眉页脚一并扫描），手工补充变量兜底拆分 run 漏检。
 */
export async function uploadDocumentTemplate(formData: FormData) {
  const session = await requireSystemAdmin();
  const data = uploadTemplateSchema.parse({
    name: formData.get("name"),
    category: formData.get("category"),
    description: formData.get("description") || undefined,
    applicableCategories: String(formData.get("applicableCategories") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    extraVariables: String(formData.get("extraVariables") ?? "").split(/[，,]/).map(s => s.trim()).filter(Boolean)
  });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ActionError("请选择 docx 模板文件");
  if (file.size > MAX_TEMPLATE_SIZE) throw new ActionError("模板文件不得超过 10MB");
  const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx");
  if (!isDocx) throw new ActionError("仅支持 .docx 模板文件");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 2).toString("latin1") !== "PK") throw new ActionError("文件不是有效的 docx（ZIP 头缺失）");

  const variables = [...new Set([...extractDocxVariables(buffer), ...data.extraVariables])].sort();

  const enc = encryptBuffer(buffer);
  const created = await prisma.$transaction(async tx => {
    const path = await storage.writeFile("templates", enc.ciphertext);
    const tmpl = await tx.documentTemplate.create({
      data: {
        name: data.name,
        category: data.category,
        description: data.description || null,
        applicableCategories: data.applicableCategories,
        variables,
        isBuiltIn: false,
        createdBy: { connect: { id: session.user.id } },
        docxBlob: {
          create: {
            name: file.name,
            mimeType: DOCX_MIME,
            size: file.size ?? buffer.length,
            path,
            encrypted: true,
            iv: enc.iv.toString("base64"),
            authTag: enc.authTag.toString("base64"),
            uploadedById: session.user.id,
            sourceOrigin: "TEAM_PRODUCED" as const
          }
        }
      },
      select: { id: true }
    });
    await auditTx(tx, {
      userId: session.user.id,
      action: "TEMPLATE_UPLOAD",
      targetType: "DocumentTemplate",
      targetId: tmpl.id,
      detail: {
        name: data.name,
        category: data.category,
        fileName: file.name,
        fileSize: file.size,
        extractedVariableCount: variables.length
      }
    });
    return tmpl;
  });

  revalidatePath("/admin/document-templates");
  return { ok: true as const, id: created.id, variableCount: variables.length };
}

/** 管理后台列表（含停用；带创建人与文件信息） */
export async function listTemplatesForAdmin() {
  await requireSystemAdmin();
  return prisma.documentTemplate.findMany({
    orderBy: [{ isBuiltIn: "asc" }, { category: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true, name: true, category: true, description: true,
      applicableCategories: true, variables: true, isBuiltIn: true, enabled: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
      docxBlob: { select: { name: true, size: true } }
    }
  });
}
