# LawLink

**事有经纬，案有始终。**

LawLink 是面向独立律师、小团队和中小律所的开源、自部署案件 / 项目管理系统。一家律所或团队部署一套实例，使用自己的数据库和文件存储。

`收案登记 → 冲突检索 → 转正式案件 → 持续跟进 → 财务记录 → 结案归档 → 数据导出`

> 当前正式版：**[v2.0.1](https://github.com/lawflow-boop/LawLink/releases/tag/v2.0.1)**（修补容器镜像缺少 `openssl` 导致 Docker 部署不可用；业务逻辑与数据库结构同 v2.0.0，源码方式部署的实例不受影响）。v2.0.0，以 `597404b` 为基线并补充提醒测试时钟修复，包含升级路径、数据库守卫及完整业务主流程验收修复。旧文档及升级脚本中的 1.4.0 为内部名称，对外版本为 2.0.0。见[正式发布说明](./docs/RELEASE-NOTES-v2.0.0.md)。

> **依赖安全维护（最近核对 2026-09-21）**：2026-09-21 复审时 `nodemailer` 出现 2 项 high 级公告（≤9.1.0），已升级至 10.x 并加 `overrides` 固定，复审后全量与生产依赖审计均为 0 个已知漏洞。审计结果按核对日期计，**不随时间自动成立**——部署与升级前请自行重跑 `npm audit`。该结果不等于系统安全认证，正式部署仍须完成权限与备份恢复验收。详见[安全状态](./SECURITY.md#依赖审计状态)。

> **验证范围**：已补齐升级路径和数据库守卫，仍未覆盖多用户并发、OCR 可信度、全部短信平台兼容性及借阅到期真实时间验证。详见[验证记录](./docs/RELEASE-VALIDATION-v2.0.0.md)。

## 本版提供什么

| 能力 | 说明 |
|---|---|
| 墨案与案卷工作台 | 全新界面；案件档案、办案进程、委托与财务、审批用印按程序和环节组织 |
| 法院来件 | 短信保存、附件提取、可选 OCR/AI 阅读、整理建议与律师确认；失败可人工接续 |
| 财务与对账 | 实收登记后确认、应收核销、发票关联、补充协议及财务更正 |
| 期限与提醒 | 送达台账、保全补扫、邮件通道状态及放假安排核对提示 |
| 独立管理后台 | `/admin` 集中管理律所、人员、岗位角色、律师团队、审批权限、归档制度和外部接入 |
| 岗位与团队 | 内置及自定义岗位；常设律师团队与案件承办人员分开管理 |
| 统一审批 | `/approvals` 集中处理收案、文书、归档、开票及用章，保留处理记录并区分批准与后续执行 |
| 归档与借阅 | 本所制度、送审快照、归档收尾、补充归档及限时只读借阅 |
| 个人资料 | 本人资料及登录安全；人员证件资料、照片加密存储与访问审计 |
| 可选接入 | AI、元典、日历订阅、群机器人提醒等；外部服务须另行配置并自行承担服务费用 |

**配置前须理解的边界：**

- 系统管理员、业务岗位、事项审批是三种不同资格。超级管理员不会自动取得全所案件、财务或审批权限。
- 团队只读权限不等于案件编辑、财务查看、附件下载或导出权限；审批权只开放对应申请所需资料。
- 默认禁止审批本人申请。单人执业须显式设置本人审批例外，仍须匹配事项授权及印章规则。
- 未配置本所归档制度时不能提交正式归档；电子文件存在、申请人勾选、审批人确认不能混为一谈。
- 证件识别只作录入辅助，不是实名认证或真伪鉴定。期限计算、冲突命中和 AI 输出都需要人工核对。

## 安装与升级

- **云服务器安装**：按[安装指南](./docs/CLOUD-SERVER-INSTALLATION-GUIDE.md)配置端口、HTTPS、初始化和备份。基础 Compose 文件是开发起点，不是完成生产配置的一键部署。
- **已有 1.3.x 部署**：按[升级指南](./docs/RELEASE-GUIDE-v1.3.md)执行增量 SQL → 标记 `0_init` → 标记 `20260921000004_archive_borrow` → `migrate deploy`。先备份、停止写入、在副本演练；不要沿用 RC1 前的两步说明。
- **首次登录**：先设置独立账号、岗位、团队、审批权限和归档制度。完整步骤见[首次配置清单](./docs/RELEASE-GUIDE-v2.md#首次登录后的配置顺序)。
- **版本选择**：部署固定版本标签。`main` 可能继续演进，不能以今天的分支内容推断旧标签包含的功能。

## 本地开发与试用

准备 Node.js 22（与仓库 CI 和容器版本一致）及 PostgreSQL 16。下列命令用于全新的本地试用环境；已有数据库先阅读升级说明。

```bash
git clone --branch v2.0.0 --depth 1 https://github.com/lawflow-boop/LawLink.git
cd LawLink
cp .env.example .env
```

编辑 `.env`，使数据库连接与 Compose 数据库账号一致，设置 `SEED_ADMIN_EMAIL` 和强密码，并分别生成 `NEXTAUTH_SECRET`、`STORAGE_ENCRYPTION_KEY`：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

保管好这两个独立值，然后执行：

```bash
docker compose up -d db
npm ci
npm run prisma:generate
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

打开 [本地登录页](http://localhost:3000/login)，用首次 seed 时设置的账号登录。模板中的 `admin@lawlink.local` / `ChangeMe!2026` 仅供本地试用；公开部署前须更换。已有账号不会因修改 `.env` 或重跑 seed 而改密码；不要用清空数据库的方式处理忘记密码。

个人资料与登录安全位于 `/settings/profile`。开发使用 `.next-dev`，生产构建使用 `.next-build`。

> **备份（容器部署必读）**：`docker compose --profile full up` 的 app 容器每天 02:30 自动备份数据库与文件存储到 `/app/backups`（部署方可通过容器环境设置 `BACKUP_DIR` 或 `BACKUP_CRON_ENABLED=false`；仅在宿主机 `.env` 填写但未传入容器不会生效）。compose 已挂载 `backups` 命名卷，但命名卷仍在 Docker 管理区——**生产部署应把该卷改为绑定宿主机目录或异地路径**，否则备份与数据同生共死。备份含凭据哈希与加密材料，建议设置 `BACKUP_PASSPHRASE` 自动加密后再外传（见 `scripts/backup.sh` 头部说明）。

## 验证

```bash
npm run lint
npm run typecheck
npm run prisma:validate
npm run test:run
npm run build
```

CI 另用独立影子数据库检查迁移与模型一致性，并在另一个空数据库验证完整迁移、初始化和基础查询。测试通过不等于本所生产部署或安全审计已经完成。

## 技术栈

Next.js 16 / React 19 / TypeScript；shadcn/ui、Tailwind CSS、Framer Motion；PostgreSQL 16 / Prisma 5；NextAuth.js；TanStack Table、Recharts。界面采用高密度浅色工作台。

## 文档索引

| 文档 | 用途 |
|---|---|
| [本版使用与升级说明](./docs/RELEASE-GUIDE-v2.md) | 当前功能边界、首次配置、旧版迁移注意事项 |
| [云服务器安装指南](./docs/CLOUD-SERVER-INSTALLATION-GUIDE.md) | 固定版本、HTTPS、初始化、备份与更新 |
| [2.0 发布说明](./docs/RELEASE-NOTES-v2.0.0.md) | 相对 1.0 的累计变化与已知限制 |
| [本次发布验证](./docs/RELEASE-VALIDATION-v2.0.0.md) | 独立发布副本的检查结果与未覆盖范围 |
| [变更记录](./CHANGELOG.md) | 各版本变更与验证范围 |
| [路线图](./docs/ROADMAP.md) | 已实现能力与后续方向，非排期承诺 |
| [安全说明](./SECURITY.md) | 部署方职责及私密漏洞报告方式 |
| [工作区规则](./AGENTS.md) / [贡献说明](./CONTRIBUTING.md) | 协作规范 |
| [PRD](./docs/PRD.md) / [数据模型](./docs/DATA-MODEL.md) / [UI 规范](./docs/UI-DESIGN.md) | 当前设计入口与历史演进记录；旧章节不作为当前授权依据 |
| [公开发布检查清单](./docs/PUBLIC_RELEASE_CHECKLIST.md) | 敏感资料与交付检查 |
| [早期发布体检记录](./docs/PUBLISH_READINESS_REPORT.md) | 历史检查结果，不代表当前安全状态 |

## 协议与使用边界

[MIT](./LICENSE) — 可使用、修改和商用。LawLink 是通用案件管理软件，不提供法律意见，不替代律师的专业判断。部署方应结合自己的数据与使用场景评估保密、个人信息保护及档案管理要求。

### 公开版的数据范围

公开发行不包含开发者本地的模拟测试案件、客户、财务记录、附件或数据库备份。全新安装只初始化管理员账号及案由、模板、期限规则等系统基础配置，业务列表为空。源码测试中的虚构样例用于自动验证，不会导入业务数据库；界面设计稿中的示例也不是安装数据。升级保留业务数据，必须按支持的起始版本和升级指南执行；不得以清库重装代替升级。
