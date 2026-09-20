# 法院短信专项 B1 数据模型与实施设计（2026-09-20）

> 状态：设计稿，供叶森审阅。本文件不执行任何变更；Schema/迁移按 create-only 流程另行生成 SQL 展示后批准执行。A 批已完成部分（全量枚举、回归测试）见文末。
> 依据：`SYSTEM-AUDIT-REMEDIATION-V3-20260920.md` §4/§6/§10；2026-09-20 用户确认：不做特定平台硬编码清单、OCR 用云 API provider。

## 1. B1 目标边界

B1 交付「可靠收件和取件」：原文即时保存、私有来件暂存、多链接多文件全量清单、后台队列、状态细分、去重幂等、人工接续。**不含**：OCR/AI 阅读（B2）、匹配确认与正式应用（B3）。

已在本轮先行落地（不依赖新表）：
- ✅ 全量枚举：一个送达页挂多份文书时逐件取件逐件记录，部分失败显示部分完成（`src/server/sms/attachments.ts`，回归 `src/tests/server/sms-attachments-enumeration.test.ts` 4 例）。
- ✅ 同案内容哈希去重保持（ALREADY_DOWNLOADED）。

## 2. 数据模型（新增/扩展）

### 2.1 SmsMessage 扩展（不改既有列语义）

| 新增列 | 类型 | 说明 |
| --- | --- | --- |
| `rawTextHash` | String | 原文 SHA256；与 receivedById 组成部分唯一索引——重复粘贴/双击幂等，服务端与 DB 约束双保险 |
| `processingState` | SmsProcessingState | 状态机（见 2.3）；`processed` 布尔保留为「人工处置标记」语义不变，二者并存迁移期后评估收敛 |
| `processingNote` | String? | 状态说明（部分失败的原因汇总、人工处置去向） |

### 2.2 新表 SmsInboundFile（来件文件——私有暂存区的载体）

```
model SmsInboundFile {
  id              String   @id @default(cuid())
  smsId           String   // → SmsMessage， onDelete: Restrict（来件原文不灭，文件不悬空）
  sms             SmsMessage @relation(...)
  // 归属：B1 阶段下载即挂匹配案（现行为保持）；未匹配案件时 matterId 为空＝分诊人私有来件区
  matterId        String?  // → Matter, onDelete: SetNull
  documentId      String?  // → Document, onDelete: SetNull（确认转正式材料后的映射）
  sourceUrl       String   // 取件来源链接（含页面 URL）
  storageKey      String   // 私有存储键（storage/sms-inbound/…，不暴露直链）
  originalName    String   // 平台原始文件名（保留）
  displayName     String?  // 规范化显示名（B2 AI 命名后回填）
  mimeType        String
  size            Int
  sha256          String
  downloadedAt    DateTime @default(now())   // 与粘贴时间 receivedAt、文书落款时间（B2 提取）分离
  downloadedById  String   // → User, onDelete: Restrict
  uploadSource    SmsFileSource @default(LINK_FETCH)  // LINK_FETCH（自动取件）| MANUAL_UPLOAD（人工接续补传）
  state           SmsFileState @default(PENDING_REVIEW)

  @@unique([smsId, sha256])          // 同一来件内同内容不重复存；重复送达事件仍各自成行（不同 smsId）
  @@index([matterId, state])
  @@index([downloadedById, state])
}
```

要点：
- **文件先入暂存、确认后转正**：`documentId` 为空表示尚未成为正式案件材料；B3 确认应用时创建 Document 并回填映射。B1 阶段对已匹配案件的下载仍即时转正（现行为），`state=FILED`；未匹配案件（B1 新增能力）文件留在私有区 `state=PENDING_REVIEW`，匹配后走既有转正路径。
- **人工接续**：`uploadSource=MANUAL_UPLOAD` 的行由律师在「需登录/验证码平台」的来件卡补传产生，与自动取件文件同一分析流程（B2 起），不重新登记短信。
- 磁盘文件不物理删除；错误归属经有权人纠正时只改 matterId 映射并留审计，不抹处理历史。

### 2.3 枚举

```
enum SmsProcessingState {
  PROCESSING        // 后台取件/解析进行中
  NEEDS_MANUAL_FETCH// 需人工接续（登录/验证码/暂不支持平台）
  NEEDS_MATCH       // 已取件、未匹配案件（私有来件区）
  PARTIAL           // 部分文件失败（显示 N/M，可重试或补传）
  READY_FOR_REVIEW  // 已取全、待 B3 律师确认（B1 阶段=待人工处理）
  ORGANIZED         // 已整理（文件有明确处置、建议已确认/拒绝）
  NO_ACTION_NEEDED  // 无需处理（明确标记，与「未处理」区分）
}

enum SmsFileState {
  PENDING_REVIEW    // 待确认（私有区/待 B3）
  FILED             // 已转正式案件材料
  FAILED            // 取件失败（保留原因，可重试）
  SUPERSEDED        // 被补传/换开替代（不删，历史可溯）
}

enum SmsFileSource { LINK_FETCH MANUAL_UPLOAD }
```

### 2.4 拟生成迁移 SQL 范围（create-only 后展示）

1. `ALTER TABLE "SmsMessage" ADD COLUMN "rawTextHash" TEXT NOT NULL DEFAULT ''` + 回填 `UPDATE … SET "rawTextHash" = encode(sha256(rawText::bytea),'hex')` + 部分唯一索引（`receivedById, rawTextHash`，仅约束非空原文）。
2. `ALTER TABLE "SmsMessage" ADD COLUMN "processingState" … DEFAULT 'READY_FOR_REVIEW'`（存量按 processed/needsManualAction 回填 NO_ACTION_NEEDED/NEEDS_MANUAL_FETCH）。
3. `CREATE TABLE "SmsInboundFile"` + 三外键 + 两索引 + 唯一约束。
4. 三枚举类型。

存量无破坏：主库现仅演示数据（3 案件 1 收案），回填脚本幂等。

## 3. 取件后台化与队列

- 新 JobQueue 任务类型 `sms.attachment_fetch`：粘贴保存原文（同步、即时落库）后入队，`payload={smsId}`；worker 调 `downloadSmsAttachments` 并逐件写 `SmsInboundFile`、更新 `processingState`。失败重试沿既有队列机制（attempts/DEAD 自愈）；**重复执行幂等**：按 `(smsId, sha256)` 唯一约束 + `ON CONFLICT DO NOTHING`。
- 时间敏感扫描（v3 §3.1.4：临近日期不等附件分析完）在保存原文后同步执行——现有解析已含开庭/期限日期抽取，保留同步路径，队列只承担网络取件。
- `DISABLE_CRON=1` 或队列未运行时：粘贴后状态停在 PROCESSING，来件卡提供「立即提取」手动触发（现入口行为），不静默丢失。

## 4. 人工接续交互（B1 版）

- 来件卡对 `NEEDS_MANUAL_FETCH` 显示：原链接（可点开新窗口）+ 短信内已识别的验证码/提取码（明文复制）+ 「补传文件」入口（多文件）。
- 补传文件与自动取件同规则校验（类型/大小/MIME 服务端推导），写 `SmsInboundFile(uploadSource=MANUAL_UPLOAD)`，状态转 PARTIAL→READY_FOR_REVIEW 视全部文件处置而定。
- 不做浏览器自动化代登录、代签收、代缴费（既定边界）；「标记已处理」保留，但有未处置文件或紧急事项时须填去向说明（processingNote），角标不因标记而掩盖遗漏。

## 5. UI 改造范围（/inbox）

- 来件卡新增：文件清单区（每文件状态徽标、来源、大小、下载时间）、整体处理状态徽标（七态）、「立即提取/重试」「补传文件」「去匹配案件」（NEEDS_MATCH 时）。
- 私有来件区：`NEEDS_MATCH` 的来件在收件人（或受托分诊人）视图单独分组，不进全所检索；匹配入口复用现有案件关联控件（按短信案号/当事人建议，B2 起有文书内容建议）。
- 角标口径不变（开庭/举证/缴费标红），但按 processingState 排除 NO_ACTION_NEEDED。

## 6. 剩余实施清单（B1 批内）

| # | 事项 | 依赖 |
| --- | --- | --- |
| 1 | 迁移 SQL create-only 生成并展示（§2.4） | 叶森批准执行 |
| 2 | schema.prisma 同步 + client generate | 1 |
| 3 | 队列任务 sms.attachment_fetch + 幂等 worker | 2 |
| 4 | SmsInboundFile 服务层（写入/补传/转正/纠错）+ 审计 | 2 |
| 5 | 粘贴流程改造：原文同步保存（rawTextHash 幂等）+ 入队 + 状态机 | 3,4 |
| 6 | /inbox UI（文件清单、七态徽标、补传、私有区分组） | 5 |
| 7 | 未匹配来件「先取件后匹配」路径（取件不再以匹配为前提） | 4,6 |
| 8 | 浏览器验收：v3 §11 前 8 项场景 + 页面金线 | 全部 |

## 7. B2/B3 预留接口（本设计已考虑，不在 B1 实施）

- OCR provider 抽象（云 API，管理后台「外部接入」配置）与逐页文本层/扫描页状态——消费 SmsInboundFile，产出文书页段与字段建议（新表 SmsInboundDocSegment / 建议表，B2 设计另行成文）。
- B3 确认应用：消费建议表，事务内复核权限/版本，正式写 Document/程序字段/事项并回填 documentId。
