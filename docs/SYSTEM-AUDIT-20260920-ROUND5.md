# 第五轮系统体检报告（2026-09-20）

> 审计口径：按 AGENTS.md「审计止损线」执行——**回归验证 + 已知清单核对**，不引入新审查镜头。
> 新发现一律进 backlog 排期修，本轮未修改任何业务代码。
> 审计时工作区状态：分支 `ui/v4-rebuild`，5 个未提交文件（服务轴 UI 移除 + 冲突复核卡迁侧栏的完整收尾，与本报告发现无冲突）；无并发写者。

## 一、回归验证结果（全部通过）

| 检查 | 结果 |
|---|---|
| `npm run lint` | ✅ 通过 |
| `npm run typecheck` | ✅ 通过 |
| `npm run prisma:validate` | ✅ 通过 |
| `npm run test:run` | ✅ 87 文件 / **678 测试全部通过**（5.6s） |
| `prisma migrate status` | ✅ 73 个迁移，数据库 up to date |

注意：678 测试全绿≠无 bug。本轮发现的 3 个 P1 全部位于**零测试覆盖**的 `confirm-actions.ts` / `sms/actions.ts` 区域（见 §四）。

## 二、backlog 逐项核对

| # | backlog 原条目 | 实测结论 |
|---|---|---|
| 1 | 迁移 20260920000001 待批执行、主库仍 CASCADE + 默认 CONFIRMED + 无防删 | **已过时**：实测主库 `audit_log_no_delete` 触发器存在、`FeeEntry.confirmState` 默认 `'PENDING'`、迁移 20260920000001–00004 全部已应用（`_prisma_migrations` 实查）。A 批记录属实，backlog 未同步 |
| 2 | 元典回填与短信分诊 B 批通道细化 | **仍在**：分诊权限通道（经配置的行政人员代取件/最小披露）全仓无配置项与断言，现状仍是「收件人或经办关联」。属已知未实现项 |
| 3 | 时区 `getDay()/getFullYear()/getMonth()` 形态全量核对 | **本轮已完成**：发现 33 处误用（11 个根因点）+ 13 处疑似 + 12 处 `toISOString()` UTC 取日，详见 §五 |
| 4 | B2/B3 短信阅读确认层 | 进行中；本轮审计发现 3 P1 + 8 P2（§四），须纳入 B2/B3 收尾范围 |
| 5 | M-1/M-2 单人执业引导 | 未动，不变 |

## 三、C/D 批与近期修复回归核对（10/12 落地正确）

C1 归档死锁修复（指纹排除财务数字、supplement 另冻快照）、C2 收尾交接（advisory lock + FOR UPDATE 无竞态）、C3 终止自决三处同源、C4 预检命中停草稿、C6 tailWritable、C7 单人主线（SOLE_PRACTICE_GRANTS/缺口警示/自确认移除 UI 与服务端一致）、D8 核销率同批口径属实、D9 自动填满、D10 导出卷宗权限链完备、D11 批量办结逐项责任链——**均核实落地正确，无回归**。ca1939c 收敛的 7 处写断言全部维持 `assertCanHandleMatter`，无绕过。

两处部分落地（新发现，进 backlog）：
- **C5 `voidIntake` 越权缺口（P2）**：`src/server/intakes/actions.ts:544` 注释称「仅申请人/当前主办可作废」，实现只有 `requireSession("intakes.create")`——任何持收案权账号可作废他人 INTAKE 草稿（状态条件更新不构成授权）。
- **D12 声明过宽（P2，文档）**：「对账页保存后返回原案件」仅登记类 5 类操作中的 1 类实现（`registration-workspace.tsx:42`）；分配/更正/分成/合同/发票更正均未实现（`correction-workspace.tsx` 未接收 selectedMatterId）。

## 四、B2/B3 短信链路新发现（本轮核心增量）

以下 P1 均经人工复核源码确认，且 **confirm-actions.ts / sms 转正路径零测试覆盖**。

### P1（3 项）

**P1-1 `fileSmsInboundFilesToMatter` 从 "use server" 模块导出且无鉴权**
`src/server/sms/actions.ts:436`。签名 `({smsId, matterId, userId})`，无 `requireSession`、不校验来件收件人，`userId` 由调用方任意传入（`uploadedById` 归属可伪造）。作为可寻址 server action 端点，任何对自己某案有经办权的用户可把**他人私有来件暂存文件**转正到自己案件，从而下载他人私区文件内容。违反仓库自身红线（`attachments.ts:1-3` 注释明确禁止内部 helper 从 "use server" 模块导出）。修法：移入非 "use server" 内部模块，调用方（`confirm-actions.ts:109`）改走内部引用。

**P1-2 `decideSmsSuggestions` 不校验 ids 同属一条来件**
`src/server/sms/confirm-actions.ts:68-77`。`where` 仅 `id in + PENDING`，收件人/案件校验只基于 `rows[0].sms`。REJECTED 分支（:82-84）对混入的其他建议**无任何对象校验**即改状态；叠加分析端 dedup（拒绝过的内容不重建），可越权「永久消音」他人建议且受害者无感知。修法：按 smsId 分组校验或拒绝混批。

**P1-3 HEARING/DEADLINE 幂等守卫读事务前快照**
`confirm-actions.ts:146,161`（守卫读 `row.sms.generatedHearingId`，而 rows 在事务外 :68 预载）。同批两条 HEARING 建议（多场庭审/多文书）守卫都见 null → **建两个开庭**，`generatedHearingId` 被覆盖；分两批确认第二条时守卫命中 `return`，但 :90 仍标 ACCEPTED——**建议显示「已采用」实际未建开庭**。修法：守卫改在事务内重读，同批先写守卫标记。

### P2（8 项）

1. **视觉 OCR 用错模型**：`src/server/ocr/provider.ts:73-84` `aiVisionOcr` 调 `aiChat` 未传 `model`，落到 `textModel`（`ai/client.ts:78`）而非 `visionModel`——与 AGENTS.md「默认复用 AI 设置的视觉模型」声明不符，纯文本模型收 `image_url` 大概率 FAILED。
2. **双重门禁语义冲突**：外层 `assertCanHandleMatter`（合伙人放行全所）与事务内 `assertMatterWritable`（仅主办/成员，`archive/guard.ts:23`）口径不一——合伙人确认非经办案件建议必被整批回滚且报错误导；`parseAndSaveSms` 自动取件同病（`attachments.ts:88`）。
3. **已入卷文件分析读密文/空路径**：`sms/analysis.ts:99` 直接 `storage.readFile(file.storageKey)` 不解密；匹配案件下载的文件 storageKey 是密文路径，`ALREADY_DOWNLOADED` 行 storageKey 为空串。启用 `STORAGE_ENCRYPTION_KEY` 的部署分析恒 FAILED。
4. **取件队列重试是死功能**：`cron/worker.ts:74-81` 的 `sms.attachment_fetch` 处理器调用 `extractSmsAttachments`（`requireSession`→`getServerSession` 在无 HTTP 上下文的 cron 定时器中抛错），每次重试必失败直至 DEAD。
5. **未匹配来件取件无恢复入口**：UI「提取附件」在 `!sms.matchedMatter` 时禁用（`inbox-view.tsx:687`），叠加 P2-4 队列失效，未匹配来件失败取件无任何重试路径。
6. **待匹配页签查询缺字段**：`inbox/page.tsx:16-24` 未 include `suggestions`、inboundFiles select 缺 `analysisState/docType`（`as never` 掩盖类型检查）——MATTER_MATCH 建议在最需要它的页签不可见，文件阅读状态徽标不显示。
7. **手工补传到已匹配来件的文件假「已入卷」**：`sms/actions.ts:555` 标 `state:"FILED"` 但无 documentId、不建 Document，且转正查询（:440）只查 `PENDING_REVIEW`——永久排除在转正之外。
8. **ORGANIZED 状态无写入路径**：`confirm-actions.ts:79-114` 确认后不更新 `sms.processingState`；`markSmsProcessed`（:705）一律写 `NO_ACTION_NEEDED`。验收声明的状态机（待确认→已整理）不落位。

### P3 摘要（B2/B3 相关，详见子报告）

HTML 页面分支 `response.text()` 无流式上限（`attachments.ts:169`）；开庭时间解析失败静默回退 09:00（`confirm-actions.ts:187`）；建议 dedup findFirst→create 非原子无 DB 约束；FIELD_CHANGE 不复核 currentValue 前置条件（律师手工改过的案号会被静默覆盖）且只比 `procedures[0]`；B3 建 Hearing/Deadline 未调 `refreshScheduleReminderAfterSave`（靠队列补扫兜底）；分析入队条件偏窄（仅 DOWNLOADED，手动提取路径不入队）；`PROCESSING`/`ANALYZING` 崩溃卡死无超时出口；enqueue 失败 `.catch(()=>{})` 静默；混批多案件只 revalidate 最后一个；缴费类通知无 Task 通道（按 CUSTOM 期限建）；`getOcrSettingsPublic` 无鉴权导出（泄露 endpoint 字符串，密钥已掩码）；HTTP OCR 无拒答检测；全失败取件标 PARTIAL。

## 五、时区形态全量核对（backlog #3 完成）

f4bd8b1 修过 `toLocaleDateString/getHours/getDate` 三形态；本轮补齐 `getDay/getFullYear/getMonth` 及相邻形态。**客户端组件高危水合类仅 1 组**，其余集中在服务端「今日/本月/本年」窗口与编号年份，全部依赖容器 TZ。

**33 处误用、11 个根因点（按修复价值排序）**：
1. `src/server/reports/queries.ts:24-66` — periodPresets/customPeriod 全部本地取月构造（已复核确认）。UTC 容器「本月」窗口=上海 1 日 08:00 起，月初 0-8 点数据落上月；自定义区间整体偏 8 小时。测试与实现同 TZ 自洽掩盖问题。
2. `src/server/dashboard/actions.ts:70,150-174` — 月度 KPI 与收入趋势的 facts 缺失回退路径本地取月分桶（facts 路径已正确用 shMonthStart）。
3. `src/server/finance/actions.ts:906-916` — getMonthlyRevenue 回退路径同病（:892 已改对）。
4. `src/server/seals/actions.ts:47,133` — SEAL 流水号年份 + 本月盖章窗口。
5. 编号生成器年份四类：`clients/code-generator.ts:10`、`matters/code-generator.ts:14,28`、`lib/archive/archive-no.ts:37` — 年界 8 小时窗口内编号年份错且计数器错年。
6. `src/server/clients/insights.ts:124` — 案件年份展示。
7. `src/server/matters/export-xlsx.ts:1030-1038` — 导出日期过滤边界（文件内 formatDate 已是 shDayKey，唯独边界漏改）。
8. `src/app/(app)/preservation/_components/preservation-dialog.tsx:74,159,169,234,273,281` + `lib/preservation-defaults.ts:63-71` — **唯一客户端组**：`new Date(startDate)`（UTC 午夜）+ 本地字段重定基做日历计算，非中国时区浏览器起算日偏一天。应改 `civilFromKey`/`shTodayCivil`。
9. `src/server/schedule/query.ts:42` — 默认起点本地午夜（当前调用方都显式传参，地雷代码）。
10. `src/server/imports/actions.ts:40-42` — ExcelJS 日期单元格本地取日，西于 UTC 的部署差一天。
11. `scripts/backfill-*.ts:31,26` — 回填脚本真瞬间本地取年（运维脚本，上海时区本机跑才正确）。

另有 12 处 `toISOString().slice(0,10)` UTC 取日（`template-engine.ts:264` 文书 today 字段漏改最值得修——同函数 :202 已改对；其余为归档目录/报表导出列/文件名，低危）。

## 六、权限域其余发现（ca1939c 收敛无回归，新增 3 P2）

收敛的 7 处 + B/C/D 批点名写路径（saveClosureTx、completeTasksBatch、confirmFeeEntry、ledger 系、export-bundle）全部核实合规；约 175 个 mutation 入口逐一清点，未发现组件直连 prisma 写、route handler 越权直写、SUPER_ADMIN 业务权旁路。新增：

- **P2-4 委托三入口**：`engagements/actions.ts:26`（create）与 `:73`（link）用 `matterReadVisibilityFilter`（读可见性）当写守卫——managerAuthorized/合伙人/团队只读用户可把非经办案件挂入委托（已复核确认）；`:113` `terminateEngagement` 完全无对象校验，任何 matters.write 用户（含 ASSISTANT）可终止任意委托。
- **P2-5**（即 §四 P2-1/P2-2，与 B2/B3 重叠）：`extractSmsAttachments` 非收件人凭读断言可改他人 SMS 记录；`matchSmsToMatter` 凭读权限改绑他人短信。
- **P3 系列**：procedures 模块 14 个写入口走 associate 口径与 handle 口径不一致（无管理权放大，仅合伙人无全所例外）；`seals cancelSealRequest` 用管理权撤他人申请（审批域唯一例外）；`backfillCaseNumberFromSms`/`yuandian enterprise bind` 未统一 handle 口径；`custom-fields saveMatterCustomValues` fail-closed 使 CUSTOM 角色恒拒。

## 七、结论与排期建议

1. **B2/B3 收尾范围扩大**：3 个 P1 + 8 个 P2 全部在短信链路，且该区域零测试覆盖——冻结窗口内优先修 P1-1/P1-2/P1-3 + P2-1（视觉模型）+ P2-4（队列重试），并为 `decideSmsSuggestions` 补事务/幂等/混批回归测试。
2. **时区第二轮清扫**：11 个根因点一次修完（类修复原则），reports/dashboard/finance/seals 窗口 + 四类编号年份 + preservation-dialog 客户端组；修 reports/queries.ts 时同步修自洽测试。
3. **权限 P2 三个**（engagements、voidIntake、交接资格校验）可与上述并行小批修。
4. **文档同步**：AGENTS.md backlog #1 已过时须更新；D12 表述收窄为「登记类操作」或补齐其余 4 类。

本轮未修复任何代码；以上发现全部进 backlog。

---

## 八、修复记录（2026-09-20 晚追加，同日经用户授权执行）

用户质疑「循环修复陷阱」后授权尽快修复。**§四 P1×3 + P2×8、§五 时区 11 个根因点、§六 权限 P2×3 已全部修复**，验证：688 测试全绿（净增 10 个防线用例：confirm-actions 5 例、reports-period 3 例跨时区断言、engagements 越权 3 例）、lint/typecheck 干净、/login 200。要点：

| 发现 | 修复 |
|---|---|
| P1-1 | 移入内部模块 `src/server/sms/inbound-filing.ts`（脱离 "use server"），加归属校验（转正目标＝该来件匹配案件 + 会话一致性） |
| P1-2 | `decideSmsSuggestions` 混批直接拒绝（ids 须同属一条来件） |
| P1-3 | HEARING/DEADLINE 幂等守卫改事务内重读（同批不再重复建） |
| P2-1 | `aiVisionOcr` 改走 `aiVision`（visionModel），`logAction` 经 aiVision 透传保留外发台账 |
| P2-2 | `assertMatterWritable/assertDocumentWritable` 加 `allowPrincipal` 选项，确认建议与自动取件内外层口径统一 |
| P2-3 | 分析入口防御空 storageKey（合并行）与加密部署的已入卷文件；两处分析查询排除 documentId 非空行 |
| P2-4 | 取件队列重试改经新内部模块 `src/server/sms/extract-core.ts` 复跑（enqueue payload 带粘贴人，worker 校验收件人） |
| P2-5 | 「提取附件」放开未匹配来件禁用（入私有暂存） |
| P2-6 | 待匹配页签补 suggestions include 与阅读状态字段，去 `as never` |
| P2-7 | 手工补传统一 PENDING_REVIEW（经确认转正真正入卷，不再假「已入卷」） |
| P2-8 | 建议全部处理完推进 ORGANIZED 终态 |
| §六-1 | engagements create/link 逐案 handle 断言；terminate 加对象校验（关联案件任一经办或合伙人；未挂案件仅合伙人） |
| §六-2 | voidIntake 补 `assertIntakeEditor`（申请人/当前主办）；extract/matchSmsToMatter 的读断言改 handle 口径 |
| §六-3 | 归档交接校验新收尾人资格（active/finance.tail ALL/finance.read，账号不存在给明确错误） |
| §五 1-11 | reports 窗口与自定义区间上海日界；dashboard/finance 回退路径按上海年月分桶；seals 月窗与流水号年份；四类编号生成器年份；insights 年份；导出边界 `+08:00` 拼接；preservation-dialog 客户端组改 `civilFromKey`/`shTodayCivil`；schedule 默认起点；imports ExcelJS 取日 shDayKey；backfill 脚本 shParts；template-engine today 补漏 |
| 文档 | AGENTS.md D12 表述收窄为登记类操作；backlog #1 过时条目作废、#3/#5/#6 勾销 |

**未修（如实声明）**：§四 P3 系列 14 项（dedup 并发约束、FIELD_CHANGE 前置值校验、崩溃卡死态出口、缴费类 Task 通道、HTML 流式上限等）仍在 backlog 第 4 条排期；时区剩余低危（12 处 toISOString 文件名类、schedule 页窗口、模糊窗口）；分诊权限通道与 B2 环节级归类属未实现设计项非回归。C/D 批的 P3（核销率可超 100%、批量办结截断提示等）未动。

---

## 九、P3 收尾与复查轮（2026-09-20 晚二批追加，用户授权后执行）

用户要求「修复剩余 bug 后整查」。P3 系列与时区低危全部修复后，派独立复查代理专查修复本身是否引入新问题，发现 P2×3 + P3×7（procedures 替换与时区批零问题），已全部修复：

| 复查发现 | 修复 |
|---|---|
| P2-1 findMany 无 orderBy，「归属+事项」同批确认顺序不定，事项先执行整批回滚 | 循环前按 MATTER_MATCH 优先稳定排序 |
| P2-2 补传到已匹配来件的 PENDING_REVIEW 文件无任何转正出口（MATTER_MATCH 建议只在未匹配来件产生） | uploadSmsInboundFile 尾部对已匹配来件立即转正（非经办收件人留待确认） |
| P2-3 cron 队列取件对已匹配来件仍死在 assertDocumentWritable→requireSession，且被 catch 吞成 FAILED 假成功 | guard 加显式 `actor` 参数（队列场景替代 requireSession），extract-core 按来源透传 |
| P3-4 同批双 MATTER_MATCH 指向不同案件时转正必抛错 | 目标不一致直接拒绝（逐条确认） |
| P3-5 前置值复核使同字段多建议批次必败无出路 | 建议值已生效（current===suggestedValue）跳过，原值被改才拒绝 |
| P3-6 收件人提取已匹配非经办案被 handle 断言拦（收窄回归） | 收件人本人放行（材料入卷仍由下载管道门禁承担），仅非收件人要求 handle |
| P3-7 交接资格漏「finance.read 非 ALL 须关联本案」分支 | 补齐与首次指定同口径 |
| P3-8 指纹键收窄使存量待审申请 approve 必败（主库实测 1 条 PENDING_REVIEW） | approve 复核按旧算法兼容（匹配任一算法放行） |
| P3-9 terminate 只看前 20 个挂链 | 去掉 take，全量校验 |
| P3-10 parseDateTime 无范围校验 / AI 提示未约束 timeText / 全拒也置 ORGANIZED | 范围校验 0-23/0-59；提示词约束 HH:MM；ORGANIZED 仅采纳后推进（全拒可能仍有待处置文件） |

**终态验证**：689 测试全绿（净增 11 防线用例：confirm-actions 6 例、reports-period 3 例跨时区、engagements 越权 3 例等）、lint/typecheck 干净、`npm run build` 零错误、/login 200 与五个业务页未登录重定向正常。

**仍未修（如实声明）**：建议去重并发唯一约束需 Schema 迁移（红线走 create-only 审批，进 backlog）；核销率>100% 为负向调整的真实数据，选择如实展示不掩盖；分诊权限通道、开庭改期更正、环节级归类、来源页回看为未实现设计项，随专项批次推进。
