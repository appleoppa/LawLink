# 提醒送达台账（F-1）设计方案 v2

> 日期：2026-09-21（上海）。来源：第六轮体检 F-1（`docs/SYSTEM-AUDIT-20260920-ROUND6-v2.md` §五）。
> 状态：**v2 修订版（吸收叶森 8 条审查意见），迁移 SQL 待批**（`prisma/migrations/20260921000002_reminder_delivery_ledger/`，未执行；v1 的 20260921000001 已删除，从未在任何库执行）。
> 配套已先行落地：P2-3（邮件摘要全局 500 条截断）不依赖本 Schema，已修复并带 4 例测试。
>
> **中间态约定**：model 在 schema、表在库里不存在的状态只在「待批窗口」内允许存在；若最终不批，整体摘除恢复一致，不留悬置。

## v1 → v2 修订记录

| # | 意见 | 修订 |
|---|---|---|
| 1 | Phase A「发送后补记」只交付发送日志，答不了「该发未发」，且会被 Phase C 推翻 | 分期重排：**保全单点做完整闭环（登记→投递→落结果）**，验证后再扩点；废弃全量补记方案 |
| 2 | 无作废语义，Phase C 会投递已改期/已办结对象的旧提醒 | 状态补 `SUPERSEDED`/`CANCELLED`；作废触发矩阵（§四）；投递前复核对象当前状态（沿用 B3 原则） |
| 3 | objectType 混装对象与事件 | 拆 `objectType`（DEADLINE/HEARING/PRESERVATION_PROPERTY/DIGEST）× `kind`（OFFSET/EXPIRED/ESCALATION/RECIPIENT_MISSING/DIGEST）二维，唯一键加 kind |
| 4 | offset 语义过载 | kind 拆分后 offset 仅对 OFFSET/ESCALATION 有意义，其余恒 0 |
| 5 | String + 代码层常量丢掉 DB 约束，库内 83 个 enum 的惯例被无故打破 | `objectType`/`kind`/`channel`/`status` 全部 Prisma enum |
| 6 | scheduledAt「当日 09:00」与实际投递模型不符（期限/开走走保存即时触发+2 分钟补扫，仅保全走 09:00 扫描） | 改名 `registeredAt`＝登记时刻＝应发动的一刻：即时触发取保存时刻，档位扫描取扫描时刻；投递条件 `registeredAt <= now` |
| 7 | 验收标准「与审计日志交叉核对」不可执行（站内提醒无逐条审计） | 改为与扫描汇总统计（`DUE_REMINDER_SCAN_CRON` detail / webhook last result）核对 |
| 8 | 无保留/清理策略，将成为写入最密的表 | 明细保留 `REMINDER_LEDGER_RETENTION_DAYS`（默认 180 天），每日清理 job 删除超期行并审计计数；不做归档聚合表（台账卡只查近 7 天现场聚合，未来报表需要再议） |

## 一、问题（不变）

系统能回答「今天发了多少条提醒」，回答不了：该发几次/实发几次？有没有该发未发？律师经哪条通道收到、结果如何？现状「扫描 → 创建 Notification → 结束」没有送达概念。P1-2/P1-4/P2-3/P2-5 是同一缺失的不同表现。

## 二、数据模型（v2）

`ReminderDelivery`（表 `reminder_delivery`）：**对象 × 形态 × 档位 × 通道 × 上海日 × 接收人** 一行。

| 字段 | 类型 | 说明 |
|---|---|---|
| `objectType` | enum `ReminderDeliveryObjectType` | DEADLINE / HEARING / PRESERVATION_PROPERTY / DIGEST |
| `objectId` | string | 对象 id（DIGEST 行用 dayKey 语义） |
| `kind` | enum `ReminderDeliveryKind` | OFFSET（档位提醒）/ EXPIRED（保全过期翻转）/ ESCALATION（逾期升级）/ RECIPIENT_MISSING（无接收人升级）/ DIGEST（汇总投递） |
| `offset` | int | 仅 OFFSET/ESCALATION 有意义：负=提前天数，0=当天，正=逾期天数；其余恒 0 |
| `channel` | enum `ReminderDeliveryChannel` | IN_APP / EMAIL / WEBHOOK |
| `dayKey` | string | 上海日 YYYY-MM-DD，补发幂等自然键 |
| `userId` | string | 接收人；通道级行用**空串**（NULL 在 Postgres 唯一约束下 NULLS DISTINCT 破坏幂等） |
| `status` | enum `ReminderDeliveryStatus` | PENDING / SENT / SKIPPED / FAILED / **SUPERSEDED / CANCELLED** |
| `registeredAt` | DateTime | **登记时刻＝应发动的一刻**：保存即时触发取保存时刻，档位扫描取扫描时刻；投递条件 `registeredAt <= now` |
| `sentAt` / `attempts` / `lastError` / `detail` | | 实发时间、尝试次数、失败原因、通道级补充（SKIPPED 原因、Digest 计数） |

**唯一键** `(objectType, objectId, kind, offset, channel, dayKey, userId)`——登记、补扫、重试、手动重跑一律 upsert 幂等。**不建 User 外键**：台账记录历史事实，人员停用不抹除。

## 三、投递模型

1. **登记**：发送点（保存即时触发 / 档位扫描 / 过期翻转 / 升级判定）不再直接创建通知，改写 PENDING 行（含 registeredAt、接收人、内容素材入 detail）。
2. **投递**：队列 worker 每 2 分钟 sweep `status=PENDING AND registeredAt <= now`（限量批取）。
3. **复核**：投递前重读对象当前状态（§四矩阵）——对象已变/已逝 → 行改 SUPERSEDED/CANCELLED，**不发送**；接收人已失效 → 换人或作废，沿用 `isReminderRecipientEnabled` 与升级口径。
4. **落结果**：SENT / FAILED（attempts+1，退避重试，超限置终态并可见）/ SKIPPED（原因入 detail）。

## 四、作废触发矩阵（SUPERSEDED / CANCELLED）

| 触发 | 行为 | 挂接点 |
|---|---|---|
| 期限/开庭改期、确认、办结 | 旧 PENDING 行 → SUPERSEDED | `retireScheduleReminders`（现 9 处调用点同步作废台账 PENDING 行） |
| 案件交接/责任变更（接收人变化） | 旧 PENDING 行 → SUPERSEDED，按新接收人重新登记 | `matters/handover`、`reminders/responsibility` |
| 保全 expiryDate / remindDays / 负责人变更 | 旧 OFFSET PENDING 行 → SUPERSEDED，重新登记 | 保全编辑路径 |
| 保全状态离开 ACTIVE/RENEWED（EXPIRED 翻转、解除、删除） | OFFSET PENDING 行 → CANCELLED（EXPIRED 翻转自身产生 EXPIRED 行） | `scanPreservationReminders` lapsed 分支 + 保全处置路径 |
| 期限/开庭删除 | PENDING 行 → CANCELLED | 各删除路径 |

复核步骤（§三.3）兜住「作废与投递之间」的竞态：sweep 取到行后再次确认对象现值，不符即作废不发送。

## 五、分阶段实施（v2 重排）

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **一：保全单点闭环** | 保全全部四种 kind（OFFSET/EXPIRED/ESCALATION/RECIPIENT_MISSING）改「登记→投递→复核→落结果」；作废矩阵保全侧挂接；2 分钟补扫从「直接发」改「只登记」 | 验收 1–3 通过 |
| **二：扩期限/开庭** | `refreshScheduleReminder` 改造为登记+投递；`retireScheduleReminders` 挂 SUPERSEDED/CANCELLED | 同上 + 既有 schedule 测试迁移 |
| **三：Digest 通道行 + 台账卡** | EMAIL/WEBHOOK 每日投递落行；提醒维护页台账卡（近 7 天各通道×状态计数 + 最近失败）+ 保留清理 job | 验收 4–5 通过 |

Phase B（邮件按人聚合）已先行落地，与 Schema 解耦，不变。**台账卡放最后**：阶段一、二完成前，卡的数字只覆盖部分通道，容易再次制造「看起来可观测」的错觉。

## 六、保留与清理

- 明细保留 `REMINDER_LEDGER_RETENTION_DAYS`（默认 180 天）；每日 03:10 清理 job（复用 audit-cleanup 模式：只删超期行、删除计数写审计、不碰 AuditLog）。
- 不做归档聚合表：台账卡只查近 7 天现场聚合；未来报表确需长期序列再按日聚合归档，另行设计。
- PENDING 超过 7 天的行由投递器置 FAILED（detail 记「长期未投递」），不无限滞留。

## 七、不做（不变，略）

不追溯历史；不改 Notification 表（站内信仍是通知载体，台账是投递事实）；不做已读回执；未列发送点（如备份 notifyAdmins、审批通知）不入台账——它们不是提醒体系。

## 八、迁移（待批，v2）

`prisma/migrations/20260921000002_reminder_delivery_ledger/migration.sql`：4 个 `CREATE TYPE` + `CREATE TABLE` + 唯一索引 + 2 条查询索引。**纯增量**，无删改列、无数据转换。v1 的 20260921000001 已删除且从未执行。批准后先独立测试库演练，再 `prisma migrate deploy`。

## 九、验收标准（v2）

1. 保全任一登记行同键重扫/重试 upsert 幂等，同日不重复发送；
2. 保全改期/处置/过期后，旧 PENDING 行在下次投递前被作废——**已失效的档位提醒不再发出**（专项用例）；
3. 投递前复核捕获作废-投递竞态（复核不符 → SUPERSEDED/CANCELLED，零发送）（专项用例）；
4. 台账卡数字与 `DUE_REMINDER_SCAN_CRON` 汇总统计（preservationNotified/Expired/escalationSent）在保留窗口内可核对；
5. 保留清理 job 生效：超期行删除、计数审计、AuditLog 不受影响；
6. 全量测试 / lint / typecheck / build 干净；主库执行前独立测试库演练通过。
