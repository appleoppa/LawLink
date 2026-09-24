/**
 * 出站 URL 安全校验（SSRF 防线，从 server/sms/attachments 抽出公用）。
 *
 * 解析目标主机并做 DNS 解析：命中本机名、回环、私网/保留段（含 IPv4 映射与
 * NAT64 前缀）即拒绝。2026-09-19 审计：webhook、AI、元典等由管理端配置
 * baseUrl 的出站点此前未走该校验，配置被误填或滥用时可盲打内网。
 *
 * 2026-09-21 第六轮体检 P3-3：预检（lookup）与 fetch 自身的解析之间存在 DNS
 * rebinding 窗口（TOCTOU）。safeFetch 在连接时钉扎：建连前完成解析、只连校验
 * 通过的 IP（TLS 的 SNI/证书校验仍按原域名），窗口关闭。出站 fetch 应改走
 * safeFetch；assertSafeHttpUrl 保留给仅做校验的场景（如配置保存时的预检）。
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { ActionError } from "@/lib/action-error";

export async function assertSafeHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ActionError("链接格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ActionError("仅支持 HTTP/HTTPS 链接");
  }
  if (isLocalHostname(url.hostname)) {
    throw new ActionError("不允许访问本机或内网地址");
  }
  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new ActionError("不允许访问本机或内网地址");
  }
  return url;
}

export function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map((v) => parseInt(v, 10));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a === 169 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const low = address.toLowerCase();
    if (low === "::" || low === "::1") return true;
    if (low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80:")) return true;
    // IPv4 映射/兼容地址（::ffff:10.0.0.1、::a.b.c.d）与 NAT64 前缀都能直达内网 IPv4，按内网处理
    const mapped = low.match(/^::(?:ffff:)?(?:(\d+)\.(\d+)\.(\d+)\.(\d+)|([0-9a-f]+):([0-9a-f]+))$/);
    if (mapped) {
      if (mapped[1]) return isPrivateAddress(`${mapped[1]}.${mapped[2]}.${mapped[3]}.${mapped[4]}`);
      const hi = parseInt(mapped[5] ?? "0", 16), lo = parseInt(mapped[6] ?? "0", 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (low.startsWith("64:ff9b:")) return true;
    return false;
  }
  return true;
}


/** 连接时钉扎的 dispatcher：只连解析校验通过的 IP，SNI/证书仍按原域名 */
let pinnedAgent: Agent | undefined;
function pinnedDispatcher(): Agent {
  if (!pinnedAgent) {
    const dial = buildConnector({});
    pinnedAgent = new Agent({
      connect: (opts, callback) => {
        void (async () => {
          try {
            const originalHost = opts.hostname ?? opts.host ?? "";
            const records = await lookup(originalHost, { all: true });
            const safe = records.filter((r) => !isPrivateAddress(r.address));
            if (safe.length === 0) {
              callback(new Error("不允许访问本机或内网地址"), null);
              return;
            }
            // 钉扎到校验通过的 IP；servername 留原域名以维持 SNI 与证书校验
            dial({ ...opts, hostname: safe[0].address, servername: originalHost } as Parameters<typeof dial>[0], callback);
          } catch (err) {
            callback(err instanceof Error ? err : new Error(String(err)), null);
          }
        })();
      }
    });
  }
  return pinnedAgent;
}

/**
 * 出站安全 fetch：assertSafeHttpUrl 预检 + 连接时钉扎（关 P3-3 TOCTOU 窗口）。
 * 返回 undici Response（status/headers/body 流与全局 Response 同构，可直接交给
 * 既有 readBodyWithLimit 等消费方）。
 */
export async function safeFetch(input: string, init?: Record<string, unknown>): Promise<Response> {
  const url = await assertSafeHttpUrl(input);
  return undiciFetch(url, { ...init, dispatcher: pinnedDispatcher() }) as unknown as Response;
}
