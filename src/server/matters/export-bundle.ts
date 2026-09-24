/**
 * M-3c（2026-09-20 D 批）：在办案件单案打包导出——把归档 ZIP 的打包能力开放给未归档案件，
 * 满足「律师离所/换系统时数据带得走」（PRD 设计原则 6）。同结构：manifest.json（当次固定清单）
 * + 材料（解密后按类别归目录）+ README。与归档包的区别：这是**当次快照**（非冻结批准件），
 * manifest 记录导出时间与导出人，不含归档号/结案小结；后续变化不影响已导出的包。
 * 权限：与案件列表 xlsx 导出同口径（matters.export 断言在 API 路由层）+ 本案读取。
 */
import PizZip from "pizzip";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer, sha256 } from "@/lib/storage/crypto";
import { readArchiveDocument } from "@/server/archive/verification";
import { ActionError } from "@/lib/action-error";

const CATEGORY_DIR: Record<string, string> = {
  EVIDENCE: "证据",
  PLEADING: "诉讼文书",
  PROCEDURE: "程序文书",
  JUDGMENT: "裁判文书",
  CONTRACT: "合同",
  OTHER: "其他"
};

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim();
}

export async function buildMatterBundle(matterId: string, userId: string): Promise<{ buffer: Buffer; fileName: string; checksum: string; size: number }> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId, deletedAt: null },
    select: { internalCode: true, title: true, status: true, createdAt: true, notes: true }
  });
  if (!matter) throw new ActionError("案件不存在");

  const [documents, notes, tasks, finance] = await Promise.all([
    prisma.document.findMany({
      where: { matterId, deletedAt: null, isLatest: true },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, category: true, mimeType: true, size: true, sha256: true, path: true, encrypted: true, iv: true, authTag: true, createdAt: true }
    }),
    prisma.note.findMany({ where: { matterId, deletedAt: null }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true, channel: true, withWhom: true, content: true, author: { select: { name: true } } } }),
    prisma.task.findMany({ where: { matterId }, orderBy: { createdAt: "asc" }, select: { title: true, dueAt: true, completed: true, priority: true } }),
    prisma.$queryRaw<{ contractTotal: string | null; received: string | null; outstanding: string | null }[]>`
      SELECT
        (SELECT COALESCE(SUM("resultingAmount"),0) FROM "Billing" WHERE "matterId"=${matterId} AND status='ACTIVE' AND "signedAt" IS NOT NULL) AS "contractTotal",
        (SELECT COALESCE(SUM(p.amount-p."refundedAmount"),0) FROM "Payment" p WHERE p."matterId"=${matterId}) AS received,
        (SELECT COALESCE(SUM(r.amount+r."adjustmentAmount"-r."settledAmount"),0) FROM "Receivable" r WHERE r."matterId"=${matterId} AND r.status<>'CANCELLED') AS outstanding`
  ]);

  const zip = new PizZip();
  const root = safeName(matter.internalCode || matter.title);

  const manifest = {
    kind: "matter-live-bundle",
    exportedAt: new Date().toISOString(),
    exportedBy: userId,
    matter: { internalCode: matter.internalCode, title: matter.title, status: matter.status, createdAt: matter.createdAt, notes: matter.notes },
    finance: finance[0] ? { contractTotal: Number(finance[0].contractTotal ?? 0), received: Number(finance[0].received ?? 0), receivableOutstanding: Number(finance[0].outstanding ?? 0) } : null,
    documents: documents.map(d => ({ name: d.name, category: d.category, mimeType: d.mimeType, size: d.size, sha256: d.sha256, createdAt: d.createdAt })),
    notes: notes.map(n => ({ occurredAt: n.occurredAt, channel: n.channel, withWhom: n.withWhom, content: n.content, by: n.author?.name ?? null })),
    tasks: tasks.map(t => ({ title: t.title, dueAt: t.dueAt, completed: t.completed, priority: t.priority }))
  };
  zip.file(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
  zip.file(`${root}/README.md`, [
    `# ${matter.title}`, "",
    `案件编号：${matter.internalCode}  `,
    `状态：${matter.status}  `,
    `导出时间：${manifest.exportedAt}`, "",
    "在办案卷快照（非归档批准件）：", "- `manifest.json` — 案件元数据、材料清单（含 SHA256）、沟通记录、任务与财务摘要",
    "- `材料/` — 全部有效材料（解密后按类别分目录）", "",
    `材料 ${documents.length} 份 · 记录 ${notes.length} 条 · 任务 ${tasks.length} 项`
  ].join("\n"));

  const seqByCategory: Record<string, number> = {};
  for (const d of documents) {
    const dir = CATEGORY_DIR[d.category] ?? "其他";
    const n = (seqByCategory[dir] ?? 0) + 1;
    seqByCategory[dir] = n;
    try {
      const buf = await readArchiveDocument(d as unknown as Parameters<typeof readArchiveDocument>[0]);
      zip.file(`${root}/材料/${dir}/${String(n).padStart(3, "0")}_${safeName(d.name)}`, buf);
    } catch {
      // 单份材料读取失败不阻断整包（如磁盘文件缺失）；manifest 中保留清单可对账
      zip.file(`${root}/材料/${dir}/${String(n).padStart(3, "0")}_${safeName(d.name)}.读取失败.txt`, `材料文件读取失败，请到系统中核对（id=${d.id}，sha256=${d.sha256}）。`);
    }
  }

  const buffer = zip.generate({ type: "nodebuffer" }) as Buffer;
  void storage; void decryptBuffer; void sha256;
  return { buffer, fileName: `${root}-在办卷宗.zip`, checksum: sha256(buffer), size: buffer.length };
}
