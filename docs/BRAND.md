# LawLink 品牌资产规范

> 当前版本：v1.0
> 最后更新：2026-06-20
> 状态：以默认 favicon 图形作为正式品牌标志，其他探索稿仅作历史参考。

---

## 一、品牌结论

LawLink 当前正式标志采用默认图形：深蓝圆角方底、白色双立柱、teal 横向连接件。

不再把方向盘、流程节点、条文符号等探索稿作为正式方向。原因是默认图形更克制、更稳定，也更适合长期作为开源法律科技产品的应用图标。

## 二、设计解释

### 1. 核心图形

- 白色双立柱：可理解为 `LL` 的抽象结构，也可理解为法律秩序中的支撑立柱。
- teal 横向连接件：表达 `Link`，即案件、客户、材料、程序、期限与财务之间的连接。
- 底部 teal 基座：表达系统底座和工作流承载能力。
- 深蓝圆角底：表达专业、稳重、可信赖，同时保持现代应用图标感。

### 2. 设计原则

- 优先保持几何稳定，不追求复杂隐喻。
- 不使用天平、法槌、法院立柱等过度传统的法律符号。
- 不为了“法律感”牺牲产品感。
- 小尺寸优先：在浏览器 favicon、侧栏、README 徽标中都应保持清楚。

## 三、色彩

| 名称 | 色值 | 用途 |
|---|---:|---|
| LawLink Navy | `#0f1b2d` | 主背景、深色文字、稳定感 |
| LawLink Teal | `#00a6a6` | 连接件、强调色、品牌识别 |
| White | `#ffffff` | 标志主体、反白字标 |
| Canvas | `#edf0f4` | 浅色展示背景 |
| Border | `#d8e1ea` | 浅色描边与分隔 |

## 四、资产目录约定

正式品牌资产统一放在 `public/brand/`。

命名规则：

- `lawlink-mark.*`：方形应用标志，优先用于 favicon、App 图标、社交头像。
- `lawlink-wordmark.*`：横向组合标志，适合 README、官网、登录页。
- `lawlink-wordmark-inverse.*`：深色背景上的横向反白组合标志。
- `lawlink-mark-mono.*`：单色方形标志，仅用于无法使用彩色的场景。
- `lawlink-symbol.*`：去背景的内部抽象符号，用于极少数需要轻量装饰的场景。
- `lawlink-brand-sheet.*`：品牌预览图，用于对外展示和快速确认。

清理规则：

- `public/brand/` 只放正式资产和导出的常用尺寸。
- 草案、探索稿、一次性预览图不要放入 `public/brand/`。
- 替换正式标志时，应先更新本文件，再替换 `public/brand/` 内资产。
- `public/favicon.svg` 继续作为运行时图标入口；若未来要替换，也应与 `public/brand/lawlink-mark.svg` 保持一致。

## 五、使用规则

### 推荐使用

- 应用图标、favicon：使用 `lawlink-mark.svg` 或对应 PNG。
- README / 官网头部：使用 `lawlink-wordmark.svg`。
- 深色背景：使用 `lawlink-wordmark-inverse.svg`。
- 打印或单色环境：使用 `lawlink-mark-mono.svg`。

### 避免使用

- 不要拉伸、压扁标志。
- 不要改变内部白色立柱和 teal 连接件的比例。
- 不要在复杂图片背景上直接使用彩色标志。
- 不要给标志额外加阴影、描边、渐变或装饰光效。
- 不要把探索稿与正式标志混用。

## 六、最小留白

方形标志四周至少保留一个内部白色立柱宽度的留白。横向字标四周至少保留字高的四分之一作为安全区。

## 七、当前正式资产

| 文件 | 说明 |
|---|---|
| `public/brand/lawlink-mark.svg` | 正式方形标志，SVG 源文件 |
| `public/brand/lawlink-mark-1024.png` | 1024px 方形 PNG |
| `public/brand/lawlink-mark-2048.png` | 2048px 方形 PNG |
| `public/brand/lawlink-wordmark.svg` | 浅色背景横向组合标志 |
| `public/brand/lawlink-wordmark.png` | 横向组合标志 PNG |
| `public/brand/lawlink-wordmark-inverse.svg` | 深色背景横向反白组合标志 |
| `public/brand/lawlink-wordmark-inverse.png` | 深色背景横向反白 PNG |
| `public/brand/lawlink-mark-mono.svg` | 单色方形标志 |
| `public/brand/lawlink-symbol.svg` | 去背景内部符号 |
| `public/brand/lawlink-brand-sheet.svg` | 品牌预览图 |
| `public/brand/lawlink-brand-sheet.png` | 品牌预览图 PNG |

