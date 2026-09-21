// @vitest-environment node
/**
 * safeFetch 连接时钉扎（第六轮体检 P3-3）：预检（assertSafeHttpUrl 的 lookup）与
 * fetch 自身解析之间的 DNS rebinding 窗口，通过在 undici connect 回调内完成解析、
 * 只连校验通过的 IP 关闭。mock dns 模拟「预检公网 → 建连时内网」的攻击序列。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
import { safeFetch, assertSafeHttpUrl } from "@/lib/net/safe-url";

const mocked = vi.mocked(lookup);
const pub = [{ address: "93.184.216.34", family: 4 }] as never;
const priv = [{ address: "10.0.0.5", family: 4 }] as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("safeFetch 连接时钉扎", () => {
  it("预检通过但建连时解析到内网（DNS rebinding）→ 连接被拒，不出网", async () => {
    mocked.mockResolvedValueOnce(pub).mockResolvedValueOnce(priv);
    let err: unknown;
    try {
      await safeFetch("https://example.com/file.pdf");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // undici 将连接层错误包为 "fetch failed"，原始信息在 cause
    const chained = [((err as Error)?.message ?? ""), (((err as Error)?.cause as Error)?.message ?? "")].join(" ");
    expect(chained).toContain("不允许访问本机或内网地址");
    // 预检与建连各解析一次
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("全部解析为内网地址 → 连接被拒", async () => {
    mocked.mockResolvedValueOnce(pub).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(safeFetch("https://example.com/x")).rejects.toThrow();
  });
});

describe("assertSafeHttpUrl 预检（既有行为回归）", () => {
  it("直接解析到内网 → 预检即拒绝", async () => {
    mocked.mockResolvedValueOnce(priv);
    await expect(assertSafeHttpUrl("https://example.com/x")).rejects.toThrow("不允许访问本机或内网地址");
  });
  it("本机名不发起解析直接拒绝", async () => {
    await expect(assertSafeHttpUrl("http://localhost:8080/x")).rejects.toThrow("不允许访问本机或内网地址");
    expect(mocked).not.toHaveBeenCalled();
  });
});
