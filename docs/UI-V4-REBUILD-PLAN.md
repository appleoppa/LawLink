# LawLink v4「墨案」UI 按效果图全面重建方案

> 状态：2026-09-13 叶森批准执行
> 分支：`ui/v4-rebuild`（起点 22fa4f5 = zcode 在途改动检查点；原始 patch 另存 `backups/zcode-v4-wip-20260913.patch`）
> 设计基准：`docs/mockup/v4/*.html` 与渲染稿 `output/mockup-v4/*.png`
> 系统背景：`docs/LawLink-改进分析报告-v5-20260913.docx`

## 一、为什么重建

016eac5 已把 `design-system.css` 移植为 `src/app/moan.css`，token 到位；但原子组件（`src/components/ui/`）仍是 v3 样式与硬编码色值，多数页面结构仍是旧布局（案件详情下半部分、客户、审批、冲突检索、登录、管理后台等）。在旧页面上换色无法得到效果图，本次以效果图为基准重建页面结构。

## 二、边界

- 不改 Prisma Schema，不改权限、状态机、Server Action 语义；只允许为展示补充查询返回字段。必须改 Schema 才能实现的效果图元素，停下来确认。
- 不删除入口与功能：效果图未画到的旧模块全部归位（见第四节）。
- 不引入 antd 或新全局依赖；图表 Recharts，图标 lucide。
- 不删除文件；被取代且无引用的旧组件列清单确认后再删。
- 不做假功能：
  - 登录页"中文/EN"切换——系统无 i18n，不放；
  - "记住此设备"——会话固定 12h，无对应机制，不放；
  - "AI 辅助录入已开启"——仅在 AI 服务已配置时显示。
- 效果图中的演示数据（金额、人名、案号）一律替换为真实数据；无数据时显示收缩的空状态，不保留有数据时的首屏高度。

## 三、基础层

| 层 | 文件 | 要求 |
|---|---|---|
| token | `src/app/moan.css`、`src/app/globals.css` | shadcn hsl 变量映射为墨案色值 |
| 原子 | `src/components/ui/*` | button（primary/secondary/ghost/danger/approve，28/34/40）、badge（teal/blue/green/amber/red/violet/slate/bronze/outline）、input/select/textarea、tabs（下划线+分段）、table、card、dialog/sheet、checkbox/switch/tooltip/popover |
| 模式 | `src/components/patterns/*` | PageHeader、Panel、SegmentedNav、ListToolbar、FilterChip、EmptyState、KpiTile、StatusBadge、Timeline、SourceChip、SpineRow、RiskLadder、ProcedureChain、ReviewSeal |
| 壳层 | `src/components/layout/*` | 侧栏（律所名 + 工作区/业务/知识/资料分组 + 计数 + 底部用户卡）、顶栏（⌘K 搜索、通知、按页主操作、用户菜单）、管理后台深墨"系统管理模式"横幅 |

## 四、页面对照

| # | 效果图 | 路由 | 关键组件 |
|---|---|---|---|
| 01 | 登录 | `/login` | 全屏分栏；两步验证码为可展开项 |
| 02 | 工作台 | `/` | 农历（Intl chinese calendar）、今日焦点、KPI、近期日程与期限、待我处理（审批/任务）、实收应收、案件类型、客户来源渠道 |
| 03 | 案件列表 | `/matters` | 案卷脊、筛选 chip、程序阶段进度、风险阶梯、列设置、数字分页；收案列表同范式 |
| 04 | 案件详情 | `/matters/[code]` | 头部 + 信号条 + 程序链 + 三栏（环节导航 / 环节工作区+办案记录+阶段材料 / 团队·当事人·财务速览·最近审批） |
| 05 | 新建收案 | 收案抽屉 | 四步连续表单、客户查重横幅、冲突预检提示 |
| 06 | 冲突检索 | `/conflicts` | 检索主体、命中分级 KPI、命中卡、未命中声明、结论单选、右栏进度与既往记录 |
| 07 | 审批 | `/approvals` | 案卷脊列表 + 宽幅审阅弹窗（摘要条、四页签、右侧固定审批区） |
| 08 | 财务 | `/finance` | KPI、四页签、趋势 + 开票进度、流水表 |
| 09 | 日程 | `/schedule` | 周/月历/列表、五类图例、预警阶梯、即将到来 |
| 10 | 客户详情 | `/clients/[id]` | 疑似重复横幅、头部统计、关联案件、联系人、财务往来、来源渠道、最近动态 |
| 11 | 全局搜索 | ⌘K | 范围 chip、分组结果、片段高亮、页码与来源、识别失败数 |
| 12 | 期限规则库 | `/admin/reminders` | 三步流程、规则表、推算示例、提醒投递记录 |

### 案件详情旧模块归位

| 旧模块 | 新位置 |
|---|---|
| 基本信息、重要事项（期限/开庭）、证据链、委托、自定义字段、类案检索 | 左栏"信息总览"工作区（字段栅格 + Panel） |
| 财务费用、开票 | 右栏"财务速览 · 明细"抽屉 |
| 用印审批 | 右栏"最近审批 · 全部"抽屉 |
| 编辑信息、状态操作 | 头部"···"菜单 |

## 五、无效果图页面范式

- DataIndex（03/08）：archive、reports、inbox、express、seals、preservation、contacts、announcements、notifications、firm-resources、audit、policy、admin 各列表页。
- TransactionForm（05）：开票、用印、归档申请、团队编辑、设置表单。
- 宽幅审阅（07）：五类审批详情。
- 详情类（10）：收案详情。

## 六、验收

每批：lint / typecheck / prisma:validate / build；确认 3000 端口属于本仓库；Playwright 1440 宽截图与效果图并排比对（输出 `output/playwright/v4-rebuild/`）；金线实走；空数据、权限受限、390 宽移动端。

## 执行记录（2026-09-14 收口）

分支 `ui/v4-rebuild`，未 push。起点检查点 `22fa4f5`（zcode 在途改动原样存档，另有 `backups/zcode-v4-wip-20260913.patch`）。

| 批次 | 内容 |
|---|---|
| 基础层 | 墨案 token 映射、原子组件、patterns/moan、moan-pages.css（按效果图 `<style>` 作用域化） |
| 01–12 | 登录、案件详情、审批、冲突检索、收案、案件列表、工作台、财务、日程、客户（详情+列表）、全局搜索、期限规则库 |
| 阶段四 | 无效果图业务页与管理后台统一页头（PageHeader / AdminPageHeader）；收案详情改工作台布局 |
| 阶段五 | 390 宽横向溢出修复、分段/页签窄屏滚动、零散非墨案色值 |

### 效果图元素的如实处理（不做假功能）

- 登录：不做「中文/EN」「记住此设备」。
- 期限规则库：系统不内置节假日表、无「工作日」计算方式与单条补发能力，故不提供「节假日表」「单独补发」按钮；预警档位按 `deadlineReminderOffsets` 真实档位（T-3/T-1/T-0/T+1 ∪ 规则提前档）展示；投递记录读 JobQueue 近 30 天。
- 全局搜索：客户命中补充备注字段；新增期限分组（与日程页同口径授权）；各组最多 20 条，计数显示 20+。
- 客户详情：来源渠道卡展示「所内同渠道客户占比」，不虚构多渠道分布。

### 待确认删除的无引用文件（未删除）

本次重建后变为无引用：`src/components/patterns/review-dialog.module.css`、`src/app/(app)/clients/[id]/_components/client-merge-card.tsx`、`src/app/(app)/matters/[id]/_components/procedure-stage-chain.tsx`、`src/components/ui/separator.tsx`。

检查点前已无引用（zcode 或更早遗留）：dashboard 下 `action-tiles / dashboard-greeting / hero-block / kpi-cards / my-weekly-card / schedule-list`；matters/[id] 下 `add-reminder-dialog / case-search-panel / documents-panel / folders-panel / invoice-section / notes-panel / overview-panel / parties-panel / procedure-info-panel / timeline-panel`；`approvals/seals/_components/seals-view`、`archive/_components/archive-tabs / pending-archive-table`、`settings/profile/_components/calendar-subscription`、`tools/calc/_components/calc-view`；`ui/card / form / progress / skeleton / table`。
