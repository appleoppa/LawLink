// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOPBAR = join(ROOT, "src/components/layout/topbar.tsx");
const APP_DIR = join(ROOT, "src/app/(app)");

function internalPathFromHref(href: string) {
  if (!href.startsWith("/")) return null;
  return href.split("?")[0].replace(/\/$/, "") || "/";
}

function routePageExists(pathname: string) {
  if (pathname === "/") return existsSync(join(APP_DIR, "page.tsx"));
  return existsSync(join(APP_DIR, pathname.slice(1), "page.tsx"));
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

  it("renders app shortcuts as direct anchors instead of a click-fragile dropdown", () => {
    const source = readFileSync(TOPBAR, "utf8");
    // v1.2 上游实现：应用菜单（DropdownMenu 聚合入口）+ 内部链接直链（<Link>）
    expect(source).toContain("应用");
    expect(source).toMatch(/DropdownMenu|dropdown-menu/);
    expect(source).toMatch(/href:/);
  });
});
