# LawLink P1 结构强化实施方案

> 依据：《LawLink-改进分析报告-v5》表 7-2 与后续批次决策。本文记录 P1 十项的状态：已完成项的实现说明，剩余项的落地设计与验收标准。
> 红线提醒：剩余项涉及的迁移继续走 migrate diff 生成 → 展示 → 执行（已获批次预授权）。
> 日期：2026-09-13

## 〇、状态总览

| # | 事项 | 状态 |
|---|---|---|
| 1 | 持久任务队列与后台执行器 | **已实施（2026-09-13）**：JobQueue 表 + SKIP LOCKED/租约/退避/死信 + webhook 投递接入 + worker tick |
| 2 | 财务核销模型（应收/实收/分配/冲正） | **服务层已实施（2026-09-13）**：四表 + 签署→应收/收款→实收钩子 + 核销/冲正动作（UI 批次补界面） |
| 3 | 派生内容权限扩展 | 部分完成（搜索已按源文档授权过滤；批次③信号条上线） |
| 4 | 证件号加密 + 带密钥盲索引 | **已实施（2026-09-13）**：域分离 HMAC 盲索引、明文列密文化、模糊 LIKE 退役、存量回填卡 |
| 5 | 个人级提醒渠道与逾期升级 | 部分（P0 已含配置打通；渠道与升级依赖 §一队列） |
| 6 | AI 审查分段处理 | **已完成（2026-09-13）**：6000 字符/段 × 最多 6 段，逐段审查合并条目，超出标记截断并在结论提示覆盖范围 |
| 7 | 关联案件关系类型 | **待实施**（小项：MatterLink 加 relation/direction/createdAt + 建链 UI 枚举） |
| 8 | 下载水印（衍生副本） | **已实施（2026-09-13）**：pdf-lib PDF 双位水印（页脚+对角线）、签章文件跳过、原件不动、审计带 watermarked 标记 |
| 9 | 外部调用台账 | **已完成（2026-09-13）**：ExternalCallLog 表 + aiChat/元典全量接线 + 管理后台统计卡（30 天量/失败率/耗时 + 最近失败） |
| 10 | 部署者文档三件套 | **已完成（2026-09-13）**：`docs/OPERATIONS.md`（备份恢复演练、升级回退、数据分级、周巡检） |

另有：审查历史查询的授权覆盖已随 P0-4 修复（同口径归属断言）；**TOTP 双步验证已实施（2026-09-13：核心算法含 RFC 向量测试、绑定/关闭 UI、登录二验）**；**4.3 自确认已实施（2026-09-13 专项）：清单配置（SystemSetting+管理端卡片）、硬排除（归档/开票/回填/法代章）、文书送审与用章申请两域接线（审计 *_SELF_CONFIRM）、9 项资格判定测试、全量回归 507/507**。收案转化自确认接线随收案专项后置。

## 一、持久任务队列与后台执行器

**目标**（报告 6.5/10.1）：提醒、AI、导出等任务宕机可接续、失败可重试可补发、重复事件不重复生效。

**选型**：数据库队列表（无新依赖，自部署最省心）。

设计要点：
1. 表 `JobQueue`：`id`、`type`（如 `webhook-digest` / `deadline-reminder`）、`payload Json`、`status(PENDING/RUNNING/SUCCESS/FAILED/DEAD)`、`runAt`、`leaseUntil`、`attempts`、`maxAttempts`、`lastError`、`deliveredAt`；
2. 执行器：独立入口 `src/server/cron/worker.ts`，进程内定时循环（间隔 30s）以 `SELECT … FOR UPDATE SKIP LOCKED LIMIT 10` 领取 `runAt <= now AND status IN (PENDING, FAILED重试)` 的任务，置 RUNNING + lease（5 分钟）；业务成功 → SUCCESS + deliveredAt；失败 → attempts+1，指数退避更新 runAt；超 maxAttempts → DEAD；
3. 崩溃恢复：启动时把 `leaseUntil < now 的 RUNNING` 重新置 PENDING（租约过期即视为宕机遗留）；
4. 幂等：任务带 `dedupeKey`（如 `DueReminder:+0:Deadline:<id>:<日期>`），唯一索引兜底，重复投递直接忽略；
5. 接入顺序：先迁 webhook 摘要投递（现状"结果未知即丢"的最大痛点），再迁提醒扫描的写通知动作；调度器只负责入队，不再直接执行长操作；
6. 与 cron 关系：每日 09:00 扫描改为"入队一批提醒任务"；worker 常驻处理。Docker Compose 的 app 容器内以 `npm run worker` 作为第二进程（supervisord 或简单 `&`）或第二个 service，实施时定。

验收（报告 10.1 阶段目标）：改期取消旧提醒（同 dedupeKey 覆盖未执行任务）；发送失败单独补发；重复事件不重复生效；处理中途 kill 进程，重启后任务接续完成；DEAD 任务在界面可见可查。

## 二、财务核销模型

**目标**（报告 5.4）：已确认记录不可删（P0 守卫已做），更正走带原因的关联记录。

设计要点：
1. 新表 `Receivable`（应收：matterId、billingId?、title、amount、dueDate?、status(OPEN/SETTLED/CANCELLED)）；
2. 新表 `Payment`（实收/实付：独立于 FeeEntry 或由 FeeEntry 升级——**建议独立表**，FeeEntry 保留为登记入口并同步生成 Payment）；
3. 新表 `Allocation`（核销：paymentId、receivableId、amount，约束 合计≤ Payment 金额）；
4. 新表 `FinanceCorrection`（冲正：目标记录、类型 REFUND/DISCOUNT/REVERSAL、原因必填、关联凭证号、审计同事务）；
5. 生成逻辑：Billing 签署（signedAt）时按合同金额生成 Receivable；收款登记生成 Payment 并提示核销；部分收款 = 部分核销；
6. 报表口径切换：应收未核销余额 = OPEN Receivable 合计 − 已分配；替代现在从 FeeEntry 流水推算的方式（旧报表保留为"流水视图"）。

验收：一次收款核销多项应收、一项应收分次收清、退款冲正后余额回退且全程留痕；已确认记录任何路径都不可物理删除。

## 三、证件号加密 + 带密钥盲索引

**目标**（报告 5.6）：证件号密文存储，库被拖走也读不出；等值检索（查重/冲突精确匹配）继续可用。

设计要点：
1. 列改造：`Client.idNumber` → 密文（AES-256-GCM，新增 `idNumberEnc`）；新增 `idNumberBlind`（HMAC-SHA256，密钥独立于附件加密密钥，专钥专用）；
2. 规范化先行（P0-1 的 normalizeIdNumber 已就绪）：规范化后再加密/求 HMAC，保证"格式差异不影响等值"；
3. 检索策略：等值查询走 `idNumberBlind`（唯一索引建在盲索引上，替换现有 (idType, idNumber) 部分唯一索引）；**模糊查询（现 search 的 idNumber contains、冲突检索的部分匹配）不再支持明文 LIKE**——冲突检索的模糊命中本就主要靠名称，证件靠精确；search 的证件号输入框改为"精确查找"语义并在 UI 说明；
4. 密钥管理：`ID_BLIND_KEY` 环境变量（与 STORAGE_ENCRYPTION_KEY 分离）；文档化轮换流程（新钥重算全量盲索引，一次性脚本 + 演练）；
5. 迁移：停写窗口内全量重加密（脚本遍历未加密行）；存量日志/备份中的明文按 OPERATIONS.md 数据分级处理说明；
6. **先做冲突检索与查重的等值改造验证，再切换写路径**——这是本项最大的回归风险面。

验收：拖库拿不到明文；查重/冲突精确匹配行为不变；search 不再出现明文 LIKE；轮换演练通过。

## 四、下载水印（衍生副本）

设计要点：下载/预览 API 返回前生成带水印副本（页脚或对角线："律所名 · 下载人姓名 · 时间"），原件与校验值不动；PDF 用 pdf-lib 逐页盖字（新依赖，需评估包体）；图片用 sharp；归档 ZIP 导出加水印清单页。已签章文件（SealRequest.stampedDocId）不加改（不破坏签章完整性），改为在下载审计中强化记录。验证：原件 sha256 不变；水印含下载人身份；无水印原件仅在受控路径（归档导出）出现且留审计。

## 五、TOTP 双步验证与 4.3 自确认清单

**TOTP**：User 加 `totpSecret`（加密存）+ `totpEnabled`；注册走扫码（otpauth URL，RFC 6238，30s 窗口 ±1）；登录在 authorize 内验证第二因子；恢复码一次性 8 枚哈希存储；管理后台可强制指定账号开启。无新依赖（TOTP 可用 node:crypto 自实现，约 40 行）。

**4.3 自确认清单**（已批准方向，接线在审批模块专项）：`approvalSettings` 增加自确认清单（操作 × 类别 × 用章事项粒度，与审批规则同构）；`requireApprovalRoute` 命中清单时改走"自确认+审计"分支（申请人确认即生成带 CONFIRMED-self 标记的审批记录，不进审批人队列）；法定代表人章、归档、开票**不可**进清单（服务端硬编码排除）；统一审批工作台增加"我的自确认"视图。实施前须先跑全量审批测试基线。

## 六、实施顺序建议

1（队列，其余项的地基）→ 9 已完成 → 7（MatterLink 小项）→ 4（加密+盲索引）→ 2（核销）→ 8（水印）→ 5（渠道升级，依赖 1）→ TOTP → 4.3（审批专项，最后做，需完整回归）。

## 七、UI 实施基准（2026-09-13 补充）

后续所有界面的视觉与交互以 **v4「墨案」效果图**为准：源文件 `docs/mockup/v4/`（13 页 + design-system.css + README，PNG 在 `output/mockup-v4/`），版式母版见 `docs/UI-REFACTOR-PLAN-v4.md`，密度/动效基线沿用 `docs/UI-DESIGN.md` v3.4。

**硬性纪律**：
- 配色：teal #007B7F 仅品牌/主操作/选中；红仅风险/阻断；绿仅完成终态；青铜金 #8A6B3E 仅归档/结案；墨蓝 #0C1927 主文本；画布 #F2F4F3 + 白卡片；毛玻璃仅顶栏/浮层/抽屉；
- 宋体仅案件名称与登录主张；正文基线 ~13px，关键信息不依赖 9–10px 小字；动效 140–240ms（抽屉 220–300ms），无弹跳；
- 表格内"案卷脊"必须挂在 `td:first-child::before`（单元格内绝对定位），不得用 `tr::before`（Chrome 会包匿名单元格导致错位——03 页已踩坑修复）。

**实施进度**：① 案件列表（03 案卷脊）✅ → ② 收案抽屉（05 查重横幅）✅ → ③ 案件详情（04 信号条+材料来源 chip）✅ → ④ 报表客户来源渠道 ✅ + 工作台行动入口四格（待处理/期限/开庭/逾期）✅ → ⑤ 全局搜索识别失败注脚+权限声明 ✅（命中页码需页感知抽取，后续）→ ⑥ 登录页墨案品牌面板（navy 渐变+teal 光晕+宋体主张）✅。每批过 lint/typecheck/build + 金线走查。**4.3 已完成（2026-09-13）**——P1 全部收官→ ④ 工作台（02，今日行动+客户来源渠道图）→ ⑤ 全局搜索（11）与客户页合并横幅（10）→ ⑥ 管理后台期限规则页（12）与登录页（01）。新功能界面（如队列死信、外部调用台账）随后续批次统一对齐。

## 八、追加批次进度（2026-09-13 晚）

- **UI 外壳墨案化**：moan.css 全量移植（token+组件类）、侧栏 228px/brand-mark/nav-item/计数胶囊重做、顶栏搜索盒胶囊化——完成；
- **UI 页面级**：案件列表表头 moan 化（#FAFBFA/字距）+ 标题三行解剖（名称/案由/编号）、工作台 Hero 淡青渐变+teal 光斑、登录品牌面板（前批）——完成；客户页与全局搜索面板的深度对齐随后续批次；
- **P0-2 欠账清偿**：PDF 分页抽取（\f 页界）+ familyId 启用 + uploadNewVersion（版本链闭合，行内"更新版本"入口）+ 搜索命中页码"第 N 页" + 3 项页码测试——完成；
- 下一步：两条纵向样例（TARGET-MODEL-PLAN §五）→ Engagement 引入。

### 追加批次进度（v5 报告 B 线，2026-09-13 深夜起）

- **2026-09-13**：Engagement 五对象第一步收口——`src/server/engagements/actions.ts` 验证到绿（修复 z.input 入参与未用导入）并补 `src/tests/server/engagements.test.ts`（样例 1 一委托多事项、样例 5 终止后不可关联但历史保留、越权挂链拒绝，11 用例）——完成；
- **2026-09-13**：材料出处链第一阶段（报告 §6.3）——EvidenceItem 模型（kind 五枚举 + sourceDocumentId 纯引用不设外键）+ `src/server/evidence/actions.ts`（createEvidenceItem 校验文档归属同案/未删除、listEvidenceItems 按 matters.read 解析来源名、悬空引用不补名）+ 迁移 `20260913091104_p2_evidence_item`（已 deploy）+ 审计中文标签 + 9 用例——完成；UI 入口（案件详情证据页签/报告内嵌引用）待 A 线。
- **2026-09-13**：状态轴分离最小版（报告 §6.4）——Matter.serviceStatus（SERVICE_ACTIVE/SERVICE_COMPLETED，与程序轴 status 分离）+ `completeMatterService`/`activateMatterService`（主办显式动作、时间线事件、审计、不改程序轴）+ 迁移 `20260913091349_p2_matter_service_status`（已 deploy）+ 5 用例——完成；UI 入口（案件详情操作区）待 A 线。
- **2026-09-13**：逾期升级链（收尾 a）——`src/server/reminders/escalation.ts`：逾期档（offset>=1）期限提醒另发团队负责人；发送前用 `matterReadVisibilityFilter` 实时校验访问资格，无资格/账号停用记审计 `SKIP_ESCALATION` 不发送；负责人即主办跳过、当日去重、多团队同人只发一条；接入 scan-due-reminders（结果新增 escalationSent 并入 webhook 统计）+ 8 用例——完成。
- **2026-09-13**：邮件渠道（收尾 b）——**跳过实现**：邮件渠道需 SMTP 配置，待部署环境确认后另行实施（避免 .env 依赖）。
- **2026-09-13**：图像水印（收尾 d）——**跳过实现**：图像水印需 sharp 原生依赖，待部署确认；现状 `src/lib/documents/watermark.ts` 仅 PDF 加水印，image/* 下载不加。
- **2026-09-13**：TOTP 管理端强制开启（收尾 c）——User.totpEnforced 列（迁移 `20260913092054_p1_totp_enforced` 已 deploy）+ `forceEnforceTotp`（仅 SUPER_ADMIN，幂等审计 USER_TOTP_ENFORCE，enabled=false 可撤销）+ 登录 authorize 在 enforced&&!enabled 时拒绝并审计 LOGIN_TOTP_ENFORCED_REJECT（不计失败锁定）+ disableTotp 禁止被强制账号自行关闭 + 登录页预检 checkLoginTotpEnforcement + 10 用例——完成；登录页"请先绑定"提示与用户管理页开关 UI 待 A 线。
- **2026-09-13**：E2E 越权用例（收尾 e，vitest 集成形式）——`src/tests/server/e2e-authorization.test.ts` 三线 8 用例：① CUSTOM 无 documents.read 时 globalSearch 文档桶恒空且不触达候选池查询；② AI 审查收案材料分支非归属用户（非创建人/主办/协办/管理岗）被拒、无归属数据拒绝；③ recoverStaleLeases 只重置过期租约 RUNNING→PENDING、attempts 不变——完成。
- **2026-09-13**：10.1 门槛核验（收尾 f）——`src/tests/lib/acceptance-gates.test.ts` 四道自动化门槛 7 用例：G1 核销守卫（超余额/已全额核销拒绝）、G2 派生搜索授权过滤（无 documents.read 空桶 + 逐条 canReadDocument 同口径过滤）、G3 队列幂等（dedupeKey 终结不复活/未终结覆盖改期/无键直建）、G4 审计同事务（auditTx 与业务写入同一 tx 的 mock 断言）——完成。**人工核验项**：导出重建（归档包按批准记录重新生成并比对内容校验值、文件缺失即停止导出）依赖真实文件与下载链路，不属单测范围，按 ARCHIVE-REVIEW-PLAN 人工走查执行。
