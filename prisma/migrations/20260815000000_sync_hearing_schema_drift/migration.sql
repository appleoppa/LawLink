-- 补上 Hearing.address / Hearing.contact 两列（schema 漂移收尾）
--
-- 这两列存在于 schema.prisma，却没有任何迁移创建它们。与 v0.44 保全三层模型
-- 缺失建表迁移是同一类问题：改动当时用 `prisma db push` 直推本地库，未生成迁移。
--
-- 后果：全新安装能完成 migrate + seed，但一进工作台就崩——Prisma Client 按
-- schema 查询 Hearing 时会命中不存在的列：
--   The column `Hearing.address` does not exist in the current database.
--
-- 此问题由外部贡献者 liuzl 于 2026-06-26 首次报告并提交修复（PR #3），
-- 该 PR 同时覆盖了保全三层模型的建表。本迁移采用其发现，并改为幂等写法，
-- 以便已通过 db push 建好这些列的既有实例执行时为无操作。
--
-- 防止再次发生：CI 已加入 `prisma migrate diff --exit-code` 漂移检查，
-- 任何 schema.prisma 与迁移历史不一致都会导致构建失败。

ALTER TABLE "Hearing" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Hearing" ADD COLUMN IF NOT EXISTS "contact" TEXT;
