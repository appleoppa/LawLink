/**
 * 案件详情页的 URL 规则（v1.2）。
 *
 * 路由键从 cuid 换成 `internalCode`（形如 `LL-2026-CC-0001`）：
 * 编号必填、`@unique`、且只在案件创建时生成一次，全仓库没有更新它的写入路径，
 * 因此可以安全地当作 URL 的稳定标识。
 *
 * 不用 `firmCaseNo`（所内案号）：它含中文和括号，进 URL 要百分号编码；
 * 且按「设置 → 律所信息」的模板渲染，模板可配置 = 可变，会让旧链接失效。
 * 也不把案件标题做成 slug：标题含当事人姓名，属 PII，不进 URL（见 AGENTS.md §八）。
 */

/**
 * `internalCode` 有意设为必填属性（值可空）：漏传时 TypeScript 直接报错，
 * 逼调用方把字段从查询里接出来；否则会静默退回 cuid，地址悄悄变回随机串。
 */
type MatterRouteKey = {
  id: string;
  internalCode: string | null;
};

/** 案件详情页地址。没有 internalCode 时回退到 id，保证链接始终可用。 */
export function matterHref(matter: MatterRouteKey, suffix = ""): string {
  const key = matter.internalCode?.trim() || matter.id;
  return `/matters/${encodeURIComponent(key)}${suffix}`;
}

/**
 * 规范化路由参数：URL 解码 + 去空白 + 转大写。
 * 编号里的字母恒为大写，允许用户手打小写地址（`m-2026-001`）也能命中。
 */
export function normalizeMatterParam(param: string): string {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    // 参数里有裸 `%` 时 decodeURIComponent 会抛，保持原值继续走查询即可
  }
  return decoded.trim().toUpperCase();
}
