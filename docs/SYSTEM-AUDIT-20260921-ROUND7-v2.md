# LawLink 第七轮全系统体检报告 v2（2026-09-21）

> **本版取代 v1**（`SYSTEM-AUDIT-20260921-ROUND7.md`，原件保留未改）。
> v1 的 P1-1 经动手修复时复核**证伪**，另有一类更严重的缺陷在修复过程中被发现。
> **v1 不得作为修复依据使用。**
>
> 状态：本轮发现已按叶森授权（「你来决定吧」）**边验证边修复**，非纯发现态。
> 已修项见 §四，留待审批的见 §五。

---

## 结论先行

1. **第六轮全部修复验证落地**，基线 756 → **763 测试全绿**（本轮新增 7 例防线用例），lint / typecheck / build 干净。
2. **v1 的 P1-1 不成立**：`listArchiveBorrows` 在返回前已按 `canDecide` 过滤（`borrow.ts:122`），做法正是 v1 所建议的方案 A。v1 只读到 `findMany` 的 where 就下了结论，未读到函数末尾——**与第六轮 P1-5 同型的错误**。
3. **本轮实际最严重的问题是 v1 没发现的**：审计动作标签按词拼装，缺一个词整条降级为「其他操作（详见技术详情）」——全仓 **199 个 action 中 48 个（24%）命中降级**，其中含证件号明文查看、联系人电话查看、财务更正、二次验证变更、桌面取件等敏感操作。对一个把 AuditLog 当合规基础设施的系统，这是实质缺陷。已一次补齐并加元测试防回归。
4. **P1-2（迁移基线升级路径）已实测证实并修复**：既有部署直接 `migrate deploy` 报 `P3018 / 42710`，失败还会阻断后续全部迁移。升级步骤已写入 RELEASE-GUIDE 与 README。

---

## 一、验证基线

| 命令 | 修复前 | 修复后 |
|---|---|---|
| `npx vitest run` | 98 文件 / 756 例全绿 | **99 文件 / 763 例全绿** |
| `npm run lint` | 1 warning | **0 warning / 0 error** |
| `npm run typecheck` | 干净 | 干净 |
| `npm run build` | 成功 | 成功 |

---

## 二、v1 → v2 修订记录

| 项 | v1 结论 | v2 结论 | 错误性质 |
|---|---|---|---|
| **P1-1** 借阅披露面 | P1：全所待审借阅单对每个登录账号可见（含 reason 与完整案名） | **证伪**。`borrow.ts:122` 返回前已 `filter((r) => r.canDecide)`，无资格者拿到空数组；前端仅消费 `mine` 与已过滤的 `pending` | **读了一半就下结论**——只看 `findMany` 的 where，未读到同函数末尾的过滤。与第六轮 P1-5 同型 |
| P1-1 衍生 | 建议「方案 A：仅审批资格者可见 + 检索去掉案名」 | 前半已是现状；后半**主动放弃**——检索去掉案名会使借阅功能不可用（律师多凭案名找卷），改为保留检索能力 + 补审计留痕 | 方案未经可用性验证 |
| 新增 | — | **审计标签降级 48/199**（本轮最严重项，v1 完全未发现） | v1 覆盖盲区 |
| 新增 | — | `window.prompt` 违反 AGENTS 交互铁律（`borrow-panel.tsx:129`） | v1 覆盖盲区 |
| 新增 | — | 待审取数窗口 `take: 50` 在资格过滤之前 | v1 覆盖盲区 |
| P1-2 | 基于 Prisma 行为推演，标注「未实测」 | **已实测证实**，且比推演更糟（失败会阻断后续全部迁移） | 推演正确，补齐证据 |

**教训（承 v1 §七）**：v1 已记下「涉及机制缺失的断言必须读完全部注册点」，本轮 P1-1 仍以同型错误发生，只是从「模块注册点」变成了「函数返回路径」。**规则应扩展为：任何基于「某处缺少 X」的指控，必须读完该函数/模块的完整数据流出口，不得在中途下结论。**

---

## 三、P1-2 实测记录（迁移基线升级路径）

独立探针库 `lawlink_upgrade_probe`（未触碰主库），库结构停在 `0_init`，`_prisma_migrations` 伪造为 v1.3.2 既有部署状态：

**① 既有部署直接升级 → 失败**

```
Applying migration `0_init`
Error: P3018
Database error code: 42710
ERROR: type "UserRole" already exists
```

失败记录写入 `_prisma_migrations`，**在恢复之前后续迁移全部阻断**。

**② 恢复路径 → 有效**

```
npx prisma migrate resolve --applied 0_init   → Migration 0_init marked as applied.
npx prisma migrate deploy                     → Applying `20260921000004_archive_borrow` / All migrations successfully applied.
```

**③ 正序（升级前先 resolve）→ 零报错**

```
resolve --applied 0_init → deploy → migrate status: Database schema is up to date!
```

**④ 全新安装** → `migrate deploy` 仅跑 `0_init` + 后续迁移，正常。

探针库保留供复核（另有 `lawlink_upgrade_probe2` 为正序验证库）。

---

## 四、本轮已修（含验证）

| 编号 | 问题 | 处理 | 位置 |
|---|---|---|---|
| **P1-2** | 基线重建后既有部署升级步骤未文档化 | RELEASE-GUIDE 新增「从 v1.3.x 升级：迁移基线重建」整节（含实测命令、失败后恢复、容器场景）；README 升级条目加显式提示与锚点 | `docs/RELEASE-GUIDE-v1.3.md`、`README.md` |
| **新-1** | 审计动作标签 48/199 降级为「其他操作」，含敏感操作；10 个 targetType 显示「其他对象」 | 一次补齐 49 个词条 + 10 个对象标签；新增元测试扫描全仓 action/targetType 断言零降级 | `src/lib/audit-labels.ts`、`src/tests/lib/audit-labels.test.ts` |
| **新-2** | `window.prompt` 录入驳回理由，违反 AGENTS 交互原则③（全仓孤例；同文件批准路径已用 `confirmDialog`） | 改用项目既有 `promptDialog`（required + maxLength 500，与服务端 zod 校验对齐） | `borrow-panel.tsx:129` |
| **新-3** | 待审列表 `take: 50` 在 `canDecide` 过滤之前——PENDING 总量超 50 时，本人有资格审的条目会被无资格条目挤出取数结果而永不可见 | 取数窗口与展示窗口分离（`PENDING_SCAN_LIMIT=200` / `PENDING_DISPLAY_LIMIT=50`），过滤后再截 | `borrow.ts:62-63,105,122` |
| **P2-2** | `registerReminderDelivery` 失败行重武装后返回 `ALREADY`，与自身注释矛盾；调用方按 `=== "REGISTERED"` 计数，重试真投递但不计入统计 | 重武装返回 `REGISTERED`；新增 4 例回归测试覆盖四条返回路径 | `ledger.ts:76-83`、`reminder-ledger-register.test.ts` |
| **P2-3** | 重算警告被 `slice(0,300)` **从尾部**截断——最该看见的不一致提示最先被切掉 | 改为优先保留警告、截原 basis 尾部 | `procedures/actions.ts:474-478` |
| **P2-3** | 顺延文案写「已顺延至」但 `dueAt` 未改，口径分裂 | **定为「提示」口径**：文案改「建议按放假安排顺延至…请核对后自行调整」，`dueAt` 不由系统改写；`adjustDeadlineForHolidays` 注释明确禁止调用方据此自动改写 | `procedures/actions.ts:467-472`、`holidays.ts:73-74` |
| **P3-1** | `sentAt` 在非 SENT 状态被写 null，抹掉「曾经送达过」的事实 | 改为仅 SENT 时写入，其他状态不碰该字段 | `ledger.ts:113` |
| **P3-2** | `catch {}` 吞掉全部错误（含连接故障），静默按「未配置」降级 → 法定节假日不顺延 | 仅 P2021（表未建）静默，其余错误记 `console.error` 留痕 | `holidays.ts:30-37` |
| **P3-3** | 注释称「未配置时返回原日期 adjusted=false」，实现中周末仍顺延 | 修正注释为实际行为（周末属法定休假日，顺延正确；但未配置时春节国庆不顺延，人工核对提示仍必要） | `holidays.ts:9-12` |
| **P3-4** | 默认年份用服务器本地 `getMonth()`，UTC 容器下 11 月边界错判 | 改用 `shParts` 上海口径 | `holiday-actions.ts:29-31` |
| **P3-6** | 未使用的 `session`（lint warning）；借阅检索可跨经办范围查全所案卷但无留痕 | 补 `ARCHIVE_BORROW_SEARCH` 审计（只记检索词与命中数，不记命中案名），session 同时被用上 | `borrow.ts:300-307` |

### 口径决定（授权范围内所作，供复核）

1. **P1-1 借阅披露**：维持现状（服务端已按审批资格过滤）+ 补检索留痕。**放弃 v1 的「检索去掉案名」**——律师多凭案名找卷，去掉会使功能不可用；真正的风险是「未经申请浏览全所清单 + 看到他人借阅理由」，前者由 `term.length >= 2` 定向检索 + `take: 10` 限制，后者由 `canDecide` 过滤解决，均已存在。
2. **P2-3 顺延口径 = 提示，不生效**。法定休假日顺延在个案中可能有例外（法院指定期间、当事人另有约定），系统不替律师改写日期，只给建议值。
3. **P2-3 改期路径不补重算**。`adjustDeadline` 是人工调整，已强制填原因且审计含 `previousDueAt`/`newDueAt`/`sourceRuleId`，追溯充分；再加自动提示价值低于打断成本。
4. **P3-5 不修**（`voidPendingDeliveries` 的 detail 覆盖）：PENDING 行的 detail 恒空——register 的 revive 分支已 `Prisma.DbNull` 清空，覆盖无实际影响。

---

## 五、P2-1 台账投递器：已修一半，另一半待审批

**位置**：`delivery.ts:78-120`；调用于 `scheduler.ts:186`（`deliverPendingReminders(20)`，每 2 分钟）

### 已修：进程内重入守卫（无需迁移）

sweep 没有「领取」动作，行在处理期间仍是 PENDING；node-cron 的每 2 分钟作业在上一次回调未结束时照常触发下一次，重入的 sweep 会捞到同一批未 finalize 的行**重复投递**。唯一约束挡不住——它防的是同键重复「行」，不是同一行重复「发送」。

已加模块级 `sweepInFlight` 守卫（`try/finally` 复位），重入整轮让开并返回 `reentrantSkipped: true`。AGENTS 定义本系统为单体单进程，该守卫足以消除 node-cron 重叠触发这一现实成因。

新增回归测试：挂起首轮 `findMany` → 断言第二轮 `reentrantSkipped` 且未再捞取 → 释放后断言守卫复位（`reminder-delivery.test.ts` 末例）。

### 待审批：数据库级租约 + 持久退避（需 Schema 迁移）

剩余两项无法在进程内解决：

- **多实例部署**的重复投递需数据库级租约（`leaseUntil` / `leaseOwner`）；
- **失败退避**需持久字段（`nextAttemptAt`）——当前失败行回 `PENDING` 且 `registeredAt` 不变，永远排在取数队首，`MAX_ATTEMPTS=5` 使其有界但不消除对 take 窗口的占用。

**吞吐**（20 条 / 2 分钟 = 600 条/小时）建议随该批次一并调整：09:00 全量补扫一次性登记当日全部档位，叠加失败占位，「今天到期」的提醒可能延迟数小时。

迁移 SQL 已生成（**未改 `prisma/schema.prisma`，未在主库执行**），纯增量、无数据转换、无破坏性：

```sql
-- AlterTable
ALTER TABLE "reminder_delivery" ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "reminder_delivery_status_nextAttemptAt_idx" ON "reminder_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "reminder_delivery_leaseUntil_idx" ON "reminder_delivery"("leaseUntil");
```

已在探针库 `lawlink_upgrade_probe` 试执行通过（三列与两索引均建立）。实施建议复用仓库自有范式 `cron/queue.ts` 的 `claimDueJobs` + `recoverStaleLeases`，并与 F-1 Phase C（登记/投递分离）合并规划。

**仍未实测**：多实例下的重复投递（需真实多进程场景）。

## 六、法律层：一处待核（未核验，不得作为结论）

`holidays.ts` 的 `WORKDAY` 处理（调休上班的周末不视为休假日、不顺延）涉及：

**《最高人民法院关于调休后的工作日、节假日是否适用期间顺延规定的批复》（〔2016〕最高法刑他142号，2016-04-29，现行有效）**

- **已核验**：标题、文号、发布机关、发布日期、时效性（北大法宝 MCP；元典余额不足）。
- **未核验**：**批复正文**——该文件在北大法宝无条文结构，`article` 字段返回为空。

代码方向与该批复所要解决的问题一致，但**口径是否与批复结论吻合本轮未能核实**。该批复同时影响刑事与民事期间计算，建议由叶森核对原文后确认。

**补充：检索到两个直接相关的裁判，佐证代码两条核心逻辑（裁判佐证不等于批复原文，仍不作为终局结论）**：

| 裁判 | 与代码的对应 |
|---|---|
| **(2020)川15民终906号**（宜宾中院，案外人执行异议之诉二审） | 因大会调休，当地 5/9(四)、5/10(五) 休息，5/11、5/12 周末上班。法院认定「**2019年5月12日（星期日）由法定节假日调整为工作日，2019年5月13日为法定节假日后的第一个工作日**」，据此定起诉期间届满日为 13 日 → 佐证 `WORKDAY` 分支：调休上班日不视为休假日、不顺延 |
| **(2025)湘1002执异207号**（郴州北湖区法院，执行异议） | 「因某年某月某日系星期六(法定休假日)，根据《中华人民共和国民法典》第二百零三条第一款…最迟可在法定休假日结束的次日支付」→ 佐证周末按法定休假日顺延 |

两例均经北大法宝案例库检索确认案号与裁判要旨。

**本轮已核验法条**（均现行有效）：《民事诉讼法》（2023修正）第八十五条、《民法典》第二百零三条、《民法典》第一百八十八条。

---

## 七、建议并入 AGENTS.md 的记录

```
- **第七轮体检与修复（2026-09-21，报告 docs/SYSTEM-AUDIT-20260921-ROUND7-v2.md，v1 已作废）**：
  已修——① 迁移基线升级路径实测（P3018 阻断后续迁移）并写入 RELEASE-GUIDE/README；
  ② 审计标签 48/199 动作与 10 个对象降级为「其他操作/其他对象」（含证件号明文查看、
  财务更正、二次验证变更），一次补齐 49 词条 + 10 对象标签并加元测试防回归；
  ③ window.prompt 违反交互铁律（全仓孤例）改 promptDialog；④ 借阅待审取数窗口在资格
  过滤前导致有资格者漏看；⑤ registerReminderDelivery 重武装返回值与统计分叉；
  ⑥ 重算警告被尾部截断 + 顺延口径定为「提示不生效」；⑦ P3×4。763 测试全绿。
  未修（待审批）——P2-1 台账投递器缺租约/退避/吞吐，需 Schema 迁移，与 F-1 Phase C 合并规划。
  待核法律点——〔2016〕最高法刑他142号批复正文未核验（WORKDAY 口径依据）。
  审计方法补充——「某处缺少 X」的指控必须读完该函数/模块的完整数据流出口，
  不得在中途下结论（v1 的 P1-1 与第六轮 P1-5 同型错误）。
```

---

## 八、未覆盖（如实声明）

- **未做**：浏览器端金线走查（AGENTS §七的 UI 验收）。本轮为静态审计 + 单测/构建 + 迁移实测。
- **未实测**：P2-1 的重入重复投递（并发推演）。
- **未审**：AI/元典外发的提示词注入面、OCR 可信度边界、短信取件平台兼容性（无真实样本）。
- **未审**：`src/components/` UI 层一致性。
- **探针库**：`lawlink_upgrade_probe`、`lawlink_upgrade_probe2` 保留于本机 Postgres 供复核，未触碰主库；清理另行确认。

---

*本轮为授权下的「发现＋修复」批次，非纯发现态。所有改动均在本地验证通过，未提交、未推送、未部署。*
