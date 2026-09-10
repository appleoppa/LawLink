// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const componentDir = join(root, "src/app/(app)/matters/[id]/_components");

describe("matter detail click actions", () => {
  it("keeps critical matter-detail buttons functional via Button component", () => {
    const checks = [
      ["info-panel.tsx", "import { Button }"],
      ["matter-detail-tabs.tsx", "import { Button }"],
      ["procedure-content.tsx", "import { Button }"],
      ["procedure-documents-section.tsx", "import { Button }"],
      ["approvals-panel.tsx", "import { Button }"]
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
