-- v0.17: 归档清单 ↔ Document 关联
-- 上传材料时可绑定到 lib/archive/checklists.ts 内某个 checklist item.id
-- 归档向导加载时根据本字段自动勾选已交项

ALTER TABLE "Document"
  ADD COLUMN "archiveChecklistItemId" TEXT;

CREATE INDEX "Document_matterId_archiveChecklistItemId_idx"
  ON "Document"("matterId", "archiveChecklistItemId");
