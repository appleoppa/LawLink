# LawLink

LawLink 是一个开源、自部署的律师案件 / 项目管理系统，主要面向中小律所，也适用于独立律师和小团队自部署使用。

第一版围绕律师日常办案主线：

`收案登记 → 冲突检索 → 转正式案件 → 持续跟进 → 财务记录 → 结案归档 → 数据导出`

> 项目状态：早期版本。适合本地试用、二次开发和自部署评估；正式用于真实案件前，请先完成服务器安全、备份、权限和密钥管理配置。

## 技术栈

- **框架**：Next.js 16 App Router + TypeScript
- **UI**：shadcn/ui + Tailwind CSS + Framer Motion（深色科技感）
- **数据库**：PostgreSQL 16 + Prisma 5
- **鉴权**：NextAuth.js（Credentials Provider）
- **图表**：Recharts
- **表格**：TanStack Table
- **部署**：Docker Compose 一键起

## 文档

| 文件 | 内容 |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | 工作区规则（所有协作者必读）|
| [`docs/PRD.md`](./docs/PRD.md) | 产品需求与功能范围 |
| [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) | 数据模型详细设计 |
| [`docs/UI-DESIGN.md`](./docs/UI-DESIGN.md) | 设计语言 + 关键页面 wireframe |
| [`docs/PUBLIC_RELEASE_CHECKLIST.md`](./docs/PUBLIC_RELEASE_CHECKLIST.md) | GitHub 公开发布前的敏感数据与打包检查 |
| [`docs/GITHUB_PUBLISHING_GUIDE.md`](./docs/GITHUB_PUBLISHING_GUIDE.md) | 第一次发布到 GitHub 的操作手册 |
| [`docs/PUBLISH_READINESS_REPORT.md`](./docs/PUBLISH_READINESS_REPORT.md) | 当前发布准备度体检报告 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 贡献说明 |
| [`SECURITY.md`](./SECURITY.md) | 安全问题报告方式 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 版本变更记录 |

## 本地开发

### 1. 准备环境

- Node.js 20.9+
- PostgreSQL 16（本地建议用 Docker Compose 启动）

```bash
cp .env.example .env

# 生成 NEXTAUTH_SECRET 和 STORAGE_ENCRYPTION_KEY
openssl rand -base64 32   # 复制到 .env 的 NEXTAUTH_SECRET
openssl rand -base64 32   # 复制到 .env 的 STORAGE_ENCRYPTION_KEY
```

### 2. 启动数据库（Docker Compose）

```bash
docker compose up -d db
```

只起 Postgres 容器；应用本地用 `npm run dev` 起。

### 3. 初始化 schema 与 seed

```bash
npm install                       # 首次
npx prisma migrate dev
npx prisma db seed                # 创建 admin 账号 + 案由库样本
```

### 4. 启动 dev

```bash
npm run dev
```

打开 http://localhost:3000，用初始管理员账号登录：

- 邮箱：`admin@lawlink.local`
- 密码：`ChangeMe!2026`

以上值来自 `.env.example`。如果你已经修改过 `.env` 里的 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`，以 `.env` 中的实际值为准。公开部署或正式试用前，请先把 `SEED_ADMIN_PASSWORD` 改成强密码，再执行 seed；首次登录后也应在系统设置中修改密码。

旧版本用户说明：如果你此前已经从 GitHub 下载过 LawLink，并且已经执行过 `npx prisma db seed`，更新 README 或 `.env.example` 不会自动修改数据库里已有管理员的密码。请优先使用当时 `.env` 中的 `SEED_ADMIN_PASSWORD` 登录；如果当时沿用了旧版占位值，密码可能是 `REPLACE_BEFORE_FIRST_LOGIN`。忘记密码时，可以重新初始化本地测试数据库，或在数据库中重置管理员密码哈希。

本地开发使用 `.next-dev`，生产构建使用 `.next-build`，避免 `npm run build` 后覆盖正在运行的开发缓存导致页面不渲染。

## 验证

```bash
npm run lint              # ESLint CLI
npm run typecheck         # tsc --noEmit
npm run prisma:validate   # Prisma schema 校验
npm run build             # 生产构建（最严的检查）
```

## 全栈 Docker 部署

应用容器默认不启动。要起完整环境（db + app）：

```bash
docker compose --profile full up -d
```

## 与上游的差异

本仓库基于 [lawflow-boop/LawLink](https://github.com/lawflow-boop/LawLink) 派生，在其上增加了面向律师日常办案的若干增强（均为可选能力，不影响核心收案-结案流程）：

- **办案工作流门禁**：案件详情页内置多角色复核任务（承办/证据/律法/审计等角色分派与回执），适合小团队协作办案。
- **法律数据检索**：案件详情页集成元典开放平台检索（案例 / 法规 / 企业），API key 在设置页自行配置；法规检索支持按效力级别与时效性过滤。
- **本地裁判文书检索**：可选对接本地部署的 [cncases](https://github.com/cncases/cases) 服务（约 8500 万份公开裁判文书），数据不出内网。
- **程序文书显示**：案件程序性文书（送达、开庭、保全等）结构化展示与快速操作。
- **工具与运营**：诉讼费用计算器、传票本地解析、审计日志、周报推送。

> 注：元典检索需自行申请开放平台 API key；本地裁判文书检索需自行部署 cncases 并挂载数据盘。二者均未配置时系统核心功能不受影响。

## 协议

[MIT](./LICENSE) — 自由使用、修改、商用。

## 免责声明

LawLink 是通用案件管理软件，不提供法律意见，也不替代律师的专业判断。自行部署和使用时，请遵守所在地关于律师执业、个人信息保护、数据安全、档案管理和保密义务的规则。
