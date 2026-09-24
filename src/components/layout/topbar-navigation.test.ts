// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOPBAR = join(ROOT, "src/components/layout/topbar.tsx");
// v2.0.1 起管理后台独立成 (admin) 路由组，两个组都要查，否则 /admin 会被误判为死链。
const ROUTE_GROUPS = [join(ROOT, "src/app/(app)"), join(ROOT, "src/app/(admin)")];

function internalPathFromHref(href: string) {
  if (!href.startsWith("/")) return null;
  return href.split("?")[0].replace(/\/$/, "") || "/";
}

function routePageExists(pathname: string) {
  if (pathname === "/") return ROUTE_GROUPS.some((dir) => existsSync(join(dir, "page.tsx")));
  const rel = join(pathname.slice(1), "page.tsx");
  return ROUTE_GROUPS.some((dir) => existsSync(join(dir, rel)));
}

function extractTopbarHrefs() {
  const source = readFileSync(TOPBAR, "utf8");
  const quoted = [...source.matchAll(/href:\s*"([^"]+)"|href=\"([^\"]+)\"/g)].map((m) => m[1] ?? m[2]);
  return Array.from(new Set(quoted));
}

describe("Topbar navigation", () => {
  it("does not point right-top menu links at missing internal routes", () => {
    const missing = extractTopbarHrefs()
      .map(internalPathFromHref)
      .filter((href): href is string => Boolean(href))
      .filter((pathname) => !pathname.startsWith("/api/"))
      .filter((pathname) => !routePageExists(pathname));

    expect(missing).toEqual([]);
  });

  it("keeps the admin entry permission-gated and routes declared as hrefs", () => {
    const source = readFileSync(TOPBAR, "utf8");
    // v2.0.1 上游实现：工具入口下沉到 ToolsDialog，顶栏不再自持“应用”菜单。
    // 这里守住的是安全与可测性不变量：管理入口必须过系统角色判断，链接必须是声明式 href。
    expect(source).toMatch(/canEnterAdminWorkspace/);
    expect(source).toMatch(/href="/);
    expect(source).toContain("/admin");
  });
});
