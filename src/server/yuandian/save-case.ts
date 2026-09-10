"use server";

/**
 * v0.20: 把检索到的元典类案保存为案件 Document（category=JUDGMENT）
 *
 * 跳过 uploadDocument 的 file validation —— 这是 LawLink 内部生成的 md 文本，
 * 不走"用户上传"路径。
 */
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCanAccessMatter } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { sha256 } from "@/lib/storage/crypto";
import { audit } from "@/server/audit";
import type { CaseSearchHit, VectorCaseHit } from "./cases";
import { revalidateMatter } from "@/server/matters/route";

export type SaveCaseInput = {
  matterId: string;
  caseHit: Pick<
    CaseSearchHit,
    | "id"
    | "ah"
    | "title"
    | "ay"
    | "jbdw"
    | "cprq"
    | "ajlb"
    | "xzqh_p"
    | "wszl"
    | "content"
    | "detailUrl"
  >;
};

function safeFileName(ah: string): string {
  // 案号含特殊字符（）等，做最小清理用于文件名
  return ah.replace(/[\\/:*?"<>|]/g, "").slice(0, 80);
}

function buildMarkdown(c: SaveCaseInput["caseHit"]): string {
  const now = new Date().toLocaleString("zh-CN");
  return [
    `# 类案存档：${c.title}`,
    "",
    `- **案号**：${c.ah}`,
    `- **法院**：${c.jbdw}`,
    `- **裁判日期**：${c.cprq}`,
    `- **案由**：${c.ay.join("、")}`,
    `- **案件类别**：${c.ajlb}`,
    `- **地区**：${c.xzqh_p}`,
    `- **文书种类**：${c.wszl}`,
    `- **元典链接**：${c.detailUrl}`,
    `- **保存时间**：${now}`,
    "",
    "---",
    "",
    c.content || "（无内容片段）"
  ].join("\n");
}

export async function saveCaseToMatter(input: SaveCaseInput): Promise<{
  ok: true;
  documentId: string;
  documentName: string;
}> {
  const session = await requireSession();
  await assertCanAccessMatter(session.user.id, session.user.role, input.matterId);

  const matter = await prisma.matter.findUnique({
    where: { id: input.matterId, deletedAt: null },
    select: { id: true, status: true }
  });
  if (!matter) throw new Error("案件不存在");
  if (matter.status === "ARCHIVED") {
    throw new Error("案件已归档（只读），不能再保存类案");
  }

  const md = buildMarkdown(input.caseHit);
  const buf = Buffer.from(md, "utf-8");
  const path = await storage.writeFile(`m_${input.matterId}`, buf);
  const hash = sha256(buf);
  const docName = `类案_${safeFileName(input.caseHit.ah)}.md`;

  const doc = await prisma.document.create({
    data: {
      matterId: input.matterId,
      uploadedById: session.user.id,
      name: docName,
      category: "JUDGMENT",
      path,
      mimeType: "text/markdown",
      size: buf.byteLength,
      sha256: hash,
      encrypted: false,
      tags: ["类案", "元典"]
    },
    select: { id: true, name: true }
  });

  await audit({
    userId: session.user.id,
    action: "YUANDIAN_CASE_SAVE",
    targetType: "Matter",
    targetId: input.matterId,
    detail: {
      caseId: input.caseHit.id,
      ah: input.caseHit.ah,
      documentId: doc.id
    }
  });

  await revalidateMatter(input.matterId);

  return { ok: true, documentId: doc.id, documentName: doc.name };
}

// ============================================================
// v0.22: 语义检索结果存档（vector 路径，字段映射不同）
// ============================================================

export type SaveVectorCaseInput = {
  matterId: string;
  caseHit: Pick<
    VectorCaseHit,
    | "scid"
    | "ah"
    | "title"
    | "ay"
    | "anyou"
    | "jbdw"
    | "jaDate"
    | "ajlb"
    | "xzqh_p"
    | "wszl"
    | "content"
    | "detailUrl"
    | "score"
  >;
};

function formatJaDate(n: number | undefined | null): string {
  if (!n) return "未知";
  const s = String(n);
  if (s.length !== 8) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function buildVectorMarkdown(c: SaveVectorCaseInput["caseHit"]): string {
  const now = new Date().toLocaleString("zh-CN");
  // 案由：优先 anyou（名字），否则 ay code 兜底
  const ay =
    (c.anyou && c.anyou.length ? c.anyou : c.ay)?.join("、") || "（无案由信息）";
  return [
    `# 类案存档（语义检索）：${c.title}`,
    "",
    `- **案号**：${c.ah || "—"}`,
    `- **法院**：${c.jbdw || "—"}`,
    `- **裁判日期**：${formatJaDate(c.jaDate)}`,
    `- **案由**：${ay}`,
    `- **案件类别**：${c.ajlb}`,
    `- **地区**：${c.xzqh_p}`,
    `- **文书种类**：${c.wszl}`,
    `- **相似度评分**：${c.score.toFixed(4)}`,
    `- **元典链接**：${c.detailUrl}`,
    `- **保存时间**：${now}`,
    "",
    "---",
    "",
    c.content || "（无内容片段）"
  ].join("\n");
}

export async function saveVectorCaseToMatter(input: SaveVectorCaseInput): Promise<{
  ok: true;
  documentId: string;
  documentName: string;
}> {
  const session = await requireSession();
  await assertCanAccessMatter(session.user.id, session.user.role, input.matterId);

  const matter = await prisma.matter.findUnique({
    where: { id: input.matterId, deletedAt: null },
    select: { id: true, status: true }
  });
  if (!matter) throw new Error("案件不存在");
  if (matter.status === "ARCHIVED") {
    throw new Error("案件已归档（只读），不能再保存类案");
  }

  const md = buildVectorMarkdown(input.caseHit);
  const buf = Buffer.from(md, "utf-8");
  const path = await storage.writeFile(`m_${input.matterId}`, buf);
  const hash = sha256(buf);
  // 案号缺失时用 scid 兜底（vector 来的某些案例 ah 可能为空）
  const tag = input.caseHit.ah?.trim() || input.caseHit.scid.slice(0, 12);
  const docName = `类案_${safeFileName(tag)}.md`;

  const doc = await prisma.document.create({
    data: {
      matterId: input.matterId,
      uploadedById: session.user.id,
      name: docName,
      category: "JUDGMENT",
      path,
      mimeType: "text/markdown",
      size: buf.byteLength,
      sha256: hash,
      encrypted: false,
      tags: ["类案", "元典", "语义"]
    },
    select: { id: true, name: true }
  });

  await audit({
    userId: session.user.id,
    action: "YUANDIAN_CASE_SAVE_VECTOR",
    targetType: "Matter",
    targetId: input.matterId,
    detail: {
      scid: input.caseHit.scid,
      ah: input.caseHit.ah,
      score: input.caseHit.score,
      documentId: doc.id
    }
  });

  await revalidateMatter(input.matterId);

  return { ok: true, documentId: doc.id, documentName: doc.name };
}
