import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  searchPtalCases,
  buildCaseDetailUrl,
  YuandianApiError,
  YuandianNotConfiguredError
} from "@/lib/yuandian/client";
import type { ResolvedYuandianSettings } from "@/lib/yuandian/settings";

const configuredSettings: ResolvedYuandianSettings = {
  apiKey: "test_key",
  baseUrl: "https://open.example.com/open",
  caseDetailHost: "https://www.example.com",
  configured: true
};

const unconfiguredSettings: ResolvedYuandianSettings = {
  ...configuredSettings,
  apiKey: "",
  configured: false
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as never;
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Response;
}

describe("searchPtalCases", () => {
  it("未配置 apiKey → 抛 YuandianNotConfiguredError", async () => {
    await expect(
      searchPtalCases({ ay: ["民间借贷纠纷"] }, unconfiguredSettings)
    ).rejects.toBeInstanceOf(YuandianNotConfiguredError);
  });

  it("所有过滤条件都空 → 抛错（元典要求 body 非空）", async () => {
    await expect(searchPtalCases({}, configuredSettings)).rejects.toThrow(/至少填写一个/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("正常请求：body 构造 + 响应解析", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "success",
        code: 200,
        data: {
          total: 2,
          lst: [
            {
              type: "普通案例",
              id: "abc",
              ah: "（2022）京民终1号",
              title: "甲诉乙",
              ay: ["民间借贷纠纷"],
              jbdw: "北京市第三中院",
              ajlb: "民事案件",
              xzqh_p: "北京",
              wszl: "判决书",
              cprq: "2022年01月01日",
              content: "片段",
              url: "/ydzk/caseDetail/case/abc",
              score: 9.9
            }
          ]
        }
      })
    );

    const res = await searchPtalCases(
      { ay: ["民间借贷纠纷"], qw: "违约 逾期", top_k: 3 },
      configuredSettings
    );
    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe("abc");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://open.example.com/open/rh_ptal_search");
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe("test_key");
    const body = JSON.parse(init.body as string);
    expect(body.ay).toEqual(["民间借贷纠纷"]);
    expect(body.qw).toBe("违约 逾期");
    expect(body.search_mode).toBe("and");
    expect(body.top_k).toBe(3);
  });

  it("data === null（未命中）→ 返回空", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "success", code: 200, data: null, message: "未查询到相关内容" })
    );
    const res = await searchPtalCases({ qw: "极小概率" }, configuredSettings);
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it("status=failed → 抛 YuandianApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "failed", code: 500, message: "search_mode 不合法" })
    );
    await expect(searchPtalCases({ qw: "x" }, configuredSettings)).rejects.toBeInstanceOf(
      YuandianApiError
    );
  });

  it("HTTP 401 → 抛 YuandianApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));
    await expect(searchPtalCases({ qw: "x" }, configuredSettings)).rejects.toBeInstanceOf(
      YuandianApiError
    );
  });

  it("top_k 边界：>50 裁到 50，<1 裁到 1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "success", code: 200, data: { total: 0, lst: [] } })
    );

    await searchPtalCases({ qw: "x", top_k: 999 }, configuredSettings);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).top_k).toBe(50);

    await searchPtalCases({ qw: "x", top_k: -3 }, configuredSettings);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).top_k).toBe(1);
  });

  it("空白 qw 不进 body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "success", code: 200, data: { total: 0, lst: [] } })
    );
    await searchPtalCases({ ay: ["x"], qw: "   " }, configuredSettings);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.qw).toBeUndefined();
    expect(body.search_mode).toBeUndefined();
  });
});

describe("buildCaseDetailUrl", () => {
  it("拼接 host + path", () => {
    expect(
      buildCaseDetailUrl("https://www.example.com", "/ydzk/caseDetail/case/abc")
    ).toBe("https://www.example.com/ydzk/caseDetail/case/abc");
  });
  it("host 尾 / 与 path 头 / 容错", () => {
    expect(buildCaseDetailUrl("https://www.example.com/", "ydzk/x")).toBe(
      "https://www.example.com/ydzk/x"
    );
  });
});
