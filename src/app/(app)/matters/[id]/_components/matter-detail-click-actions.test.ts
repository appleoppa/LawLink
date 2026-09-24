// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const componentDir = join(root, "src/app/(app)/matters/[id]/_components");

describe("matter detail click actions", () => {
  it("keeps critical matter-detail buttons functional via Button component", () => {
    // v2.0.1 上游重建了案件详情页：经办面板改为 procedure-content / evidence-panel /
    // finance-panel 等独立面板，原 info-panel 与 matter-detail-tabs 已不再直接渲染按钮。
    // 这里守住的是“关键操作仍走统一 Button 组件”的不变量，文件名按 v2 结构对齐。
    const checks = [
      ["procedure-content.tsx", "import { Button }"],
      ["approvals-panel.tsx", "import { Button }"],
      ["matter-preservation-panel.tsx", "import { Button }"],
      ["evidence-panel.tsx", "import { Button }"],
      ["finance-panel.tsx", "import { Button }"]
    ] as const;

    for (const [file, expected] of checks) {
      const source = readFileSync(join(componentDir, file), "utf8");
      expect(source, `${file} should contain ${expected}`).toContain(expected);
    }
  });

  it("uses explicit user-interaction handlers (onClick/onPointerDown) on dialog-triggering buttons", () => {
    const source = readFileSync(join(componentDir, "matter-detail-tabs.tsx"), "utf8");
    expect(source).toContain("setAddProcOpen");
    expect(source).toMatch(/onClick|onPointerDown/);
  });
});
