# LawLink 第六轮全系统体检报告 v2（2026-09-20）

> **本版取代 v1**（`SYSTEM-AUDIT-20260920-ROUND6.md`，原件保留未改）。
> v1 的两条头牌 P1 经叶森独立核对后证伪或收窄，已按实证修正；修订依据见文末 §七。
> **v1 不得作为修复依据使用。**
>
> 范围：代码缺陷 + 业务流程与功能目的层的逻辑漏洞。
> 方法：只做发现，不改代码（遵 AGENTS.md「审计止损线：发现与修复分离」）。
> 时区口径：全系统统一按中国大陆（Asia/Shanghai, UTC+8）评判。

---

## 结论先行

1. **工程质量基线是好的**：lint / typecheck / build 全干净，689 测试全绿。前五轮审计确实把权限、事务、状态门禁压下去了。
2. **真正的问题在进程边界之外**：提醒发不出去、备份存不下来、官方部署起不来。这些不会被任何单元测试发现，因为测试从不跨出进程。
3. **最优先的一条是：官方 Docker 部署路径当前完全不可用。** compose 文件非法（整体，不只 dev profile）+ 备份链三处断裂。对一个「开源自部署」产品，这是交付层面的阻断性问题。
4. **最严重的一类是静默失败**：保全提醒漏发无补偿、SMTP 未配置静默跳过。一个不报错的提醒系统比没有提醒系统更危险，因为它会被信任。
5. 功能层最大缺口：**系统自称做「法定期限管理」，但 12 条预置规则里没有诉讼时效，也没有举证期限**——律师执业风险最高的两类期限恰好不在覆盖范围内。

---

## 一、验证基线（本轮实跑）

| 命令 | 结果 |
|---|---|
| `npm run lint` | 干净 |
| `npm run typecheck` | 干净 |
| `npm run build` | 成功 |
| `npx vitest run` | 88 文件 / 689 用例全绿 |

工作区 62 个未提交改动，基线测于这批改动之上。

**这组绿灯能证明什么**：类型、语法、纯函数逻辑、被 mock 的服务层分支。
**不能证明什么**：cron 是否真跑、邮件是否真发出、pg_dump 是否存在、镜像能否构建、compose 能否解析。本报告的全部 P1 都落在后者。

---

## 二、P1：上线前必须解决

### P1-1　官方 Docker 部署路径完全不可用

**位置**：`docker-compose.yml:41-52`、`Dockerfile`、`scripts/backup.sh:18`、`src/server/cron/jobs/backup-database.ts:29,43`

两个独立问题叠加，合并为一条处理：

**(a) compose 文件整体非法。** `mailpit` 被写进了顶级 `volumes:` 而非 `services:`：

```yaml
volumes:
  postgres_data:
  app_storage:
  mailpit:                      # ← volumes 的子键
    image: axllent/mailpit:latest
    ports: [...]
```

实跑 `docker compose config` 报错：

```
volumes.mailpit additional properties 'image','ports','profiles','restart' not allowed
```

**这不只影响 dev 收件箱——整个文件无法解析，`--profile full` 的正式部署同样起不来。**

**(b) 备份链三处断裂。** 备份默认开启（`BACKUP_CRON_ENABLED !== "false"`），但在官方镜像里必然失败：

1. **`scripts/` 目录根本没有 COPY 进 runner 镜像** —— `BACKUP_SCRIPT = process.cwd()/scripts/backup.sh` 指向一个不存在的文件。
2. 即便存在，runner 是 `node:22-alpine`，**没有 `bash`**（代码用 `spawn("bash", ...)`，alpine 只有 sh），也**没有 `postgresql-client`**（无 pg_dump）。
3. **输出目录没有挂卷**：默认 `/app/backups`，compose 只挂了 `app_storage → /app/storage`。即便备份成功，容器重建即全部消失——备份与数据同生共死。

附带：`scripts/backup.sh:18` 读 `STORAGE_PATH`，而应用用 `APP_STORAGE_DIR`（compose 里设的也是它）。部署方一旦自定义存储目录，备份脚本会安静地打包一个空目录。`STORAGE_PATH` 这个名字应当修掉，不是文档化。

**失败并非完全无痕**（v1 表述有误）：`backup-database.ts` 失败时会 `notifyAdmins` 给超管发站内 HIGH 通知并写审计。但结合 P1-3，站内通知可能无人看见。

**为什么这条排第一**：「数据在律所自己服务器，不被 SaaS 厂商绑架」是本产品第一卖点，兑现条件是装得起来 + 备得下来。当前两者都不成立。

**建议**：`mailpit` 移回 `services:`；runner 阶段 `COPY scripts ./scripts` + `apk add --no-cache bash postgresql-client`（版本对齐 postgres:16）；compose 增加 backups 卷并在文档中要求指向宿主机/异地路径；`STORAGE_PATH` 统一为 `APP_STORAGE_DIR`；首次启动自检（compose 可解析 + pg_dump 可执行 + 备份目录可写）。

---

### P1-2　保全续封提醒漏发无补偿机制

**位置**：`src/server/cron/jobs/scan-due-reminders.ts:97-99`

> v1 把期限/开庭也算进来，**这部分已证伪**：`scheduler.ts:159-166` 每 2 分钟跑 `scanScheduleReminders(now, shParts(now).hh < 9)`，09:00 后为全量档位补扫，当天恢复即补上。本条**只对保全成立**。

保全提醒挂在每日 09:00 的 `scanDueReminders` 单次 job 上，按「今天恰好等于某档位」触发：

```ts
const isCritical = daysUntil === 0 || daysUntil === -1;
if (!isCritical && !cs.remindDays.includes(daysUntil)) continue;
```

去重靠「今天是否已有同 refType 通知」，只能防重复，不能补漏。**09:00 前后服务器重启、部署或停机，该日档位（30/15/7/3/1）永久跳过，不会补发。**

**严重性需要如实收窄**（v1 言过其实）：若错过 `daysUntil === 0` 与 `-1`，下一次成功扫描的 lapsed 分支仍会把过期保全置 `EXPIRED` 并发 URGENT 通知，延迟最多约一天。所以后果是**提醒延迟与提前量丧失**（30 天档错过后要等 15 天档），不是「完全无人知情」。

但提前量本身就是这条提醒的全部价值：《查扣冻规定》（2020修正）第二十七条（已核验，现行有效）——「查封、扣押、冻结期限届满，人民法院未办理延期手续的，查封、扣押、冻结的效力消灭。」续封要备材料、跑法院、等裁定，事后知道「已经消灭」没有意义。

**建议**：保全提醒纳入与日程提醒同一套补扫机制，或直接采用 §三 F-1 的送达台账方案。

---

### P1-3　保全续封提醒不校验接收人是否在职

**位置**：`src/server/cron/jobs/scan-due-reminders.ts:102-103`

```ts
const userId = cs.ownerId ?? cs.matter?.ownerId;
if (!userId) continue;
```

对比 `src/server/reminders/schedule.ts:48` 的期限/开庭提醒：

```ts
const isEnabled = (user) => user?.active && (user.role !== "CUSTOM" || user.roleDefinition?.active);
```

期限路径有三级回退 + 逾期升级（`escalateOverdueDeadlineToTeamLeaders`），保全路径两者皆无。律师离所后，其名下保全的续封提醒全部投进一个永不登录的账号。

**口径是倒置的**：保全的后果（效力消灭、财产被转移、不可逆）比多数期限更重，风险处理却更弱。

**建议**：`isEnabled` 提成共用判定；无合格接收人时按 `recordOffboardingRisk` 升级；为保全补逾期升级链。

---

### P1-4　默认部署下提醒没有站外出口，且失败是静默的

**位置**：`src/lib/notifications/email.ts:13`、`src/server/cron/worker.ts:47`、`.env.example:52,57`

```ts
export function isEmailConfigured() { return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM); }
// worker:
if (!isEmailConfigured()) return;   // 静默完结，不报错、不留痕
```

`.env.example` 中 `SMTP_HOST=` 与 `MAIL_FROM=` 均为空。**按官方示例装完的系统，期限提醒只存在于站内铃铛里**，律师不登录就收不到，而系统不会告诉任何人「提醒没有外发通道」。

Webhook 至少有 `saveWebhookLastResult` 可在后台查看结果；**邮件连这个都没有**。

这一条与 P1-1(a) 互为因果：本地开发的 mailpit 收件箱从来没能启动过，所以邮件外发链路从未被真正验证过一次。

**建议**：未配置外发通道时，在管理后台与工作台显示持续可见的配置缺口警示（与角色页「无 finance.confirm 持有者」同款红黄提示）；跳过也要写台账，不要裸 `return`。

---

## 三、P2

### P2-1　期限引擎的纵深防御缺失（v1 原 P1-5，已降级并修正机制）

**v1 的机制描述是错的，须作废**：v1 称「境外浏览器届满日偏一天」，并给出一段「实测」。该实测把上海午夜的**绝对瞬间**（`new Date("2026-07-01T00:00:00+08:00")`）直接喂给 `computeDeadlineDate`——**生产代码不存在这种喂法**。

实际三个调用方全部走 civil 载体模式，本地构造 + 本地读取，任意时区浏览器结果相同：

| 调用方 | 构造方式 |
|---|---|
| `procedure-forms.tsx:389,393` | `shDayKey(new Date())` → `new Date("YYYY-MM-DDT00:00:00")` 本地午夜载体（代码注释已写明「浏览器内自洽」） |
| `deadline-rules-card.tsx:156` | `shTodayCivil()` 本地正午载体 |
| `preservation-defaults.ts` → `preservation-dialog.tsx` | `civilFromKey(dateString)` 本地正午载体 |

`sh-time.ts` 官方推荐的 `civilFromKey` 内部同样是本地构造 + 本地读取。**在统一中国大陆时区口径下，现状不产生错误日期。**

**真正成立的两点**（P2 级加固，非 P1）：

1. **服务端不复核**。`src/server/procedures/actions.ts:435` 的 `addDeadline` 接受 `dueAt` + `sourceRuleId`，只凭 `sourceRuleId` 是否存在决定 `confirmStatus`，从不验证 `dueAt` 与该规则推算结果一致。一条标着「依据民诉法第八十五条自动生成」的期限，服务端自己没算过也没验过。现由「PENDING + 律师确认」兜底，但那是人工兜底，不是系统复核。
2. **测试跨时区盲区**。`src/tests/lib/deadline-rules.test.ts:9` 的 `d = (s) => new Date(`${s}T00:00:00`)` 与 `formatLocalDate` 同源，任何时区都自洽通过。第五轮已把 reports-period 改成上海口径断言，本文件同样处理即可闭环。

**法条**（已核验）：《民事诉讼法》（2023修正）第八十五条——「期间以时、日、月、年计算。期间开始的时和日，不计算在期间内。」代码对「开始之日不计入」的实现**正确**。

**建议**：`addDeadline` 按 `sourceRuleId` 服务端重算比对；`deadline-rules.test.ts` 加 `TZ=UTC` / `TZ=Asia/Shanghai` 双跑断言；期限引擎显式改上海日历口径（规则一致性，非纠错）。

---

### P2-2　冲突检索的模糊匹配是单向的，且没有名称归一

**位置**：`src/server/conflicts/algorithm.ts:264, 306, 441, 463`

```ts
name: { contains: name, mode: "insensitive" }   // 只能命中「历史名 ⊇ 查询名」
```

精确分支用 `p.name === name`，模糊分支用 `contains 查询名`。**反向漏检**：新收案录全称「广东嘉吉贸易有限公司」，历史案件当年录的是简称「嘉吉贸易」——精确不中、`contains` 也不中，**该冲突不会被发现**。

同时无任何名称归一：`有限公司`/`有限责任公司`、全半角括号、`（广州）` 地域前缀、繁简差异，均造成漏检。

**这条不能按普通 bug 对待**：利冲漏检的代价是执业违规。系统把「候选 OPPOSING_PARTY × 历史 CLIENT_PARTY」定为 BLOCKING，设计意图正确，但只要录入详略不同，这条 BLOCKING 就检不出来。

**建议**：双向包含 + 归一化后比对，归一命中降一级严重度并标注「归一化匹配」，交律师判断。

---

### P2-3　邮件摘要一天只取 500 条通知，超出部分静默丢弃

**位置**：`src/server/cron/worker.ts` `emailDigestHandler`

```ts
const notes = await prisma.notification.findMany({ where: { createdAt: { gte: startOfToday } }, ..., take: 500 });
```

全所当日通知按 `createdAt asc` 取前 500 条再按人聚合。中等规模律所一天超过 500 条不难，**超出的恰是当天较晚产生、往往更紧急的那些**，不出现在任何人的摘要里，且无提示。

**建议**：按用户分页聚合，不能用全局 take 截断。

---

### P2-4　预置期限规则不含诉讼时效与举证期限

**位置**：`prisma/seeds/v49-deadline-rules.ts`，**共 12 条**，category 分布：APPEAL×6、RESPONSE×3、ARBITRATION_SET_ASIDE×1、ENFORCEMENT×1、PRESERVATION×1。

（v1 误记为 13 条含 `OTHER×1`——那条 `OTHER` 来自 `v08-templates-and-seals.ts:47` 的模板分类，`DeadlineCategory` 枚举中并无 OTHER。）

枚举里有 `LIMITATION`（诉讼时效）与 `EVIDENCE`（举证期限），**一条预置规则都没有，也无生成入口**。

《民法典》第一百八十八条（已核验，现行有效）：「向人民法院请求保护民事权利的诉讼时效期间为三年……自权利人知道或者应当知道权利受到损害以及义务人之日起计算……自权利受到损害之日起超过二十年的，人民法院不予保护。」

**建议**：补 LIMITATION 规则（3 年普通时效 + 20 年最长保护期，起算事实由律师填「知道或应当知道之日」）与 EVIDENCE 模板；收案登记时对民商事案件提示登记时效起算点。

---

### P2-5　「待确认实收通知」路径零有效覆盖

**位置**：`src/server/finance/actions.ts:208-221`、`src/tests/server/bugfix-regressions.test.ts:226,236,244`

跑测试时三个用例均在 stderr 打出：

```
[finance] 待确认实收通知发送失败： TypeError: Cannot read properties of undefined (reading 'map')
    at usersWhoCanConfirmReceipt (src/server/finance/actions.ts:221)
```

生产代码本身没问题，问题是 mock 未提供 `prisma.user.findMany`，**通知分支全程走 catch，三个用例的断言仍然通过**。「登记待确认实收 → 通知有权确认的人」这条链路在测试里从未真正执行过。

叶森核对补充：名为「通知发送失败不影响登记」的用例 mock 的是 `notifyRoleApprovers`，**该函数根本不在此路径上**——断言的确实是 mock 缺失，不是业务容错。

**建议**：补 mock 并断言收件人集合；把「通知失败」计入可见台账（与 P1-4 同一机制）。

---

## 四、P3（低危，可合批）

| 编号 | 位置 | 问题 |
|---|---|---|
| P3-1 | `src/lib/auth/options.ts:118-123` | 登录成功后更新 `lastLoginAt`/清零失败计数是 fire-and-forget 且空 catch。失败时计数不清零，用户后续少量失败即被锁定，无任何痕迹。 |
| P3-2 | `src/server/dashboard/actions.ts:523-524`、`src/server/finance/aging.ts:46` | 金额汇总用 `Number()` 浮点相减累加，与全系统 Decimal 口径不一致；展示层误差。 |
| P3-3 | `src/lib/net/safe-url.ts:23-27` | SSRF 校验先 `dns.lookup` 再 `fetch`，两次解析间存在 DNS rebinding 窗口（TOCTOU）。重定向已逐跳复验，做得好；仅剩此理论窗口。 |
| P3-4 | `.env.example` | 真正缺失的只有 `AUDIT_RETENTION_DAYS` 与 `DISABLE_CRON`。（v1 误列 `STORAGE_PROVIDER`/`S3_*`/`AWS_*`/`BACKUP_*`——这些已以注释形态存在于 26-45 行；`STORAGE_PATH` 属 P1-1 的 bug，应修掉而非文档化。） |
| ~~P3-5~~ | `schedule-view.tsx:169-176`、`preservation-defaults.ts:63,70` | **已撤销**。二者均经 civil 载体（`shTodayCivil()`/`civilKey`/`new Date(y,m,d,12)`），本地构造+本地读取为时区无关的确定性运算。违反 AGENTS 规则字面，不产生实际偏移，按代码规范整改即可，非缺陷。 |

---

## 五、流程与功能目的层

这一节不看代码对不对，只问：**律师照系统说的做，会不会出事。**

### F-1　提醒系统没有「送达」概念，只有「创建」概念

系统能回答「今天发了多少条提醒」，但回答不了：这条期限应该提醒几次？实际几次？有没有该发没发？律师看到了吗？

现模型是「扫描 → 创建 Notification → 结束」。日程侧已有每 2 分钟补扫（做得对），但保全侧没有；外发结果只有 webhook 有台账，邮件没有；通知是否被读不成体系。P1-2 / P1-3 / P1-4 / P2-3 / P2-5 都是这个缺失的不同表现。

**这是本轮最值得做的结构性修改**：建一张提醒送达台账（对象 × 档位 × 应发时间 × 实发时间 × 通道 × 结果），所有扫描改为对账式补发。做完之后上述五条会一起消失，而不是各修各的——符合 AGENTS「类修复优先于点修复」。

### F-2　保全默认期限取的是法定上限，但法院实际裁定常常更短

`PRESERVATION_DURATION_YEARS` 按《民诉法解释》（2022修正）第四百八十五条取 1/2/3 年（已核验，**数值与依据均正确**）。但法条写的是「**不得超过**」——是上限，不是默认值。实务中法院冻结存款常裁定 6 个月或 1 年以内的具体期限，协助执行通知书载明到期日。

系统把上限当默认值并据此推算到期日。**若法院实际裁定更短而律师沿用默认值，续封提醒会晚于真实届满日**——这正是「效力消灭」发生的方式。

**建议**：把「法院载明的到期日」作为第一事实录入项（必填），系统推算值降级为校验提示（「你填的到期日短于法定上限，确认无误？」）。原始事实优先于推算，与系统已有的「来源原件 / AI 提取 / 律师确认三层分离」哲学一致。

### F-3　冲突检索不看关联方

现只比对当事人名称与证件号。实务利冲审查通常还要看：同一法定代表人、控股股东、母子公司、关联企业。系统**已接入元典企业库**（能查工商、股东、对外投资），冲突检索却无任何引用。

不是 bug，是能力没接通。Party 已存 `enterpriseSocialCode` 并支持绑定企业，做一层「关联方提示（不阻断，仅提示人工判断）」边际成本很低。

### F-4　人员离所只有「通知」，没有「接管」

`recordOffboardingRisk` 在停用时给持有 `matters.transfer` 的人发 URGENT 通知，无合格接收人时通知 SUPER_ADMIN——兜底设计是清醒的。但**实际接管动作仍未实现**（AGENTS backlog 第 7 项标注「完整接管链在 B 批」，而 B 批做的是短信专项）。

结果：律师离所当天，其名下保全提醒继续发给停用账号（P1-3），案件责任悬空，只有一条「有 N 项责任待交接」的通知，没有任何页面能一键完成交接。小律所人员流动是常态。

### F-5　节假日顺延只提示不计算

`HOLIDAY_NOTE` 提示人工核对，系统不内置节假日表——理由（每年国务院调整）成立。但结果是**系统算出的届满日在每年春节、国庆前后不可直接采信**，而这恰是最容易算错、后果最严重的时段。

《民事诉讼法》第八十五条第三款（已核验）：「期间届满的最后一日是法定休假日的，以法定休假日后的第一日为期间届满的日期。」

**建议**：做成可配置的年度放假安排表——管理后台录入当年国务院通知（每年一次，几分钟），系统据此自动顺延并标注依据。比内置会过期的硬编码表好，也比完全不做好。

### F-6　「已归档」之后的动线是空的

归档做得很重（收尾清单、一致性指纹、审批、不可变），但归档**之后**没有调卷线。律所真实需求：客户回头咨询、案件再审、律协检查、税务核查。全仓检索无借阅/调卷工作流（仅水印文案提到「借阅」）。

补充归档解决「往里加」，不解决「拿出来看」。对以档案管理为核心价值之一的系统，这是功能终点缺失。

---

## 六、本轮未覆盖 / 未验证（如实声明）

- **未做**：浏览器端金线走查（AGENTS 第七节要求的 UI 验收）。本轮是静态审计 + 单测/构建验证，未起服务走页面。
- **未验证**：多用户并发下的事务行为（Serializable 冲突重试、advisory lock 竞争）——需压测环境。
- **部分验证**：P1-1(a) 的 compose 非法经叶森实跑 `docker compose config` 确认；(b) 的镜像内容基于 Dockerfile 静态阅读，**未实际构建镜像跑一次备份**，修复前建议实测。
- **未审**：AI 与元典外发的提示词注入面、OCR 结果可信度边界、短信取件对具体法院平台的兼容性（无真实样本）。
- **未审**：`src/components/` 的 UI 层一致性（v4 墨案重建属另一条线）。

---

## 七、v1 → v2 修订记录

叶森独立核对全部发现并逐条验证证据，本版据此修正。修正项及其性质：

| 项 | v1 结论 | v2 结论 | 我的错误性质 |
|---|---|---|---|
| 原 P1-5 期限时区 | P1：境外浏览器届满日偏一天，附「实测」 | 降为 P2-1：机制不成立；成立的是服务端不复核 + 测试盲区 | **方法错误**——构造了生产代码不存在的输入（绝对瞬间 vs civil 载体），再以其输出当作生产会出错的证据 |
| 原 P1-1 提醒漏发 | P1：期限/开庭/保全档位全部永久跳过 | 收窄为 P1-2：仅保全成立；期限/开庭有每 2 分钟补扫；保全后果收窄为「延迟+提前量丧失」而非「完全无人知情」 | **核查不完整**——只读了 `scheduler.ts` 头部注释，漏了第 159 行的补扫注册与 lapsed 分支 |
| 原 P2-3 compose | P2：dev 收件箱起不来 | 升级并入 P1-1：整个文件非法，正式部署同样起不来 | 低估（未实跑 `docker compose config`） |
| 原 P1-4 备份 | 三处断裂；「只写审计」 | 四处断裂（补 `scripts/` 未 COPY）；失败有 notifyAdmins | 遗漏 + 表述不准 |
| 原 P2-4 种子 | 13 条，含 `OTHER×1` | 12 条；`OTHER` 来自模板分类，与 DeadlineCategory 无关 | **统计方法不严谨**——grep 跨文件跨模型计数 |
| 原 P3-5 env | 缺 7 项 | 实缺 2 项（`AUDIT_RETENTION_DAYS`/`DISABLE_CRON`） | **检索方法有缺陷**——`grep -v '^#'` 过滤掉了注释形态的变量声明 |
| 原 P3-2/P3-6 | 时区缺陷 | 撤销：civil 载体，时区无关；属规则一致性 | 同原 P1-5 的方法错误 |
| 基线 | 61 个未提交改动 | 62 个 | 计数偏差 |
| §六 协作风险 | zcode-cli 疑似并发写 | 即叶森本人核对会话，只读，无并发写冲突 | 误判 |

**教训（供后续审计复用）**：涉及时区的断言，必须先确认**生产调用方实际传入什么**，再构造测试输入；不得用自造输入反推生产行为。涉及「机制缺失」的断言，必须读完该机制的全部注册点，不能以模块头部注释为准。

---

## 八、法条核验记录

元典 MCP 本次返回「账户可用余额不足」，按 CLAUDE.md 约定改用北大法宝 MCP：

| 法条 | 要点 | 时效性 | 用于 |
|---|---|---|---|
| 《民法典》第一百八十八条 | 诉讼时效三年；自知道或应当知道之日起算；最长 20 年 | 现行有效 | P2-4 |
| 《民事诉讼法》（2023修正）第八十五条 | 期间计算；开始之日不计入；届满日为法定休假日顺延 | 现行有效 | P2-1、F-5 |
| 《民诉法解释》（2022修正）第四百八十五条 | 冻结存款≤1年、查扣动产≤2年、不动产及其他财产权≤3年；续行期限不超过前款 | 现行有效 | F-2 |
| 《查扣冻规定》（2020修正）第二十七条 | 期限届满未办延期手续的，效力消灭 | 现行有效 | P1-2、P1-3 |

`src/lib/preservation-defaults.ts` 的法条引用与年限数值经本轮复核**准确无误**；`src/lib/deadline-rules.ts` 对第八十五条「开始之日不计入」的实现亦**正确**。

---

## 九、建议的处理顺序

1. **P1-1**（compose 非法 + 备份链）——阻断官方部署，最优先；修完需实构建镜像验证。
2. **P1-3**（保全接收人在职校验）——改动小、风险大，可与 P1-2 合并。
3. **P1-4**（外发通道缺口警示）——低成本高收益。
4. **F-1 送达台账**——结构性方案，做完顺带解决 P1-2 / P2-3 / P2-5。
5. **P2-1 / P2-2 / P2-4**——进 backlog 排期。
6. P3 组合批处理。

---

*本报告遵「发现与修复分离」，未包含任何代码改动。v1 保留于 `SYSTEM-AUDIT-20260920-ROUND6.md`，仅供修订对照，不得作为修复依据。*
