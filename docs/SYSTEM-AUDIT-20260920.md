# LawLink 第四轮全系统体检报告（2026-09-20）

> 审查重心：本轮按用户要求，在前三轮代码级体检（累计 P1×14、P2×30+ 已修复）基础上，转向**业务流程逻辑与使用目的层面**——找「代码没错但业务走不通/规则组合出意外后果」的问题，同时对业务流程大修（批次 0/A/B/C/D/E + 审批终止）后的新代码做增量检查。
> 方法：6 个域审查代理（财务、生命周期、权限、审批、提醒、产品场景）并行深查 + 逐条亲自复核全部 P1 源码。基线：656/656 测试通过、lint 0、typecheck 通过、:3000 属本仓库且 /login 200。

---

## 一、P1：必须优先处理（8 项，全部经本人核实源码）

### P1-1 管理权用户获得全所案件**写**权限——直接违反 AGENTS.md 契约
`MANAGER_GRANTS` 含 `matters.read: ALL`（`src/lib/roles/catalog.ts:60-65`），而 `matterVisibilityFilter` 对 `hasAllScope(grants,"matters.read")` 返回 `{}`（全所，`src/lib/permissions/index.ts:52`），`assertCanAccessMatter` 非合伙人字符串岗位时走该过滤器并传入 grants（:158-167）→ **仅持业务管理权的授薪/独立律师可对任意非经办案件通过访问断言**。该断言被多处用作**写**门禁：
- `updateProcedureInfo`（matters/actions.ts:299）——改任意案件的程序案号、当事人身份/证件；
- `uploadNewVersion`（documents/actions.ts:530）——替换任意案件材料内容；
- `createEvidenceItem`（evidence/actions.ts:41）、`fileDocument`、元典回填 `save-case.ts:69,181`、法院短信分诊 `sms/actions.ts` 五处。

契约原文「写入、案件处理……不因管理权自动放大（assertCanAssociateMatter 等经办断言不变）」。上传入口曾按契约分流修复（documents/actions.ts:100-107），但只修了一个点。**根因：同一契约在四个文件里有四种实现**（字符串形态/grants 探测/双过滤器并存），没有单一权威断言层。

### P1-2 AI 全文外发通道对管理权用户全所开放——比下载更敏感的泄露面
`canReadDocument` 刻意不允许管理权用户下载非经办材料（`approvals/documents.ts:20-21` 用字符串形态仅合伙人），但 `assertCanReviewDocument`（ai/document-access.ts）案件分支走 `assertCanAccessMatter`（被 MANAGER_GRANTS 放大）、收案分支用对象形态 `isManager(session.user)`（含管理权）→ **「不能下载、却能解密后把全文发给外部 AI」**。消费点：review-document、batch-review-matter（整案批量外发）。

### P1-3 程序启动门禁「先写入后校验 + 内置角色无事务」——重试即绕过动态冲突复核
`roleMutation` 对内置角色无事务（roles/service.ts:36 `return write(prisma)`）；`updateProcedure` 先 update（where 无 status 前置条件）后校验 `assertProcedureCovered`+`assertMatterReviewCurrent`（procedures/actions.ts:125-131，后者为全仓唯一强制执行点）。首次请求门禁抛错但 IN_PROGRESS 已落库；用户重试时 `existing.status!=='IN_PROGRESS'` 为假 → 门禁整体跳过。**新代理范围未经冲突复核、无合同覆盖即进入办理**，击穿修复七与 E 批核心拦截。

### P1-4 归档收尾与补充归档互斥死锁——批次 E 两个特性互相卡死
- 收尾指纹含**实时财务**（closure.ts:28-31：outstanding/unallocated/分成余额/发票未收全进 snapshot）；
- 归档后 tail 财务是**放行**的（修复方案 §6 设计如此）→ 收尾人登记并确认一笔尾款/支出后指纹必然漂移；
- 补充归档与审批走 `assertClosureReady` 要求 `plan.fingerprint===facts.fingerprint`（closure.ts:65），报错「请重新保存收尾安排」；
- 但 `saveClosureTx` 对 ARCHIVED 案件禁止重存（:48「案件已归档…不可再修改」）——**错误提示指向一个被禁止的操作**。
第二触发源：收尾负责人停用/失去 `finance.tail` → :67 `assertTailAuthority` 抛「收尾负责人账号无效」，同样无法换人（saveClosureTx 已被拦）。**该案从此无法补充归档，无任何出口。**
修复方向：指纹须区分「阻断性事实」（blockers，要求一致）与「允许漂移的事实」（财务余额，只要求有人负责）；补充归档只校验 blockers=0 并单独冻结当次快照。

### P1-5 责任人停用后其名下全部期限/开庭提醒静默中断，升级链同断，兜底通知默认无人能收
`schedule.ts:48`：ownership 存在但 assignee 失效 → `null` → `return null`，**不回退**程序主办/案件主办（无 ownership 的旧数据反而有回退链）；升级仅由「投递结果 offset>0」触发（:127-135），outcome 为 null 时连升级也跳过。兜底 `recordOffboardingRisk` 只在停用当刻给 `role:'CUSTOM'` 且持 `matters.transfer` 的账号发一次性通知（offboarding.ts:13-16）——**内置五岗位均无此权限，默认全新安装没有任何人能收到**，之后无周期性再提醒。错过举证期限级别的执业事故路径。
修复方向：assignee 失效时回退 lead→owner 链并发「责任人已失效请接管」URGENT 通知；对失效责任人的 OPEN 事项建每日催办。

### P1-6 ICS 日历订阅全天事件在标准 Docker 部署（UTC 容器）下错一天
`ics.ts:33-36` 的 `fmtDate` 用服务器本地时区取日；而任务/短信生成/部分路径录入的期限存为「上海午夜」瞬间（= 前一日 16:00Z），Dockerfile/compose 未设 TZ → 手机日历里到期日**提前一天**。且期限落库存在 UTC 午夜/上海午夜/浏览器本地午夜三种瞬间并存，同一张日历两种口径。站内因 shDayKey 归一免疫——**一切绕过 sh-time 的出口都在 UTC 容器上漂移**（同病：保全过期通知 toLocaleDateString、ICS 订阅窗口 setHours）。
修复方向：fmtDate 改 shDayKey；确立「日历日一律上海午夜」单口径。

### P1-7 终止执行「唯一持权人自决」服务端存在、UI 不可达——单人执业死锁
服务端明确支持 soleHolder 自决（termination.ts:33-39「本所无第二名合格人」现算复核），但取数层 `canDecide` 硬性排除申请人（termination-actions.ts:6），UI 唯一入口据此渲染 → 单人/唯一持权人提交终止后只能「撤回」，执行与归档被永久阻塞（closureFacts 只豁免 CONFIRMED 终止）。

### P1-8 数据层加固迁移未执行，schema 与主库已结构性漂移
`20260920000001_audit_fix_hardening` 仍 create-only 未应用（红线待批）。schema.prisma 已是 RESTRICT/新默认值，主库实际仍是 **CASCADE + confirmState 默认 CONFIRMED + 无 AuditLog 防删 RULE**。后果：物理删除案件仍会级联删光财务记录；漏写 confirmState 的 RECEIVED 插入仍会静默落成已确认。`migrate status` 只对迁移历史不报此漂移，下次 `migrate dev` 会出现不可预期行为。**建议尽快批准执行**（SQL 已在第三轮展示过）。

---

## 二、产品与使用目的层面的重大发现（本轮核心命题）

### M-1 单人执业没有一条开箱即用的主线（重大）
系统面向「独立律师、小团队和小律所」，但全新安装后第一个业务动作就被「无合格审批人」阻断：收案/归档/开票/用章全部先走 `requireApprovalRoute`，seed 不创建任何审批权限组。单人合规配置分散在管理后台五六处（审批权限组按事项×类别×印章组合、allowSelfApproval 开关、归档制度原文、用章事项），无引导无向导，每撞一次墙去后台挖一次。**建议：单人执业模式一次性引导/安装向导**（不推翻按事项授权规则本身）。

### M-2 「权限只认自定义角色 grants」×「一人一岗」×「内置角色无 grants」的组合意外（重大）
- `finance.confirm` 仅内置财务岗或自定义角色持有 → **单人律师用任何内置律师岗都无法确认自己登记的实收**，且后果传播：不计入实收/回款/报表/工作台，归档门禁把「N 笔实收待确认」列为 blocker → 单人所一件案都归不了档。
- `finance.tail` 连内置财务岗都没有（scopeFor 对内置角色恒空）→ **带欠款的案件在内置角色下无任何账号能当收尾负责人**，一件都归不了档。现实中多数案件结案时都有欠款。
- 角色编辑器「复制授薪律师权限」模板不含任何 finance.* → 照模板建的角色连收款登记都被拒。
- 自确认清单的「收案审批」可勾选但不生效（服务端不查）——配置幻觉。
**建议**：预置「独立执业（律师+财务）」角色模板；管理后台对「全所无 finance.confirm/finance.tail 持有者」给持续可见的配置缺口警示（交接模块已有同类提示模式可复用）。

### M-3 其余产品层问题（中等）
- 收款三步走（登记→确认→分配）且分配无自动核销 → 「未分配款」慢性挂账，半年后报表失真；建议加「按最早到期自动填满」。
- 归档门禁无运营事项例外 → 旧案批量归档要逐条关闭陈年待办；建议「已逾期 N 天低风险待办随案批量办结（留痕）」出口。
- 在办案件无文件+记录打包导出（唯一带文件的导出是归档 ZIP）→ PRD「数据带得走」承诺只对已归档案件成立。
- 「哪个案子亏了」无直接答案；修复方案承诺的「本期应收核销率」指标未实现（全库 grep 无「核销率」）。
- 从案件页登记收款被强制跳转全局对账页，登完回不来。

---

## 三、P2 精选（15 项，代理已核实源码）

| # | 域 | 问题 | 位置 |
|---|---|---|---|
| 1 | 财务 | 分成扣回上限用 netPaid 而非 recoverable → 超额扣回形成「多扣变待支付」错账回路 | ledger-corrections.ts:165 |
| 2 | 财务 | 归档案追加尾款 UI 断裂：登记下拉过滤 ARCHIVED，预置 matterId 显示空白，重选会**跨案错记** | registration-workspace.tsx:60 |
| 3 | 财务 | 「本期应收」按 createdAt 归月取当前 effectiveAmount → 历史月份被后续更正回溯改写；分子分母不同批 | finance/actions.ts:802 |
| 4 | 财务 | 退款 WAIVE_DEBT 不校验被免应收与被退实收的核销对应关系 → 应收级账目错位 | ledger-corrections.ts:67-69 |
| 5 | 生命周期 | 命中冲突的收案向导仍自动送审，而结论只能在意向可编辑状态给出 → 每个命中收案空转一轮「撤回-补结论-重提」 | intake-wizard.tsx:362-369 |
| 6 | 生命周期 | INTAKE 草稿唯一出边是送审，无作废路径 → 弃置草稿永久污染「收案中」统计 | intakes/workflow.ts |
| 7 | 生命周期 | 动态冲突复核唯一强制点挂在「程序→IN_PROGRESS」；改类型/加当事人/签补充协议/开票均不拦，复核只是红点提示 | matters/actions.ts:394-455 等 |
| 8 | 权限 | FINANCE→全所残留于旧过滤器：日历订阅与全局搜索把全所案件日程泄露给财务岗（站内已用窄口径纠正） | calendar/route.ts:49-53、search/actions.ts:148 |
| 9 | 权限 | 开票申请列表对管理权用户「少给」（用字符串形态 isManager + 不传 grants）→ 无法履行全所财务监督 | invoices/actions.ts:34-54 |
| 10 | 提醒 | 待确认（规则生成）期限在日程页与 ICS 订阅无任何「待核对」标记，违反「四处一致标注」既定规则 | schedule/query.ts、calendar/route.ts |
| 11 | 提醒 | 参考程序（INFORMATIONAL）期限照常发提醒但日程/ICS 隐藏——提醒与视图口径相反 | schedule.ts vs query.ts:57,90 |
| 12 | 提醒 | 补扫只覆盖当日档位（最高 +1 天）→ 停机跨两天后提醒与逾期升级**永久丢失**，与「补扫遗漏区间」承诺有实质差距 | schedule.ts:103-115 |
| 13 | 提醒 | 「未承接」超时无任何兜底升级（方案承诺按有效关系升级） | escalation.ts:42 |
| 14 | 审批 | 法人章审批侧有单人例外、回填侧无例外 → 法定代表人本人申请的法人章批准后**无人能回填**，无法撤销，只能终止（又撞 P1-7） | rules.ts:33-38 vs service.ts:22-25 |
| 15 | 审批 | 遗留 `createInvoiceRequest`（"use server" 文件）绕过「关联案件必传开票依据/专票六要素」服务端校验，UI 不引用但 RPC 可直达 | invoices/actions.ts:62-88 |

另有 P3 约 30 项（通知不回收、审计不同事务、死代码口径违例、月度开票红冲扣错月份、Billing 列表把变更输入额当合同额展示、短信重复粘贴不去重等），明细见各域代理报告。

---

## 四、结构性根因（跨域共性，建议按此组织修复）

1. **「管理权=只读放大」没有单一权威断言层**。isManager 双形态（字符串/对象）+ grants 探测 + 双过滤器并存，约 60 个调用点各自解释 → P1-1/P1-2/P2-8/P2-9 同根因。修法：写断言收敛到 `assertCanAssociateMatter` 一处并内置合伙人例外；FINANCE 全所口径收敛到 `matterFinanceVisibilityFilter` 一处。
2. **门禁依赖「调用方记得调用」而非集中收口**。动态冲突复核全仓一个调用点、归档门禁两处；先写后校验、无事务（P1-3、P2-7）。修法：状态转换类写入统一收敛到单一服务层，保证「校验先于写入、写入必有事务」。
3. **终态对象缺配套维护出边，指纹把一切变化导向被终态封死的退路**（P1-4、P2-6）。门禁指纹应区分阻断性事实与允许漂移的事实。
4. **「人」是提醒链路唯一没有防御层的单点**（P1-5、P2-13）：整个设计假设责任人始终有效；一旦失效，提醒、升级、取消出口全部静默。
5. **服务端校验与 UI 假设双轨**：UI 算好了正确口径（tailWritable、recoverable）但服务端用更松的等价判断或没接（P2-1/P2-2、P2-15）→ UI 是唯一防线处即旁路入口。
6. **时点维度缺失**是财务统计最大欠账（P2-3）：无余额快照机制，「按指定统计时点计算核销率」在数据结构上无法实现。
7. **权限独立化 × 一人一岗 × 内置角色无 grants** 的组合让单人/小所主线断裂（M-1/M-2）——规则本身都是用户确认过的，问题在组合边界与合规执行成本。

## 五、建议处理顺序

1. **立即**：P1-8 迁移审批执行（漂移风险随时间放大）；P1-1/P1-2 权限收敛（越权面）。
2. **第一批**：P1-3/P1-4/P1-7（流程死锁三件套）+ P1-5（提醒断链）——都发生在「设计好的路径走不通」的场景，业务后果是卡死或事故。
3. **第二批**：P1-6 时区单口径 + P2 全部。
4. **产品批次**：M-1/M-2（单人执业引导 + 角色模板 + 配置缺口警示）——这是「系统对目标用户是否可用」的答案所在。

---

*各域完整报告（含 P3 明细与代码摘录）由 6 个域审查代理产出，本文件为汇总。*
