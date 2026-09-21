# LawLink 第六轮全系统体检报告（2026-09-20）

> 范围：代码缺陷 + 业务流程与功能目的层的逻辑漏洞。
> 方法：本轮只做**发现**，不改代码（遵 AGENTS.md「审计止损线：发现与修复分离」）。
> 基线：工作区有 61 个未提交改动，且检查期间另有 zcode-cli 进程 cwd 指向本仓库（违反单写者原则，见 §六）。

---

## 结论先行

1. **工程质量基线是好的**：lint / typecheck / build 全干净，689 个测试全绿。前五轮审计确实把权限、事务、状态门禁这些「代码正确性」问题压下去了。
2. **但本轮发现的问题集中在另一层：系统的承诺在真实部署里兑现不了。**代码是对的，链路是断的——提醒发不出去、备份存不下来、期限算在浏览器里。这些不会被任何单元测试发现，因为测试从不跨出进程边界。
3. **最严重的一类是「静默失败」**：提醒漏发无补偿、SMTP 未配置静默跳过、备份 cron 在官方镜像里必然失败。对律师而言，一个不报错的提醒系统比没有提醒系统更危险——因为它会被信任。
4. 功能层最大的缺口是：**系统自称做「法定期限管理」，但预置规则里没有诉讼时效，也没有举证期限**——律师执业风险最高的两类期限恰好不在覆盖范围内。

优先级建议：P1-1 ~ P1-5 属于「上线前必须解决」，P2 进 backlog 排期，P3 与产品层建议按批次合并。

---

## 一、验证基线（本轮实跑）

| 命令 | 结果 |
|---|---|
| `npm run lint` | 干净 |
| `npm run typecheck` | 干净 |
| `npm run build` | 成功 |
| `npx vitest run` | 88 文件 / 689 用例全绿 |

**这组绿灯能证明什么，不能证明什么**：能证明类型、语法、纯函数逻辑与被 mock 的服务层分支是对的；不能证明进程外的任何事——cron 是否真在跑、邮件是否真发出、pg_dump 是否存在、浏览器时区是否为 UTC+8。本轮所有 P1 都落在后者。

---

## 二、代码层缺陷

### P1-1　提醒漏发没有补偿机制，停机一天即永久跳过该档

**位置**：`src/server/cron/jobs/scan-due-reminders.ts:97-99`；`src/server/cron/scheduler.ts:10-11`（注释自承）

提醒按「今天恰好等于某个提前档」触发：

```ts
const isCritical = daysUntil === 0 || daysUntil === -1;
if (!isCritical && !cs.remindDays.includes(daysUntil)) continue;
```

去重靠「今天是否已有同 refType 通知」，**只能防重复，不能补漏**。调度器是进程内 node-cron，其注释已写明「如果在触发时间点重启，可能错过本次」。

**后果**：服务器在 09:00 重启、部署、崩溃，或当天停机，则该日所有档位（保全的 30/15/7/3/1 天，期限的 -3/-1/0/+1）**永久跳过，不会补发**。保全若错过 `daysUntil === 0` 与 `-1`，则律师对「效力消灭」毫不知情。

**法条后果**（已核验，现行有效）：《最高人民法院关于人民法院民事执行中查封、扣押、冻结财产的规定》（2020修正）第二十七条——「查封、扣押、冻结期限届满，人民法院未办理延期手续的，查封、扣押、冻结的效力消灭。」

**建议方向**：把「档位匹配」换成「送达台账比对」——为每个提醒对象 × 每个档位建持久记录（应发时间、实发时间、失败原因），扫描时取「应发而未发」的全集，天然支持补发与可观测。

---

### P1-2　保全续封提醒不校验接收人是否在职，且无逾期升级

**位置**：`src/server/cron/jobs/scan-due-reminders.ts:102-103`

```ts
const userId = cs.ownerId ?? cs.matter?.ownerId;
if (!userId) continue;
```

对比 `src/server/reminders/schedule.ts:48` 的期限/开庭提醒：

```ts
const isEnabled = (user) => user?.active && (user.role !== "CUSTOM" || user.roleDefinition?.active);
```

**两条提醒路径口径不一致**。保全提醒直接发给 `ownerId`，不检查该账号是否已停用、角色是否已停用。律师离所后，其名下保全的续封提醒全部投进一个永不登录的账号，静默消失。

同时，期限有 `escalateOverdueDeadlineToTeamLeaders` 逾期升级，**保全没有**——而保全的后果（效力消灭、财产被转移、不可逆）比多数期限更重。风险处理是倒置的。

**建议**：`isEnabled` 提成共用判定，保全路径复用；无合格接收人时按 `recordOffboardingRisk` 的方式升级；为保全补逾期升级链。

---

### P1-3　默认部署下提醒没有站外出口，且失败是静默的

**位置**：`src/lib/notifications/email.ts:13`；`src/server/cron/worker.ts` 的 `emailDigestHandler`；`.env.example:52,57`

```ts
export function isEmailConfigured() { return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM); }
// worker:
if (!isEmailConfigured()) return;   // 静默完结，不报错、不留痕
```

`.env.example` 中 `SMTP_HOST=` 与 `MAIL_FROM=` 均为空。**按官方示例装完的系统，期限提醒只存在于站内通知铃铛里**；律师不登录就完全收不到，而系统不会告诉任何人「提醒没有外发通道」。

Webhook 至少有 `saveWebhookLastResult` 可在后台看结果；邮件连这个都没有。

**建议**：① 未配置外发通道时，管理后台与工作台显示持续可见的配置缺口警示（与角色页「无 finance.confirm 持有者」的红黄提示同款）；② 跳过也要写台账，不要 `return`。

---

### P1-4　官方 Docker 部署的备份链条是断的（三处叠加）

**位置**：`Dockerfile`、`docker-compose.yml`、`scripts/backup.sh:18`、`src/server/cron/jobs/backup-database.ts:29,43`

备份默认开启（`process.env.BACKUP_CRON_ENABLED !== "false"`），但在官方镜像里必然失败：

1. **runner 阶段是 `node:22-alpine`，没有装 `bash`，也没有 `postgresql-client`**。而 job 用 `spawn("bash", [BACKUP_SCRIPT, baseDir])` —— alpine 只有 `sh`，这一步直接 ENOENT；即便有 bash，脚本里的 `pg_dump` 也不存在。
2. **备份输出目录没有挂卷**。默认 `BACKUP_DIR = process.cwd()/backups` = `/app/backups`，而 compose 只挂了 `app_storage → /app/storage`。就算备份成功，文件也写在容器可写层里，**容器重建即全部消失**——备份和数据同生共死，等于没有备份。
3. **变量名不一致**：`scripts/backup.sh:18` 读 `STORAGE_PATH`，而应用用的是 `APP_STORAGE_DIR`（compose 里设的也是它）。部署方一旦自定义存储目录，备份脚本会安静地打包一个空目录。`STORAGE_PATH` 在 `.env.example` 里根本不存在。

**为什么这条重要**：「数据在律所自己服务器，不被 SaaS 厂商绑架」是本产品的第一卖点。卖点的兑现条件是备份可用。现在的状态是：系统每天尝试备份、每天失败、把失败写进审计日志，而律所以为自己有备份。

**建议**：runner 阶段 `apk add --no-cache bash postgresql-client`（版本须与 postgres:16 匹配）；compose 增加 `backups` 卷并在文档中要求指向宿主机/异地路径；统一为 `APP_STORAGE_DIR`；首次启动做一次自检（pg_dump 可执行 + 备份目录可写），失败则在后台显示红色告警而不只是审计。

---

### P1-5　法定期限计算全在浏览器完成，依赖浏览器时区，服务端不复核

**位置**：`src/lib/deadline-rules.ts:16-40`（`startOfDay` / `addDays` / `addMonthsClamped` 全部用本地时区 `getFullYear/getMonth/getDate`）；调用方只有两个，且都是客户端组件——`matters/[id]/_components/procedure-forms.tsx:395`、`admin/reminders/_components/deadline-rules-card.tsx:156`；服务端入口 `src/server/procedures/actions.ts:435` 的 `addDeadline` 直接采信客户端传来的 `dueAt`。

实测（本机 `America/Los_Angeles`，模拟容器 `TZ=UTC`，两者结果相同）：

```
触发瞬间：上海 2026-07-01 00:00（= 2026-06-30T16:00Z）
上诉期 15 日届满 = 2026-07-15   ← 法定应为 2026-07-16
```

**三个叠加问题**：

1. **计算依赖运行时本地时区**。中国境内律师的浏览器是 UTC+8，结果正确；但律师出差境外、用境外远程桌面、或系统时区设置异常时，**届满日整体偏一天**。AGENTS.md 明令「客户端组件禁止用 getHours()/getDate() 等本地时区方法做日历计算，改用 sh-time.ts」——期限引擎是这条规则最大的漏网之鱼，而它恰恰是全系统法律风险最高的模块。
2. **测试无法发现**：`src/tests/lib/deadline-rules.test.ts:9` 的 `d = (s) => new Date(`${s}T00:00:00`)` 用本地时区构造，`formatLocalDate` 用本地时区格式化，两端同源，**任何时区下都自洽通过**。这正是第五轮已识别的「TZ 自洽掩盖」在另一个文件里的重演（reports-period 已改上海口径断言，这里没改）。
3. **服务端没有对应实现，无法复核**。`addDeadline` 接受 `dueAt` + `sourceRuleId`，落库时只凭 `sourceRuleId` 是否存在决定 `confirmStatus`，**从不验证 dueAt 与该规则推算结果是否一致**。结果是：一条标着「依据民诉法第八十五条自动生成」的期限，其日期值系统自己没算过、也没验过。

**法条**（已核验）：《民事诉讼法》（2023修正）第八十五条——「期间以时、日、月、年计算。期间开始的时和日，不计算在期间内。期间届满的最后一日是法定休假日的，以法定休假日后的第一日为期间届满的日期。」代码对「开始之日不计入」的实现是正确的，错的只是取「日」的口径。

**建议**：期限引擎改为上海日历口径（复用 `civilFromKey` 的正午表示法）；`addDeadline` 在服务端按 `sourceRuleId` 重算一次，与提交值不符则拒绝或标注；测试断言改成跨时区显式断言（`TZ=UTC` 与 `TZ=Asia/Shanghai` 两次跑都必须过）。

---

### P2-1　冲突检索的模糊匹配是单向的，且没有名称归一

**位置**：`src/server/conflicts/algorithm.ts:264, 306, 441, 463`

```ts
name: { contains: name, mode: "insensitive" }   // 只能命中「历史名 ⊇ 查询名」
```

精确分支用 `p.name === name`，模糊分支用 `contains 查询名`。**反向漏检**：新收案录入全称「广东嘉吉贸易有限公司」，而历史案件当年录的是简称「嘉吉贸易」——`contains` 不命中，精确也不命中，**该冲突不会被发现**。

同时没有任何名称归一：`有限公司` / `有限责任公司`、全角半角括号、`（广州）` 之类地域前缀、繁简差异，都会造成漏检。

**为什么这条不能按普通 bug 对待**：利益冲突检索漏检的代价是执业违规，不是数据不准。系统把 `候选 OPPOSING_PARTY × 历史 CLIENT_PARTY` 定为 BLOCKING，设计意图是对的，但只要录入详略不同，这条 BLOCKING 就检不出来。

**建议**：双向包含 + 归一化后比对（去组织形式后缀、去括号地域、全半角统一），归一命中降一级严重度并标注「归一化匹配」，交由律师判断。

---

### P2-2　邮件摘要一天只取 500 条通知，超出部分静默丢弃

**位置**：`src/server/cron/worker.ts` 的 `emailDigestHandler`

```ts
const notes = await prisma.notification.findMany({ where: { createdAt: { gte: startOfToday } }, ..., take: 500 });
```

全所当日通知按 `createdAt asc` 取前 500 条再按人聚合。中等规模律所（20 人 × 多案件 × 多档提醒）一天超过 500 条并不难，**超出的部分——恰好是当天较晚产生的、往往更紧急的那些——不会出现在任何人的摘要邮件里**，且无任何提示。

**建议**：按用户分页聚合，或先取当日有通知的用户集再逐人取其通知；无论如何不能用全局 take 截断。

---

### P2-3　docker-compose.yml 的 mailpit 被写进了顶级 `volumes:`

**位置**：`docker-compose.yml:41-52`

```yaml
volumes:
  postgres_data:
  app_storage:

  # 本地开发用邮件收件箱（--profile dev 才启动）
  mailpit:                      # ← 这里是 volumes 的子键，不是 services
    image: axllent/mailpit:latest
    ports: ...
```

`mailpit` 成了一个「命名卷」的定义，还带着 `image`/`ports`/`profiles` 这些非法字段。**`docker compose --profile dev up` 根本起不来这个收件箱**。

这条本身只是配置错误，但它解释了 P1-3 为什么会存在：**本地开发环境里的邮件收件箱从来没能启动过，所以通知外发链路从未被真正验证过一次**。

---

### P2-4　预置期限规则不含诉讼时效与举证期限

**位置**：`prisma/seeds/`，现有 13 条规则的 category 分布为 APPEAL×6、RESPONSE×3、ARBITRATION_SET_ASIDE×1、ENFORCEMENT×1、PRESERVATION×1、OTHER×1。

`DeadlineCategory` 枚举里有 `LIMITATION`（诉讼时效）和 `EVIDENCE`（举证期限），**但一条预置规则都没有，也没有任何生成入口**。

诉讼时效是律师执业风险最高的期限类型。《民法典》第一百八十八条（已核验，现行有效）：「向人民法院请求保护民事权利的诉讼时效期间为三年……自权利人知道或者应当知道权利受到损害以及义务人之日起计算……自权利受到损害之日起超过二十年的，人民法院不予保护。」

举证期限虽由法院指定、因案而异，但至少应提供「按法院指定日录入 + 到期提醒」的规则模板。

**建议**：补 LIMITATION 规则（3 年普通时效 + 20 年最长保护期，起算事实由律师填写「知道或应当知道之日」）与 EVIDENCE 模板；收案登记时对民商事案件提示登记时效起算点。

---

### P2-5　「待确认实收通知」路径实际零有效覆盖

**位置**：`src/server/finance/actions.ts:208-221`；`src/tests/server/bugfix-regressions.test.ts:226,236,244`

跑测试时三个用例都在 stderr 打出：

```
[finance] 待确认实收通知发送失败： TypeError: Cannot read properties of undefined (reading 'map')
    at usersWhoCanConfirmReceipt (src/server/finance/actions.ts:221)
```

生产代码本身没问题（`prisma.user.findMany` 在真实环境返回数组），问题是 mock 未提供该方法，**通知分支全程走 catch，三个用例的断言却仍然通过**。也就是说「登记待确认实收 → 通知有权确认的人」这条链路，在测试里从未真正执行过——包括那条名为「通知发送失败不影响已保存的实收登记」的用例，它验证的其实是 mock 缺失，不是业务容错。

**建议**：补 mock 并断言收件人集合；同时考虑把「通知失败」计入可见的台账（与 P1-3 同一机制）。

---

### P3 组（低危，可合批处理）

| 编号 | 位置 | 问题 |
|---|---|---|
| P3-1 | `src/lib/auth/options.ts:118-123` | 登录成功后更新 `lastLoginAt` / 清零失败计数是 fire-and-forget 且 `.catch` 空吞。失败时失败计数不清零，用户后续少量失败即被锁定，且无任何痕迹。 |
| P3-2 | `src/app/(app)/schedule/_components/schedule-view.tsx:173-176` | 月历网格用 `new Date(year, month, …).getDate()/getDay()` 构造，客户端本地时区，违反 AGENTS 明令的客户端时区规则。 |
| P3-3 | `src/server/dashboard/actions.ts:523-524`、`src/server/finance/aging.ts:46` | 金额汇总用 `Number()` 浮点相减累加，与全系统 Decimal 口径不一致；展示层误差。 |
| P3-4 | `src/lib/net/safe-url.ts:23-27` | SSRF 校验先 `dns.lookup` 再 `fetch`，两次解析之间存在 DNS rebinding 窗口（TOCTOU）。重定向已逐跳复验，做得好；剩这一个理论窗口。 |
| P3-5 | `.env.example` | 缺 `STORAGE_PROVIDER`、`S3_*`/`AWS_*`、`BACKUP_CRON_ENABLED`/`BACKUP_DIR`/`BACKUP_KEEP`、`AUDIT_RETENTION_DAYS`、`DISABLE_CRON`、`STORAGE_PATH`。自部署者不知道这些开关存在。 |
| P3-6 | `src/lib/preservation-defaults.ts:63,70` | `defaultDurationDays` / `addDays` 用本地时区构造，与 P1-5 同源。 |

---

## 三、流程与功能目的层的逻辑漏洞

这一节不看代码对不对，只问：**律师照系统说的做，会不会出事。**

### F-1　提醒系统没有「送达」概念，只有「创建」概念

系统能回答「今天发了多少条提醒」，但回答不了这三个问题：

- 这条期限**应该**提醒几次？实际提醒了几次？
- 有没有哪条提醒**该发而没发**？
- 律师**看到**了吗？

现在的模型是「扫描 → 创建 Notification → 结束」。Notification 有没有被读、有没有外发成功、某个档位是否被跳过，都不成体系。P1-1 / P1-2 / P1-3 / P2-2 全是这个缺失的不同表现。

**这是本轮最值得做的一次结构性修改**：建一张提醒送达台账（对象 + 档位 + 应发时间 + 实发时间 + 通道 + 结果），所有扫描改为「对账式补发」而非「档位命中式触发」。做完之后，上述四条 P1/P2 会一起消失，而不是各修各的。

### F-2　保全默认期限取的是法定上限，但法院实际裁定常常更短

`PRESERVATION_DURATION_YEARS` 按《民诉法解释》（2022修正）第四百八十五条取 1/2/3 年（已核验，数值与依据都正确）。但法条写的是「**不得超过**」——是上限，不是默认值。实务中法院冻结存款常裁定 6 个月或 1 年以内的具体期限，协助执行通知书上写明到期日。

系统当前把上限当默认值并据此推算到期日。**如果法院实际裁定更短而律师沿用了默认值，系统算出的续封提醒会晚于真实届满日**——而这正是「效力消灭」发生的方式。

**建议**：把「法院载明的到期日」作为第一事实录入项（必填），系统推算值降级为校验提示（「你填的到期日短于法定上限，确认无误？」）。原始事实优先于推算，这也与系统已有的「来源原件 / AI 提取 / 律师确认三层分离」的设计哲学一致。

### F-3　冲突检索不看关联方

现在只比对当事人名称与证件号。实务中利冲审查通常还要看：同一法定代表人、控股股东、母子公司、关联企业。系统**已经接入了元典企业库**（`yuandian-company`，能查工商、股东、对外投资），冲突检索却没用它。

这不是 bug，是能力没接通。考虑到系统已经为 Party 存了 `enterpriseSocialCode` 并支持绑定企业，做一层「关联方提示（不阻断，仅提示人工判断）」的边际成本很低，价值很高。

### F-4　人员离所只有「通知」，没有「接管」

`recordOffboardingRisk` 会在停用时给持有 `matters.transfer` 的人发 URGENT 通知，没有合格接收人时通知 SUPER_ADMIN——这个兜底设计是清醒的。但**实际接管动作仍未实现**（AGENTS backlog 第 7 项，标注「完整接管链在 B 批」，而 B 批做的是短信专项）。

结果是：律师离所当天，其名下案件的期限提醒继续发给停用账号（P1-2），案件责任悬空，只有一条通知提醒别人「有 N 项责任待交接」，但没有任何页面能一键完成交接。对小律所而言，人员流动是常态而非例外。

### F-5　节假日顺延只提示不计算

`HOLIDAY_NOTE` 提示律师人工核对顺延，系统不内置节假日表——理由是「每年国务院调整」，这个理由成立。但结果是：**系统算出的届满日在每年春节、国庆前后都是不可直接采信的**，而这恰恰是最容易算错、后果最严重的时段。

《民事诉讼法》第八十五条第三款（已核验）：「期间届满的最后一日是法定休假日的，以法定休假日后的第一日为期间届满的日期。」

**建议**：做成「可配置的年度放假安排表」——管理后台录入当年国务院通知（每年一次，几分钟），系统据此自动顺延并标注「已按 2026 年放假安排顺延，依据：国办发〔2025〕X 号」。录入前保持现状提示。这比内置一张会过期的硬编码表好，也比完全不做好。

### F-6　「已归档」之后的动线是空的

系统把归档做得很重（收尾清单、一致性指纹、审批、不可变），但归档**之后**呢？律所的真实需求是调卷：客户回头咨询、案件再审、律协检查、税务核查。现在归档案件是只读的，但没有「借阅/调卷申请 → 审批 → 限时可读 → 留痕」这条线。

现有的补充归档（supplement）解决的是「往里加」，不解决「拿出来看」。对一个以档案管理为核心价值之一的系统，这是个明显的功能终点缺失。

---

## 四、本轮未覆盖 / 未验证（如实声明）

- **未做**：浏览器端金线走查（AGENTS 第七节要求的 UI 验收）。本轮是静态审计 + 单测/构建验证，没有起服务走页面。
- **未验证**：多用户并发下的事务行为（Serializable 冲突重试、advisory lock 竞争）——需要压测环境。
- **未验证**：P1-4 的结论基于 Dockerfile / compose / 脚本的静态阅读，**没有实际构建镜像跑一次备份**。建议修复前先跑一次 `docker compose --profile full up` 实测确认。
- **未审**：AI 与元典外发的提示词注入面、OCR 结果可信度边界、短信取件对具体法院平台的兼容性（无真实样本）。
- **未审**：`src/components/` 下的 UI 层一致性（v4 墨案重建的验收属于另一条线）。

---

## 五、法条核验记录

元典 MCP 本次返回「账户可用余额不足」，按 CLAUDE.md 约定改用北大法宝 MCP 核验，来源如下：

| 法条 | 内容要点 | 时效性 | 用于 |
|---|---|---|---|
| 《民法典》第一百八十八条 | 诉讼时效三年；自知道或应当知道之日起算；最长 20 年 | 现行有效 | P2-4 |
| 《民事诉讼法》（2023修正）第八十五条 | 期间计算；开始之日不计入；届满日为法定休假日顺延 | 现行有效 | P1-5、F-5 |
| 《民诉法解释》（2022修正）第四百八十五条 | 冻结存款≤1年、查扣动产≤2年、不动产及其他财产权≤3年；续行期限不超过前款 | 现行有效 | F-2 |
| 《查扣冻规定》（2020修正）第二十七条 | 期限届满未办延期手续的，效力消灭 | 现行有效 | P1-1、P1-2 |

代码中 `src/lib/preservation-defaults.ts` 的法条引用与年限数值经本轮复核**准确无误**；`src/lib/deadline-rules.ts` 对第八十五条「开始之日不计入」的实现亦正确，问题仅在取「日」的时区口径。

---

## 六、协作风险提示

审计期间检测到 `zcode-cli` 进程（PID 26216）的工作目录为本仓库，同时工作区有 61 个未提交改动。这与 AGENTS.md「单写者原则」冲突（2026-09-20 确立）。本报告只新增本文件，未改动任何源码，但**上述基线（含测试结果）是在这批未提交改动之上测得的**，修复前应先确认这批改动的归属与去留。

---

*本报告由第六轮体检产出，遵「发现与修复分离」，未包含任何代码改动。*
