# 用户身份证件与照片识别改造方案

日期：2026-09-06。状态：代码、测试及正式迁移 SQL 已完成；等待叶森单独确认执行数据库迁移，执行后完成已登录浏览器金线验收。

## 一、要解决的问题

当前 `User.idNumber` 只允许 18 位中国大陆居民身份证号码，新增用户时也没有证件类型、证件照片或自动识别入口。这会把“稳定身份标识”错误地等同于居民身份证，无法覆盖港澳台居民、持护照人员及其他特殊人员。

本次目标是：新增用户时先选择证件类型、上传证件照片、按需自动识别姓名和证件号码，再由管理员核对确认；系统以“证件类型 + 规范化证件号码”识别人员，联系方式变更不影响历史业务归属。

## 二、证件类型

首期采用以下类型，并保留兜底项：

| 系统值 | 界面名称 | 照片要求 | 号码校验 |
|---|---|---|---|
| `PRC_RESIDENT_ID` | 中华人民共和国居民身份证 | 人像面必传，国徽面建议上传 | 18 位、出生日期及校验位严格校验 |
| `HK_MACAO_TAIWAN_RESIDENCE_PERMIT` | 港澳台居民居住证 | 人像面必传，另一面建议上传 | 18 位居民身份号码规则校验 |
| `PRC_HK_MACAO_TRAVEL_PERMIT` | 往来港澳通行证 | 资料页必传 | 大写字母与数字，人工核对 |
| `HK_MACAO_MAINLAND_TRAVEL_PERMIT` | 港澳居民来往内地通行证（回乡证） | 资料页必传 | 大写字母与数字，人工核对 |
| `TAIWAN_MAINLAND_TRAVEL_PERMIT` | 台湾居民来往大陆通行证（台胞证） | 资料页必传 | 大写字母与数字，人工核对 |
| `PASSPORT` | 护照 | 个人资料页必传 | 大写字母与数字，人工核对；不假定单一国家格式 |
| `FOREIGN_PERMANENT_RESIDENT_ID` | 外国人永久居留身份证 | 人像面必传，另一面建议上传 | 大写字母与数字，人工核对 |
| `OTHER` | 其他身份证件 | 资料页必传 | 5 至 50 位，人工核对；必须填写证件名称 |

“港澳台居民居住证”在界面中根据管理员选择进一步显示“香港／澳门／台湾”，但数据库可先使用一个类型；其号码仍按 18 位规则校验。若后续统计确需区分，再增加 `identityDocumentRegion`，本期不把地区从号码中推断为已核实事实。

## 三、新增用户交互

“新增用户”抽屉调整为以下顺序：

1. 姓名、邮箱、手机号、初始密码、角色。
2. 证件类型；选择“其他身份证件”时补填证件名称。
3. 上传证件照片：支持 JPG、PNG、WebP，单张不超过 10MB，最多两张；居民身份证类标示人像面/另一面，护照及通行证标示个人资料页/补充页。
4. 上传后显示本地缩略预览、替换和移除；尚未创建用户前不生成可公开访问的 URL。
5. “自动识别”是单独按钮，不因选择或上传自动调用。调用前显示当前 AI 服务域名；非本地服务明确提示证件照片将发送给该服务进行识别，并要求管理员当次确认。
6. 识别仅预填“证件类型、姓名、证件号码”；同时展示置信提示和“请对照原件核对”。不得从民族、住址、出生日期、性别等字段推导权限或人员属性，本期也不保存这些非必要信息。
7. 管理员可修正识别结果。创建时必须已有至少一张照片、证件类型和证件号码；AI 未配置或识别失败时，允许管理员对照照片手工录入后创建。
8. OCR 识别值与管理员最终确认值不一致时，以管理员确认值为准，审计仅记录“识别后人工修改了哪些字段”，不记录号码明文。

## 四、个人资料和用户管理同步修改

- 原个人信息页的“居民身份证号码”改为“身份证件”，展示证件类型、脱敏号码和照片状态。
- 本人仍只能首次登记；登记已有证件后不能自行变更类型、号码或移除照片。管理员可在用户管理中核对并更正，必须填写原因。
- 管理员更正时允许新增照片并将旧照片标记为已被替代；旧文件保留用于审计，不物理删除。
- 本人和超级管理员可查看证件明文及证件图片；普通同事、团队负责人、审批人、财务和自定义角色均不得因原有业务权限查看。
- 每次查看证件号码明文、打开证件图片、自动识别、上传替换及管理员更正均写审计，但日志不得包含姓名以外的证件号码、图片、完整文件名或 AI 原始返回。

## 五、照片存储与下载

证件照片不复用案件 `Document`，单独建立身份文件表，因为案件成员、审批附件及导出权限均不应扩大到人员证件。

- 图片入库前校验声明 MIME、文件头和扩展名，只允许 JPG、PNG、WebP；SVG、PDF、HEIC 和动图首期拒绝。
- 原图始终使用既有 AES-256-GCM 加密后写入私有 `storage/user-identities/{userId}` 范围，数据库只保存密文路径、大小、SHA-256、加密参数和页别。
- 下载/预览只能走鉴权 API，响应使用 `Cache-Control: no-store`，不提供公开直链，不进入案件归档、通用导出、全局搜索或备份以外的批量资料导出。
- 浏览器预览按需读取解密，不把 base64 图片写入页面源数据、日志或会话。
- 新增用户失败时不得留下可访问的孤立图片；实现采用预生成用户编号、文件写入和数据库事务状态校验。若数据库提交失败，密文孤立文件进入仅管理员可运行的待清理清单，不在用户请求中静默物理删除。

## 六、OCR 边界

首期复用现有 OpenAI 兼容视觉接口，不新增全局依赖、不修改 Docker 或 CI。识别提示按证件类型返回最小 JSON：

```json
{
  "documentType": "证件类型系统值或 UNKNOWN",
  "name": "姓名",
  "documentNumber": "证件号码",
  "confidence": "HIGH | MEDIUM | LOW"
}
```

- 发送前先压缩为足以识别号码的图片，剥离 EXIF；不发送系统内其他用户资料。
- 不持久化 AI 原始响应，不在错误消息中回显供应商响应正文。
- OCR 不是实名认证或证件真伪鉴定。系统只显示“已登记／已人工核对”，不得显示“实名认证通过”。
- 对居民身份证号码执行本地校验位复核；对其他证件只做规范化、长度和字符集校验，并要求人工确认。
- AI 未配置时显示“请手工录入，或先配置视觉识别服务”；用户创建不依赖 AI 成功。

## 七、拟议数据模型

现有 `User.idNumber` 改为通用证件号，并用复合唯一约束保证同一类型下不重复：

```prisma
enum IdentityDocumentType {
  PRC_RESIDENT_ID
  HK_MACAO_TAIWAN_RESIDENCE_PERMIT
  PRC_HK_MACAO_TRAVEL_PERMIT
  HK_MACAO_MAINLAND_TRAVEL_PERMIT
  TAIWAN_MAINLAND_TRAVEL_PERMIT
  PASSPORT
  FOREIGN_PERMANENT_RESIDENT_ID
  OTHER
}

enum IdentityDocumentPageKind {
  PORTRAIT_SIDE
  EMBLEM_SIDE
  DATA_PAGE
  SUPPLEMENTARY_PAGE
  OTHER
}

model User {
  // 其余字段不变
  identityDocumentType  IdentityDocumentType?
  identityDocumentName  String? @db.VarChar(60)
  identityDocumentNumber String? @db.VarChar(50)
  identityDocuments     UserIdentityDocument[] @relation("IdentityOwner")
  uploadedIdentityDocuments UserIdentityDocument[] @relation("IdentityUploader")

  @@unique([identityDocumentType, identityDocumentNumber])
}

model UserIdentityDocument {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation("IdentityOwner", fields: [userId], references: [id], onDelete: Restrict)
  pageKind    IdentityDocumentPageKind
  path        String
  mimeType    String
  size        Int
  sha256      String
  algorithm   String
  iv          String
  authTag     String
  uploadedById String
  uploadedBy  User     @relation("IdentityUploader", fields: [uploadedById], references: [id], onDelete: Restrict)
  active      Boolean  @default(true)
  supersededAt DateTime?
  createdAt   DateTime @default(now())

  @@index([userId, active])
  @@index([uploadedById, createdAt])
}
```

`uploadedById` 建立独立的上传人关系并使用 `onDelete: Restrict`；账号停用不影响历史身份文件和上传审计。

## 八、迁移 SQL 范围草案

正式 SQL 必须由修改前后 Schema 生成并再次核对；预计只包含：

1. 新增 `IdentityDocumentType`、`IdentityDocumentPageKind` 枚举。
2. 将 `User.idNumber` 重命名为 `identityDocumentNumber`，长度由 18 扩至 50；不删除、复制或清空现有号码。
3. 新增 `identityDocumentType`、`identityDocumentName`；现有非空号码回填为 `PRC_RESIDENT_ID`。
4. 移除旧的单列唯一索引，新增“证件类型 + 证件号码”复合唯一索引。
5. 增加数据库检查约束：类型和号码必须同时为空或同时非空；`OTHER` 必须有自定义证件名称，其他类型不得保存自定义名称。
6. 新建 `UserIdentityDocument` 及索引、所有者外键，不删除现有表或业务关系。

迁移不会为历史用户伪造证件照片。已有号码保留并标为居民身份证；无号码账号仍可正常登录，但管理员新增用户时开始执行新规则。

## 九、实现目录

- 证件枚举、格式与脱敏：`src/lib/identity-documents/`
- OCR 适配及最小提示：`src/server/identity-documents/recognition.ts`
- 创建、查看、更正和文件鉴权：`src/server/identity-documents/`
- 私有预览 API：`src/app/api/users/[userId]/identity-documents/[fileId]/route.ts`
- 新增用户及个人资料 UI：现有用户管理页、`src/components/users/`
- 测试：`src/tests/lib/identity-documents.test.ts`、`src/tests/server/identity-documents.test.ts` 及表单测试

## 十、验收

- 各证件类型可选，名称准确区分往来港澳通行证和回乡证；“其他”必须填写名称。
- 居民身份证严格校验，其他证件号码可规范录入；同类型同号码不能创建第二账号，不同类型不会误冲突。
- 上传文件的类型、大小、文件头和张数限制有效；数据库及磁盘均不保存明文原图。
- OCR 发送前明确目标服务，拒绝后不发送；识别失败可手工录入；不会保存 AI 原始结果。
- 普通用户不能通过猜测 API、文件编号或路径读取他人证件；本人和管理员查看均有审计。
- 更正保留旧图并标记被替代；证件变更不改变 `User.id` 及历史案件、审批、团队、财务归属。
- 完成相关测试、全量测试、lint、typecheck、Prisma validate、build，并在已登录浏览器走通新增用户（不实际创建测试账号）、管理员更正和本人查看流程；确认 3000 端口属于本仓库。
