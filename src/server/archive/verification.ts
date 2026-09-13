import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { decryptBuffer, sha256 } from "@/lib/storage/crypto";
import {
  archiveSnapshotDocumentIds,
  parseArchiveSnapshot,
  type ArchiveDocumentSnapshot,
  type ArchiveReviewSnapshot
} from "@/lib/archive/snapshot";

type StoredArchiveDocument = {
  id: string;
  matterId: string | null;
  name: string;
  category: string;
  status: string;
  version: number;
  isLatest: boolean;
  path: string;
  mimeType: string | null;
  size: number | null;
  sha256: string | null;
  encrypted: boolean;
  iv: string | null;
  authTag: string | null;
  deletedAt: Date | null;
  folder: { name: string } | null;
};

export async function readArchiveDocument(doc: StoredArchiveDocument): Promise<Buffer> {
  const stored = await storage.readFile(doc.path);
  if (!doc.encrypted) return stored;
  if (!doc.iv || !doc.authTag) throw new Error(`材料“${doc.name}”的加密元数据损坏`);
  return decryptBuffer(stored, doc.iv, doc.authTag);
}

export async function createArchiveDocumentSnapshots(input: {
  matterId: string;
  orderedDocumentIds: string[];
  itemIdsByDocumentId: Map<string, string[]>;
}): Promise<ArchiveDocumentSnapshot[]> {
  const uniqueIds = [...new Set(input.orderedDocumentIds)];
  if (!uniqueIds.length) return [];
  const rows = await prisma.document.findMany({
    where: { id: { in: uniqueIds }, matterId: input.matterId, deletedAt: null },
    select: {
      id: true, matterId: true, name: true, category: true, status: true, version: true, isLatest: true, path: true, mimeType: true,
      size: true, sha256: true, encrypted: true, iv: true, authTag: true, deletedAt: true,
      folder: { select: { name: true } }
    }
  });
  if (rows.length !== uniqueIds.length) throw new Error("部分归档材料不存在、已删除或不属于本案");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Promise.all(uniqueIds.map(async (id, index) => {
    const doc = byId.get(id)!;
    const buffer = await readArchiveDocument(doc);
    const contentHash = sha256(buffer);
    if (doc.sha256 && doc.sha256 !== contentHash) {
      throw new Error(`材料“${doc.name}”的内容与登记校验值不一致`);
    }
    return {
      id: doc.id,
      name: doc.name,
      category: doc.category,
      workflowStatus: doc.status,
      version: doc.version,
      isLatest: doc.isLatest,
      folderName: doc.folder?.name ?? null,
      mimeType: doc.mimeType,
      size: buffer.byteLength,
      sha256: contentHash,
      checklistItemIds: input.itemIdsByDocumentId.get(doc.id) ?? [],
      order: index + 1
    };
  }));
}

export async function verifyArchiveSnapshotDocuments(
  snapshot: ArchiveReviewSnapshot,
  matterId: string
): Promise<{ documents: Map<string, StoredArchiveDocument>; buffers: Map<string, Buffer> }> {
  const ids = snapshot.documentIds;
  const rows = await prisma.document.findMany({
    where: { id: { in: ids }, matterId, deletedAt: null },
    select: {
      id: true, matterId: true, name: true, category: true, status: true, version: true, isLatest: true, path: true, mimeType: true,
      size: true, sha256: true, encrypted: true, iv: true, authTag: true, deletedAt: true,
      folder: { select: { name: true } }
    }
  });
  if (rows.length !== ids.length) throw new Error("送审材料已缺失、删除或不再属于本案，请退回补正");
  const storedById = new Map(rows.map((row) => [row.id, row]));
  const snapshotsById = new Map(snapshot.documents.map((doc) => [doc.id, doc]));
  const buffers = new Map<string, Buffer>();
  for (const id of ids) {
    const stored = storedById.get(id);
    const expected = snapshotsById.get(id);
    if (!stored || !expected) throw new Error("归档材料快照结构不完整，请退回补正");
    const buffer = await readArchiveDocument(stored);
    const hash = sha256(buffer);
    if (buffer.byteLength !== expected.size || hash !== expected.sha256) {
      throw new Error(`送审材料“${expected.name}”内容已变化，请退回补正`);
    }
    buffers.set(id, buffer);
  }
  return { documents: storedById, buffers };
}

export async function verifyArchivePolicySource(snapshot: ArchiveReviewSnapshot) {
  const source = await prisma.firmFile.findUnique({
    where: { id: snapshot.policy.sourceFileId },
    select: { id: true, name: true, path: true, sha256: true }
  });
  if (!source) throw new Error("送审所依据的归档制度原文已不存在，请退回补正");
  const buffer = await storage.readFile(source.path);
  const hash = sha256(buffer);
  if (hash !== snapshot.policy.sourceFileSha256 || (source.sha256 && source.sha256 !== hash)) {
    throw new Error("归档制度原文内容已变化，请退回补正并重新提交");
  }
}

export async function assertDocumentNotInPendingArchive(documentId: string) {
  const records = await prisma.archiveRecord.findMany({
    where: { status: "PENDING_REVIEW" },
    select: { archiveNo: true, checklistJson: true }
  });
  const record = records.find((item) => archiveSnapshotDocumentIds(item.checklistJson).includes(documentId));
  if (record) throw new Error(`该材料已列入待审归档申请 ${record.archiveNo}，请先驳回或处理该申请`);
}

export async function assertFirmFileNotUsedByArchivePolicy(fileId: string) {
  const [setting, records] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "archivePolicy" }, select: { value: true } }),
    prisma.archiveRecord.findMany({ select: { archiveNo: true, checklistJson: true } })
  ]);
  const currentPolicy = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value)
    ? setting.value as Record<string, unknown>
    : null;
  if (currentPolicy?.sourceFileId === fileId) {
    throw new Error("该文件是当前归档制度原文，请先启用新的制度版本");
  }
  const record = records.find((item) => parseArchiveSnapshot(item.checklistJson)?.policy.sourceFileId === fileId);
  if (record) throw new Error(`该制度原文已被归档记录 ${record.archiveNo} 固定引用，不能删除；请上传并启用新版`);
}
