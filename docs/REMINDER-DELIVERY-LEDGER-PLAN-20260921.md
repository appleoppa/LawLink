# 提醒送达台账（F-1）设计方案

> 日期：2026-09-21（上海）。来源：第六轮体检 F-1（`docs/SYSTEM-AUDIT-20260920-ROUND6-v2.md` §五）。
> 状态：**设计冻结，迁移 SQL 待叶森审批**（`prisma/migrations/20260921000001_reminder_delivery_ledger/`，未执行）。
> 配套已先行落地：P2-3（邮件摘要全局 500 条截断）不依赖本 Schema，已单独修复。

---

## 一、问题

系统能回答「今天发了多少条提醒」，回答不了三个问题：

1. 这条期限**应该**提醒几次？实际提醒了几次？
2. 有没有哪条提醒**该发而没发**？
3. 律师**看到**了吗（哪条通道、什么结果）？

现状模型是「扫描 → 创建 Notification → 结束」：档位是否命中、外发是否成功、某个通道是否被跳过，都不成体系。第六轮的 P1-2（保全档位停机丢失）、P1-4（邮件静默跳过）、P2-3（摘要截断）、P2-5（通知失败不可见）都是这个缺失的不同表现。P1-2/P1-4 已按点修复（补扫 + 台账 SystemSetting），本方案是结构性收口。

## 二、数据模型

`ReminderDelivery`（表 `reminder_delivery`，迁移 `20260921000001`）：**对象 × 档位 × 通道 × 上海日 × 接收人** 一行。

| 字段 | 说明 |
|---|---|
| `objectType` | `Deadline` / `Hearing` / `PreservationProperty` / `PreservationExpired` / `DeadlineEscalation` / `PreservationEscalation` / `PreservationRecipientMissing` / `Digest`（封闭集合，代码层常量约束） |
| `objectId` | 对象 id（`Digest` 行用 dayKey 语义） |
| `offset` | 档位：负=提前天数，0=当天，正=逾期天数（Digest 恒 0） |
| `channel` | `IN_APP` / `EMAIL` / `WEBHOOK` |
| `dayKey` | 上海日 `YYYY-MM-DD`——补发幂等的自然键 |
| `userId` | 接收人；通道级行（webhook、全所摘要）用**空串**而非 NULL（NULL 在 Postgres 唯一约束下 NULLS DISTINCT 会破坏幂等） |
| `status` | `PENDING`（应发未发）/ `SENT` / `SKIPPED`（有原因的跳过）/ `FAILED` |
| `scheduledAt` | 应发时间（当日 09:00 上海）——Phase C 对账扫描依据 |
| `sentAt` / `attempts` / `lastError` | 实发时间、尝试次数、最近失败原因 |
| `detail` | 通道级补充（如 Digest 行的 `sentCount`/`userCount`） |

**唯一约束** `(objectType, objectId, offset, channel, dayKey, userId)`——任何发送点重复执行（补扫、重试、手动重跑）天然幂等，`upsert` 即可。**不建 User 外键**：台账只记录历史事实，人员停用不抹除记录（与 AuditLog 同理），也避免反向关系噪音。

## 三、分阶段实施

### Phase A：台账记录（本批，迁移获批后实施）

各发送点在现有动作成功后**补记**台账行（best-effort：写失败不阻断发送，记 `REMINDER_LEDGER_WRITE_FAILED` 审计，与 P2-5 的 FEE_ENTRY_NOTIFY_FAILED 同款）：

| 发送点 | objectType | channel | 状态 |
|---|---|---|---|
| `refreshScheduleReminder`（期限/开庭） | Deadline / Hearing | IN_APP | SENT |
| 保全主循环档位提醒 | PreservationProperty | IN_APP | SENT |
| 保全 EXPIRED 翻转通知 | PreservationExpired | IN_APP | SENT |
| 期限/保全逾期升级 | *Escalation | IN_APP | SENT |
| 保全无接收人升级 | PreservationRecipientMissing | IN_APP | SENT（每位接收人一行） |
| email-digest worker | Digest | EMAIL | 每接收人一行 SENT/FAILED；无地址 SKIPPED；未配置 SMTP 通道级一行 SKIPPED（detail 记原因） |
| webhook-digest worker | Digest | WEBHOOK | 通道级一行 SENT/FAILED/SKIPPED |

管理后台「提醒维护」页新增**台账卡**：今日/近 7 天各通道 `SENT/SKIPPED/FAILED` 计数 + 最近失败列表（lastError 截断展示）。P2-5 的「通知失败可见」由审计日志升级为业务台账。

### Phase B：邮件摘要按人聚合（✅ 已先行落地，不依赖本表）

P2-3 修复与 Schema 解耦：worker 先取当日有通知的用户集（distinct userId），再逐人取通知（单人上限 50 条、文末标注截断），全局 take:500 已删除。Phase C 可把「当日该给谁发」的来源切到台账 IN_APP 行，进一步去掉对 Notification 的再查询。

### Phase C：对账式补发（独立批次，本表稳定后）

扫描职责一分为二：**登记**（每个命中档位 upsert PENDING 行，带 scheduledAt）与**投递**（worker 每 2 分钟扫 `status=PENDING AND scheduledAt <= now` 执行并落结果）。收益：任何应发未发（登记后进程崩溃、通道故障）在下一次 sweep 自动补发；「今天该发几条、实发几条、差几条」成为一条查询。现有档位匹配与去重逻辑保持不变，仅在其后追加登记。

## 四、不做（如实声明）

- **不追溯历史**：表从空开始，只记实施后的投递；历史可观测性仍由审计日志承担。
- **不改 Notification 表**：站内信仍是唯一通知载体，台账是投递事实记录，二者不合并（通知内容与送达状态分离，与「来源原件/AI/律师确认三层分离」同哲学）。
- **不做已读回执**：`read` 状态已在 Notification 上，台账不重复记录「律师是否看过」——那是另一个产品问题（未读提醒聚合已有铃铛）。
- **Phase C 前不动扫描逻辑**：P1-2 的补扫修复继续独立生效。

## 五、迁移（待批）

`prisma/migrations/20260921000001_reminder_delivery_ledger/migration.sql`——`CREATE TABLE reminder_delivery` + 唯一索引 `reminder_delivery_dedupe` + 查询索引两条。**纯增量，无删改列、无数据转换、无默认回填**。执行方式：批准后 `prisma migrate deploy`。

## 六、验收标准

1. Phase A 后：任一提醒发送（含补扫重试、手动「立即扫描」）在台账恰好一行；同日重跑不产生重复行（唯一约束）。
2. 台账卡数字与当日审计日志计数可交叉核对。
3. 未配置 SMTP 的日子：EMAIL 通道级 SKIPPED 行可见，不再需要翻 worker 代码确认。
4. 全量测试/lint/typecheck/build 干净；`prisma migrate deploy` 在主库执行前于独立测试库演练一次（沿用既有流程）。
