# LawLink 第七轮全系统体检报告（2026-09-21）

> 触发：第六轮 P1/P2/F 全项修复完成后的回归审视。
> 范围：回归验证 + 新增代码（F-1 台账、F-5 放假安排、F-6 归档借阅、迁移链重建）自身缺陷。
> 方法：只做发现，不改代码（遵 AGENTS.md「审计止损线：发现与修复分离」）。
> 前序：`SYSTEM-AUDIT-20260920-ROUND6-v2.md`（v1 已作废，见其 §七修订记录）。

---

## 结论先行

1. **第六轮全部修复已验证落地**，756 测试全绿（较上轮 +67），build/typecheck 干净，lint 仅 1 处 unused 变量警告。
2. **新代码质量显著高于前几轮**：无空 catch、无本地时区取日、`findMany` 均带 take。`ledger.ts` 对「Postgres 事务内唯一冲突毒化整个事务、单测 mock 掩盖了它」的真库验证与注记，是本轮最扎实的一处工程判断。
3. **但新功能引入了两个 P1**，都不在代码正确性层面，而在**披露面**与**升级路径**：F-6 借阅把全所待审借阅单（含理由与完整案名）开放给了每个登录账号；迁移基线重建后既有第三方部署的升级步骤没有出现在任何用户文档里。
4. **F-1 台账的投递器缺少仓库自己已有的队列语义**（租约、退避、优先级），在早高峰与超时重入两个场景下会分别表现为「提醒延迟数小时」与「重复送达」——这恰是台账本要解决的可靠性问题换了形式重现。

---

## 一、验证基线（本轮实跑）

| 命令 | 结果 |
|---|---|
| `npm run lint` | 1 warning（`borrow.ts:272` unused `session`），0 error |
| `npm run typecheck` | 干净 |
| `npm run build` | 成功 |
| `npx vitest run` | 98 文件 / 756 用例全绿 |

工作区 0 个未提交改动，全部已提交（`5b62b68` 为 HEAD）。

---

## 二、第六轮修复的落地核验（逐条确认）

| 第六轮项 | 状态 | 核验点 |
|---|---|---|
| P1-1 compose 非法 + 备份链 | ✅ | — |
| P1-2 保全档位补扫 | ✅ | `scheduler.ts:182` 每 2 分钟 `scanPreservationReminders`，09:00 前仅补关键档 |
| P1-3 保全接收人在职校验 | ✅ | `pickPreservationRecipient` 三级回退，与日程同口径 |
| P1-4 外发通道缺口 | ✅ | — |
| P2-1 期限服务端重算 | ⚠️ 部分 | 已实现但有缺陷，见本轮 P2-3 |
| P2-2 冲突检索归一化 | ✅ | 双向匹配 + 归一分级降一级 |
| P2-4 诉讼时效/举证期限预置 | ✅ | 已入库 |
| P2-5 通知路径测试覆盖 | ✅ | 改为受控错误注入（`Error: 通知服务不可用`），不再是 mock 缺失 |
| F-1 送达台账 | ⚠️ 部分 | 模型与作废矩阵正确，投递器缺队列语义，见 P2-1 |
| F-5 放假安排 | ⚠️ 部分 | 引擎正确，降级行为与注释不符，见 P3-2 |
| F-6 归档借阅 | ❌ | 披露面回退，见 P1-1 |

**台账设计评审意见的采纳情况**（对照 `REMINDER-DELIVERY-LEDGER-PLAN-20260921.md` 评审）：拆 `kind`、补 `SUPERSEDED`/`CANCELLED`、三个字段 enum 化、`registeredAt` 语义按来源取时刻、作废矩阵接入 `retireScheduleReminders`——**五条全部落地**。

---

## 三、P1

### P1-1　F-6 借阅：全所待审借阅单对每个登录账号可见

**位置**：`src/server/archive/borrow.ts:96-99`、`61-72`；`src/app/(app)/archive/page.tsx:19`

```ts
prisma.archiveBorrowRequest.findMany({
  where: { status: "PENDING" },        // 无任何可见性过滤
  orderBy: { createdAt: "asc" }, take: 50, select: borrowSelect
})
```

`borrowSelect` 返回 `reason`（借阅理由）、`archiveRecord.matter.title`（**完整案名**）、`internalCode`、`applicant.name`。

同批次归档页权限由 `requireSession("archive.read")` 放宽为 `requireSession()`：

```diff
- const session = await requireSession("archive.read");
+ const session = await requireSession();
```

`canDecide` 逐条判审批资格（`canApproveContext`），但它**只控制能否操作，不控制能否看见**。

**后果**：任何登录账号——助理、财务、实习生、任何自定义角色——都能读到「某律师申请借阅 XX公司诉YY公司案卷，理由：客户拟申请再审」。借阅理由字段常含案情、客户意图与诉讼策略。

**与系统既有口径冲突**：PRD §三 M1 明确规定工作台「关联对象显示客户名称/姓名，**不展示完整案件名称**」；AGENTS §八安全底线规定案件正文类敏感数据「控制在谁能进这个页面」。本功能同时突破了这两条。

**同源**：`searchArchiveForBorrow`（`borrow.ts:274-292`）无案件可见性过滤，全所已归档案件的归档号/案号/案名可被任意 `matters.read` 持有者模糊检索。此处**可能是有意设计**（借阅的前提就是能检索到自己没办过的案卷），但应是明确决策而非顺带结果。

**处理前需定口径**（产品决策，见 §七）。

---

### P1-2　迁移基线重建后，既有第三方部署的升级路径未文档化

**位置**：`prisma/migrations/`（仅存 `0_init` + `20260921000004_archive_borrow` + lock）；`prisma/migrations-archive-20260921/`（75 个旧迁移）

基线重建本身处理正确，AGENTS.md:208 记录了三重验证（空库从零 deploy、克隆库 resolve+deploy、主库 resolve 标记）。

**问题在文档**：`README.md`、`docs/RELEASE-GUIDE-v1.3.md`、`docs/OPERATIONS.md`、`docs/CLOUD-SERVER-INSTALLATION-GUIDE.md` 中，`0_init` 与 `migrate resolve` **零命中**；RELEASE-GUIDE 中连 `migrate deploy` 都未出现。

**既有部署升级时的实际行为**：
1. `_prisma_migrations` 表中有 75 条旧记录，无 `0_init`；
2. `prisma migrate deploy` 发现 `0_init` 未应用 → 尝试执行 → `CREATE TABLE "User"` 撞上已存在的表 → **升级中断**；
3. 同时库中有 75 条目录里不存在的迁移记录 → drift 告警。

普通部署方看到 `table already exists` 无法自行推导出解法（`prisma migrate resolve --applied 0_init`）。

**对开源自部署产品，这等于升级路径被切断。** 内部知道怎么做（AGENTS 里写了），外部用户不知道。

**建议**：在 `RELEASE-GUIDE` 新增「从 v1.3.x 升级到本版」一节，明确：备份 → `prisma migrate resolve --applied 0_init` → `prisma migrate deploy` → 验证无待办迁移；README 升级条目指向该节；CHANGELOG 标注为**破坏性升级步骤**。

---

## 四、P2

### P2-1　台账投递器缺少队列语义（租约 / 退避 / 吞吐）

**位置**：`src/server/reminders/delivery.ts:78-120`；调用于 `src/server/cron/scheduler.ts:186`（`deliverPendingReminders(20)`，每 2 分钟）

投递器是「`findMany` PENDING → 逐行处理 → finalize」，**没有领取动作**：

**(a) 无租约。** node-cron 的 `*/2` 在上一次回调未结束时仍会触发下一次，重入的 sweep 会 `findMany` 到同一批尚未 finalize 的行 → **重复投递**。唯一约束挡不住：它防的是同键重复**行**，不是同一行重复**发送**。

对照：仓库自己的 `src/server/cron/queue.ts` 有 `claimDueJobs` + `recoverStaleLeases`（租约 + 宕机恢复），正是为此而建。台账投递器没有复用。

**(b) 无退避。** 失败行 `status` 回 `PENDING` 而 `registeredAt` 不变（永远最早），下一轮 sweep 仍优先捞取。`MAX_ATTEMPTS=5` 使其有界，但 100 条失败行仍会占满 5 轮 sweep 的 take 窗口。Schema 无 `nextAttemptAt` / `leaseUntil` 字段。

**(c) 吞吐。** 20 条 / 2 分钟 = 600 条/小时。09:00 全量补扫一次性登记当日所有档位行（中等规模律所数百条起步），叠加 (b) 的失败占位，**「今天到期」的提醒可能拖到下午才送达**。

**建议**：复用 `cron/queue.ts` 的 claim 机制（或把台账行作为 job 入既有队列）；Schema 补 `nextAttemptAt`（指数退避）与租约字段；`limit` 随登记量自适应或提高 sweep 频率。

---

### P2-2　`registerReminderDelivery` 返回值与自身注释不符，重武装不计入统计

**位置**：`src/server/reminders/ledger.ts:44`（注释）vs `78-82`（实现）

注释：

> FAILED 未超尝试限 / SUPERSEDED / CANCELLED … → 重新武装为 PENDING，**返回 REGISTERED**

实现：

```ts
await db.reminderDelivery.updateMany({
  where: { ...dedupeFields(key), status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
  data: { status: "PENDING" }
});
return "ALREADY";          // ← 与注释矛盾
```

调用方按返回值计数：`schedule.ts:143` 的 `registered: registered === "REGISTERED"`、`schedule.ts:236` 的 `if (reg === "REGISTERED") escalationSent++`。

**后果**：FAILED 行确实被重新武装并会再次投递（行为正确），但统计上记为「已存在、跳过」。`escalationSent` 等数字进入 cron 审计，与实际发生的事对不上。**台账的全部价值是可观测性，统计与事实分叉是对这一价值的直接侵蚀。**

**建议**：重武装分支返回 `"REGISTERED"`，或引入第三个返回值 `"REARMED"` 由调用方分别计数。

---

### P2-3　服务端重算的警告会被截断，顺延结果不入库，改期路径无覆盖

**位置**：`src/server/procedures/actions.ts:460-473`；`src/server/deadlines/confirm.ts:66-89`

```ts
basis = `${basis ?? ""}${note}`.slice(0, 300);
```

三个问题：

1. **警告被从尾部截断**。原 `basis` 含法条依据与 `HOLIDAY_NOTE`（本身 40 余字），接近 300 字是常态；追加的重算不一致警告在字符串尾部，**最该被看见的内容最先被切掉**。
2. **顺延只写文字不写 `dueAt`**。`adjustDeadlineForHolidays` 的结果仅进入 `basis` 文本，落库的 `dueAt` 仍是律师提交值。因此提醒、台账、日历订阅、报表导出全部按**未顺延**日期运行，与 `basis` 里写的「已顺延至 X」口径分裂。
3. **人工改期路径无重算无顺延**。`adjustDeadline`（`confirm.ts:66`）不做规则比对也不做节假日顺延。以律师判断为准有其道理（要求填原因并留痕），但这意味着 P2-1 的「服务端复核」只覆盖新建路径，改期即绕过。

**建议**：不一致警告独立成字段（或前置拼接而非尾部追加）；明确顺延是「提示」还是「生效」——若生效则写入 `dueAt` 并留痕，若仅提示则 `basis` 文案不应写成「已顺延至」；改期路径补同口径比对提示。

---

## 五、P3

| 编号 | 位置 | 问题 |
|---|---|---|
| P3-1 | `ledger.ts:113` | `sentAt: status === "SENT" ? new Date() : null`——同键当日重跑时若由 SENT 转 FAILED，会把 `sentAt` 抹为 null。台账是事实记录，「曾经送达过」不应被可逆清除（应只在 SENT 时写入，不在其他状态清空） |
| P3-2 | `holidays.ts:28` | `catch {}` 吞掉全部错误（含数据库连接故障），一律按「未配置」降级 → 法定节假日不顺延。对期限引擎，应区分「表不存在（迁移未执行）」与「查询失败（故障）」，后者不应静默 |
| P3-3 | `holidays.ts:64-73` | `adjustDeadlineForHolidays` 注释称「未配置时返回原日期并 adjusted=false」，实现中未配置时周末仍会顺延并返回 adjusted=true。周末顺延本身符合民诉法第八十五条第三款，但注释与实现不符会误导维护者 |
| P3-4 | `holiday-actions.ts:29` | 默认年份用服务器本地 `new Date().getMonth() >= 10` 判断 Q4，UTC 容器下 10 月初边界会差一日 |
| P3-5 | `ledger.ts:93` | `voidPendingDeliveries` 的 `data: { detail: { reason } }` 覆盖已有 `detail`（PENDING 行通常无 detail，影响有限） |
| P3-6 | `borrow.ts:272` | 未使用的 `session`（lint warning）。`requireSession("matters.read")` 已生效，非鉴权缺失；与 P1-1 同源 |

---

## 六、法律层：一处待核（不得作为已核结论使用）

`src/lib/calendar/holidays.ts` 的 `WORKDAY` 处理（调休上班的周末不视为休假日、不顺延）涉及一份专门规则：

**《最高人民法院关于调休后的工作日、节假日是否适用期间顺延规定的批复》（〔2016〕最高法刑他142号，2016-04-29，现行有效）**

- **已核验**：标题、文号、发布机关、发布日期、时效性（北大法宝 MCP，元典余额不足）。
- **未核验**：**批复正文**。该文件在北大法宝无条文结构，`article` 字段返回为空，未能取得全文。

因此：代码 `WORKDAY` 分支的方向与该批复所要解决的问题一致，但**其口径是否与批复结论完全吻合，本轮未能核实**。该批复同时影响刑事与民事期间计算，建议由叶森核对原文后确认代码口径，再据以定稿。

**本轮已核验的其余法条**（均现行有效）：

| 法条 | 用于 |
|---|---|
| 《民事诉讼法》（2023修正）第八十五条 | 期间计算与休假日顺延（F-5、P2-3） |
| 《民法典》第二百零三条 | 期间最后一日为法定休假日的，以休假日结束次日为最后一日（实体法期间参照） |
| 《民法典》第一百八十八条 | 诉讼时效三年（第六轮 P2-4 预置规则依据） |

---

## 七、待叶森决策：P1-1 的披露口径

借阅功能的设计意图是「能申请借阅自己没办过的案卷」，这本身要求一定的可检索性。可见性收到什么程度是产品决策，不是技术问题。三个选项：

| 方案 | 待审列表可见范围 | 检索可见字段 | 代价 |
|---|---|---|---|
| **A（推荐）** | 仅对该条具备 `canDecide` 资格者可见；申请人见自己的 | 归档号 + 案号 + 归档日期（**去掉案名**） | 审批人之外无人知道有谁在借什么；与 PRD「不展示完整案件名称」一致 |
| B | 全员可见但脱敏：隐去 `reason`，案名截断为「XX公司…纠纷」 | 同上 | 保留「所内透明」观感，但脱敏规则需额外维护 |
| C | 维持现状（全员可见全字段） | 现状 | 需在 AGENTS §八明确记为已知并接受的例外，否则与既有口径冲突 |

推荐 A 的理由：借阅申请的读者只有两类——申请人（要看进度）和审批人（要做决定）。第三方看到「谁在借什么案卷、为什么借」不产生业务价值，却把客户关系与诉讼策略暴露给了全所。归档页放开为「登录可进」的目的是让人能发起申请，检索接口已单独承担该职责，不需要待审列表也全员可见。

---

## 八、建议处理顺序

1. **P1-2 升级文档**（纯文档，无代码风险，但阻断既有部署升级——最优先）
2. **P1-1 借阅披露面**（待 §七 口径确认后一次改到位，含 `borrow.ts:96` 与 `searchArchiveForBorrow` 字段）
3. **P2-2 返回值**（改动最小，直接影响统计可信度）
4. **P2-3 重算警告与顺延口径**（含改期路径，需先定「提示 vs 生效」）
5. **P2-1 投递器队列语义**（需 Schema 迁移，走 create-only 审批；与 F-1 Phase C 合并规划更经济）
6. **P3 组合批处理**

---

## 九、建议并入 AGENTS.md backlog 的条目

```
- 第七轮体检（2026-09-21，报告 docs/SYSTEM-AUDIT-20260921-ROUND7.md）：
  1. P1-1 F-6 借阅披露面回退（待审列表无过滤 + 归档页放开为登录可进）——口径待定后修；
  2. P1-2 基线重建后既有部署升级步骤未进用户文档（RELEASE-GUIDE 缺 resolve 指引）；
  3. P2-1 台账投递器缺租约/退避/吞吐（复用 cron/queue.ts claim 机制，需 Schema 迁移）；
  4. P2-2 registerReminderDelivery 重武装返回值与注释不符，重试不计入统计；
  5. P2-3 服务端重算警告被 slice(0,300) 截断、顺延不入库、改期路径无覆盖；
  6. P3×6 见报告 §五；
  7. 待核法律点：〔2016〕最高法刑他142号批复正文（WORKDAY 口径依据），正文未核验。
```

---

## 十、本轮未覆盖（如实声明）

- **未做**：浏览器端金线走查（AGENTS §七要求的 UI 验收）；本轮为静态审计 + 单测/构建验证。
- **未验证**：P1-2 的既有部署升级失败链条基于 Prisma 行为推演与目录/文档核对，**未实际在克隆库上跑一次失败复现**。修复前建议实测一次。
- **未验证**：P2-1 的重入重复投递为并发推演，未构造实测（需 sweep 超过 2 分钟的场景）。
- **未审**：AI/元典外发的提示词注入面、OCR 可信度边界、短信取件平台兼容性（无真实样本）。
- **未审**：`src/components/` UI 层一致性（v4 墨案重建属另一条线）。

---

*本报告遵「发现与修复分离」，未包含任何代码改动。*
