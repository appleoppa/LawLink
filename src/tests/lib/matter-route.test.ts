import { describe, expect, it } from "vitest";
import { matterHref, normalizeMatterParam } from "@/lib/matters/route";

describe("matterHref", () => {
  it("用 internalCode 作路由键", () => {
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "M-2026-001" })).toBe(
      "/matters/M-2026-001"
    );
  });

  it("internalCode 为空时回退到 id，链接不会断", () => {
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: null })).toBe(
      "/matters/cmq3lxgrm002nitzfhh8qn8ql"
    );
    expect(matterHref({ id: "cmq3lxgrm002nitzfhh8qn8ql", internalCode: "  " })).toBe(
      "/matters/cmq3lxgrm002nitzfhh8qn8ql"
    );
  });

  it("支持子路径后缀", () => {
    expect(matterHref({ id: "x", internalCode: "LL-2026-CC-0001" }, "#finance")).toBe(
      "/matters/LL-2026-CC-0001#finance"
    );
  });

  it("对编号做 URL 编码，异常字符不会破坏地址", () => {
    expect(matterHref({ id: "x", internalCode: "M 2026/001" })).toBe("/matters/M%202026%2F001");
  });
});

describe("normalizeMatterParam", () => {
  it("手打小写地址能命中", () => {
    expect(normalizeMatterParam("m-2026-001")).toBe("M-2026-001");
  });

  it("去掉首尾空白", () => {
    expect(normalizeMatterParam("  M-2026-001 ")).toBe("M-2026-001");
  });

  it("先做 URL 解码", () => {
    expect(normalizeMatterParam("M%2D2026%2D001")).toBe("M-2026-001");
  });

  it("参数里有裸 % 时不抛异常", () => {
    expect(() => normalizeMatterParam("M-2026-100%")).not.toThrow();
    expect(normalizeMatterParam("M-2026-100%")).toBe("M-2026-100%");
  });

  it("cuid 原样保留（大写化不影响按 id 匹配）", () => {
    expect(normalizeMatterParam("cmq3lxgrm002nitzfhh8qn8ql")).toBe(
      "CMQ3LXGRM002NITZFHH8QN8QL"
    );
  });
});
