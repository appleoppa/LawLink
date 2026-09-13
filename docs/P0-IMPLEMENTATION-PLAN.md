# LawLink P0 底线补强实施方案

> 依据：《LawLink-改进分析报告-v5-20260913.docx》表 7-1。本文是 P0 八项的逐项实施方案：已完成项记录实现细节，待实施项给出设计、Schema 需求与验收标准。
> 红线提醒：标注【需迁移】的项目，SQL 以 `prisma migrate dev --create-only` 生成后展示给叶森，批准后才执行。本文所列 SQL 仅为草案示意。
> 日期：2026-09-13

---

## 〇、状态总览（2026-09-13 批次执行后更新）

| # | 事项 | 状态 | Schema 变更 |
|---|---|---|---|
| 1 | 客户主数据查重与合并 | **已实施** | 已迁移（idType + 部分唯一索引） |
| 2 | 文档文本层与全文检索 | **已实施（首版）** | 已迁移（textContent 等四字段） |
| 3 | 登录失败锁定 | **已实施（锁定）；TOTP 后置 P1** | 已迁移（User 两字段） |
| 4 | AI 入口权限专项核验与修复 | **已完成（2026-09-13）** | 无 |
| 5 | 提醒配置打通与投递结果可见 | **已完成（2026-09-13）** | 无（SystemSetting 复用） |
| 6 | 财务确认口径与删除限制 | **已实施**（守卫+发号重试；冲正待 P1） | 无 |
| 7 | 关键动作审计同事务 | **已实施**（auditTx/auditStrict；审批/角色链核验为既有事务内审计） | 无 |
| 8 | 期限来源结构化与修正保护 | **已实施**（字段+确认/调整动作+规则管理 UI） | 已迁移（Deadline 六字段） |

迁移：`20260913052823_p0_baseline_batch`（含证件规范化与部分唯一索引 SQL），已获批准并执行。
制度决策 4.1 已实施（受限标记）；4.2 记录维持现状；4.3 方向批准、接线后置审批专项（见 AGENTS.md 决策记录）。
检索首版说明：正文匹配采用数据库不区分大小写包含查询（中文子串命中无需分词）；zhparser/pg_bigm 分词方案与索引优化留待数据量增长后评估，独立搜索引擎仍为验证后备选。

## 一、已完成：P0-4 AI 入口权限专项核验（含 C07 修复）

### 1.1 核验结论（全量入口清单）

| 入口 | 文件 | 功能权限 | 对象级校验 | 外发内容 | 结论 |
|---|---|---|---|---|---|
| 文书审查 reviewDocument | `src/server/ai/review-document.ts` | documents.write | 修复前：仅 matterId 分支；intake 分支缺失 | 库内文档全文（前 6000 字符） | **已修复** |
| 审查历史 listReviewHistory | `src/server/ai/review-history.ts` | documents.read | 同模式（intake 无记录，风险低） | 无外发 | **已修复（防御性）** |
| 审查记录详情 getReviewRecord | 同上 | documents.read | assertCanAccessMatter 恒执行 | 无外发 | 通过 |
| 文书草拟 draftDocument | `src/server/ai/draft-document.ts` | documents.write | 无（用户当次输入） | 用户自填文本 | 通过（低风险） |
| 起诉状解析 parsePleading | `src/server/ai/parse-pleading.ts` | intakes.create | 无（请求体内文件） | 用户当次上传文件 | 通过（低风险） |
| 案由推荐 recommendCause | `src/server/ai/recommend-cause.ts` | intakes.create | 无（用户输入描述） | 用户自填描述 | 通过（低风险） |
| 发票识别 recognizeInvoiceFromImage | `src/server/ai/actions.ts` | finance.write | 无（请求体内文件） | 发票图片 | 通过（低风险） |
| 短信 AI 解析 parseAndSaveSms | `src/server/sms/actions.ts` | matters.write | 无（请求体内文本） | 短信文本 | 通过（低风险） |
| 证件识别 recognizeIdentityDocument | `src/server/identity-documents/recognition.ts` | requireSystemAdmin | 仅 SUPER_ADMIN；**非本地服务时 remoteConsent 服务端强制** | 证件照片（提示词排除地址等敏感字段） | 通过 |
| AI 设置读写 | `src/server/settings/ai-actions.ts` | requireSystemAdmin | — | 无业务数据 | 通过 |

### 1.2 C07 修复实现

- 新增 `src/server/ai/document-access.ts`：`assertCanReviewDocument(session, doc)` —— matterId → 案件可见性断言；intakeId → 收案归属断言（创建人/主办/协办/管理岗，与上传路径 `documents/actions.ts` 同口径）；两者皆无 → 拒绝。
- `review-document.ts`、`review-history.ts` 的 `if (doc.matterId)` 条件分支替换为统一断言。
- 核验边界：静态核查，未做渗透测试；越权路径的自动化用例列入跨入口越权回归（P1 补端到端）。

## 二、已完成：P0-5 提醒配置打通与投递结果可见

- `src/lib/deadline-reminders.ts`（新增）：偏移并集纯函数。单期限有效档 = {-3,-1} ∪ {-remindDays} ∪ {0,+1}；默认值 3 时行为与历史完全一致；非法值（0/负/小数/NaN）不产生新档。测试 `src/tests/lib/deadline-reminders.test.ts` 9 例全过。
- `src/server/cron/jobs/scan-due-reminders.ts`：按在办期限的 distinct remindDays 求扫描档并集；逐条期限再按自身有效档过滤（配置差异静默跳过，不占去重数）。开庭提醒固定档不变；保全提醒独立路径未动。
- `src/server/settings/webhook-last-result.ts`（新增）：最近一次扫描与推送结果写 `SystemSetting`（key `reminder-webhook-last-result`），含 ok/skipped/skipReason/error 与各计数；读取端防御式解析。
- 管理后台「提醒维护」页新增 `LastScanResultCard`：扫描时间、新提醒数、群机器人推送状态（成功/跳过/失败+原因）。

## 三、待实施六项设计

### P0-1 客户主数据查重与合并【需迁移】

**唯一性策略（报告 v5 定稿：身份持续唯一）**：停用/软删除客户仍占用身份，重复经恢复或合并处理。

Schema 草案（生成 SQL 后须批准）：

```prisma
model Client {
  idType     String?   // 新增：证件类型码（复用 UserIdentityDocument 的类型枚举值）
  idNumber   String?   // 既有；入库前规范化（trim；身份证尾号 x 统一大写）
  // 唯一性：部分唯一索引，仅约束已填号码的行
  @@index([idType, idNumber])  // 替换现有单列索引
}
```

```sql
-- 迁移草案示意（实际以 create-only 生成为准）
ALTER TABLE "Client" ADD COLUMN "idType" TEXT;
UPDATE "Client" SET "idNumber" = UPPER(TRIM("idNumber")) WHERE "idNumber" IS NOT NULL;
CREATE UNIQUE INDEX "Client_idType_idNumber_key"
  ON "Client"("idType", "idNumber")
  WHERE "idNumber" IS NOT NULL AND "deletedAt" IS NULL;
-- 预检：先跑重复检测 SELECT，存量重复先合并再加索引
```

实施顺序：①存量重复检测报告（名称相似+号码相同）→ ②人工合并（合并只调整当前主体关联，不改写历史冲突核查/审批/委托/成果中的身份快照；保留原 ID 映射与合并依据，写审计）→ ③加字段与索引 → ④三入口（建档/收案/导入）统一走查重服务（名称+证件号两级匹配；匹配复用与存量合并分别验收）。

验收：三入口拦截重复建档；唯一索引生效（软删行不释放身份）；合并后历史记录身份快照不变。

### P0-2 文档文本层与全文检索【需迁移】

Schema 草案：Document 增加 `textContent TEXT?`（抽取纯文本）、`pageCount INT?`、`ocrStatus enum(PENDING/READY/FAILED/SKIP)?`、`textSource enum(DOCX/PDF_TEXT/OCR/MANUAL)?`。

实施顺序：①检索方案验证——zhparser vs pg_bigm，样本：案号、人名、长卷宗、扫描 OCR 文本，指标为召回、权限过滤可组合性、维护成本（扩展安装复杂度是自部署痛点，pg_bigm 免编译优先）；②抽取管道：docx 走 mammoth（已在 review-document 用）、PDF 文本层走 unpdf（同上）、无文本扫描件**暂标 SKIP**（通用卷宗 OCR 是 P1 评估项，见报告 5.3 复用边界）；③搜索入口：现有 `src/server/search/actions.ts` 扩展，**正文/摘要/片段按对应源文档读取授权过滤**（读案件概况 ≠ 可读附件正文），覆盖收案材料与申请附件；条目数与摘要不泄露无权内容。

上线底线（报告 10.1）：版本关联、页码定位、授权检查、失败状态四项同步具备——`familyId` 在上传路径真正启用是前置（现为零使用死字段）。

### P0-3 登录失败锁定与双步验证【需迁移】

Schema 草案：User 增加 `failedLoginAttempts INT @default(0)`、`lockedUntil DATETIME?`。锁定策略：5 次失败锁 15 分钟（ escalating 可后调）；成功登录清零；锁定尝试写审计（不含 IP 之外的 PII）。TOTP 后置到 P1（需要密钥列+恢复码设计，单独方案）。

### P0-6 财务确认口径与删除限制（无迁移，代码守卫）

- 确认口径定义（写入 DATA-MODEL.md）：`Billing.signedAt` = 合同签署（收费安排成立）；FeeEntry 依据 `occurredAt`+是否被开票申请引用判定"已确认"。对账单确认概念本期不引入（报告 5.4）。
- 守卫：`deleteBilling` 拒绝 `signedAt != null`；`deleteFeeEntry` 拒绝已被 InvoiceRequest 引用或属于已签署 Billing 的条目；错误信息说明改走冲正（核销模型为 P1）。
- 发号验证：编写并发测试（两个并行 createClient 模拟序列化冲突重试），确认 code-generator 的重试路径存在且编号不重。

### P0-7 关键动作审计同事务（无迁移）

- 新增 `auditTx(tx, params)`（接收 Prisma 事务客户端，失败抛错）与既有 `audit()`（吞错，仅普通日志）并存。
- 改造清单（关键动作）：权限/角色变更、审批通过/驳回、已确认财务记录删除守卫触发时、证件明文查看。改造点沿 `roleMutation`/`approvalTransaction` 既有事务入口插入。
- 原则：审计失败 → 关键动作整体回滚不返回成功；普通动作维持现状。

### P0-8 期限来源结构化与修正保护【需迁移】

Schema 草案：Deadline 增加 `sourceRuleId STRING?`（引用 DeadlineRule）、`startFact STRING?`（起算事实描述）、`sourceDocumentId STRING?`（来源材料）、`confirmStatus enum(PENDING/CONFIRMED/ADJUSTED) @default(CONFIRMED)`（存量默认已确认，不回填）、`adjustedById STRING?`、`adjustedAt DATETIME?`。

规则：规则重算/更新只生成 `PENDING` 的待复核结果，`CONFIRMED/ADJUSTED` 期限不被覆盖；人工调整写 adjustedBy/At 并留审计。补 DeadlineRule 管理 UI（挂账项：增删改界面，数据已就绪）。

## 四、实施顺序建议

1. 无迁移项先行：P0-6、P0-7（纯代码，可独立验收）；
2. P0-1 存量重复检测（只读）与 P0-2 检索方案验证（只读评估）并行；
3. 三份迁移草案（P0-1/P0-3/P0-8，P0-2 视检索选型定）一次性打包走 create-only → 展示 SQL → 批准后执行；
4. 端到端验收按报告 10.1 上线安全底线六条。

## 五、验证与回归基线

- 每项完成后：`npm run lint && npm run typecheck && npx vitest run`（全量）；
- UI 金线走查 + 本地站点可访问性确认（端口 3000 归属本仓库进程）；
- 本轮已完成项的基线：typecheck ✓、lint ✓、deadline-reminders 9/9 ✓。
