# 迁移链从零重放断裂：诊断与重建基线提案（待批）

> 日期：2026-09-21。发现于 F-1 台账迁移的测试库演练（第六轮后续批次）。

## 一、现象

`prisma migrate deploy` 在**全新空库**上重放整条迁移链，于 `20260920000001_audit_fix_hardening`
报错：`column "confirmState" of relation "FeeEntry" does not exist`。

## 二、根因

该迁移为既有库补强（给 `FeeEntry.confirmState` 设默认 PENDING），而 **`confirmState`
列由 `v44_fee_confirm_state` 迁移创建**。Prisma 按名称排序执行：`2026*` 排在 `v4*`
之前，于是补强迁移先于建列迁移执行——从零重放必然失败。

深层原因：2026-09-19 业务流程重建时，迁移记录采用手工登记（baseline 快照见
`prisma/workflow-baseline-20260919.prisma`），新旧两段迁移命名体系混排且未保证
可重放序。

## 三、影响面（如实界定）

- **主库与既有部署：无影响**（迁移已按登记顺序应用完毕）；
- **全新安装：受影响**——官方 README 快速上手指引 `npx prisma migrate deploy` 在
  空库上会失败；当前 CI 的全新安装测试走独立空库路径（非链重放），未暴露此问题；
- **灾难恢复**：从零重建库时迁移链不可用，需依赖备份而非重放。

## 四、方案

**方案 A（推荐）：重建基线（squash）**
1. `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
   生成 `0_init` 基线迁移（即当前完整 Schema）；
2. 全新库从 `0_init` 起步（其后新增迁移正常追加）；
3. 既有库（含主库）执行 `prisma migrate resolve --applied 0_init` 标记基线已应用
   （等价于向 `_prisma_migrations` 插入一行已应用记录；旧记录保留作历史）；
4. 验收：独立空库 `migrate deploy` 从零通过；主库标记后 `migrate deploy` 无重放、
   无漂移告警；演练库保留供复核。

风险与红线：主库的 resolve 标记是一次 `_prisma_migrations` 写入——按红线单独
展示 SQL、备份后执行（前置于 F-5 的 holiday 表迁移一并演练）。

**方案 B：重命名历史迁移**（v43/v44 改名排在 2026* 之前）——需同步 UPDATE 既有库
`_prisma_migrations` 的 migration_name，改写已应用历史，风险高于 A，不推荐。

**方案 C：维持现状**，全新安装文档改用 `prisma db push`——放弃链可重放性，
灾难恢复依赖备份。零改动，但债留住了。

## 五、建议

批准方案 A 后与 F-5 的 `20260921000003_holiday_calendar` 一并走：备份 → 空库演练
（0_init + 后续全链）→ 主库 resolve + deploy → 演练库保留。
