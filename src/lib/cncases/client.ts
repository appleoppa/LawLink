/**
 * 本地裁判文书检索（cncases）客户端。
 * 服务：127.0.0.1:8081（launchd: ai.hermes.cncases，数据在本地裁判文书数据盘，约 8500 万份裁判文书）。
 * 注意：该服务返回 HTML（非 JSON），参数是 ?search= 不是 ?q=。
 * 使用 Node http 直连（绕过系统代理，等同 curl --noproxy '*'）。
 */

import http from "node:http";
import { URL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8081;
const BASE = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

export type LocalJudgmentHit = {
  title: string;
  href: string;
  meta?: string;
};

export type LocalJudgmentSearchResult = {
  available: boolean;
  total: number;
  items: LocalJudgmentHit[];
  message?: string;
};

function requestOnce(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || DEFAULT_PORT,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { "User-Agent": "LawLink/1.0" },
        timeout: timeoutMs
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

/** 检测本地裁判文书服务是否可用（挂载 + 服务运行）。 */
export async function checkLocalJudgmentService(timeoutMs = 2500): Promise<boolean> {
  try {
    const r = await requestOnce(`${BASE}/`, timeoutMs);
    return r.status >= 200 && r.status < 500;
  } catch {
    return false;
  }
}

/** 宽容解析 cncases 返回的 HTML 结果列表。 */
function parseHtml(body: string): { total: number; items: LocalJudgmentHit[] } {
  let total = 0;
  const totalMatch = body.match(/找到\s*([\d,]+)\s*[,，]/);
  if (totalMatch) total = Number(totalMatch[1].replace(/,/g, "")) || 0;
  if (!total) {
    const m2 = body.match(/共\s*([\d,]+)\s*条/);
    if (m2) total = Number(m2[1].replace(/,/g, "")) || 0;
  }

  const items: LocalJudgmentHit[] = [];
  // 导航/噪声词过滤
  const noiseRe = /^[\s❓?？!！]*(帮助|找到|导出|首页|上一页|下一页|当前|跳至|第\s*\d+\s*页)/;
  // 列表项通常是 <a href="...">标题</a> 包裹的文本行
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = anchorRe.exec(body)) !== null && items.length < 30) {
    const href = m[1];
    const title = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 4) continue;
    if (noiseRe.test(title)) continue;
    if (/^\/?(search|css|js|favicon|login)/i.test(href)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    // 抓取标题附近文本作为元信息（法院/案号/日期）
    const start = Math.max(0, m.index - 200);
    const ctx = body.slice(start, m.index + m[0].length + 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    items.push({
      title,
      href: href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`,
      meta: ctx.length > 160 ? ctx.slice(0, 160) : ctx
    });
  }
  return { total: total || items.length, items };
}

/** 检索本地裁判文书。返回 available=false 表示服务未就绪（移动硬盘未挂载等）。 */
export async function searchLocalJudgments(
  query: string,
  max = 20,
  timeoutMs = 15_000
): Promise<LocalJudgmentSearchResult> {
  const q = query.trim();
  if (!q) return { available: true, total: 0, items: [], message: "请输入检索关键词" };

  const url = `${BASE}/?search=${encodeURIComponent(q)}&max=${Math.min(Math.max(max, 1), 50)}`;
  try {
    const r = await requestOnce(url, timeoutMs);
    if (r.status === 0 || r.status >= 500) {
      return {
        available: false,
        total: 0,
        items: [],
        message: `本地裁判文书服务异常（HTTP ${r.status || "无响应"}）`
      };
    }
    const parsed = parseHtml(r.body);
    return { available: true, ...parsed };
  } catch {
    return {
      available: false,
      total: 0,
      items: [],
      message: "本地裁判文书服务未启动：请确认本地裁判文书数据盘已挂载、cncases 服务已运行（127.0.0.1:8081）"
    };
  }
}
