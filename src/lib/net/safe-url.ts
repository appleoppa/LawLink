/**
 * 出站 URL 安全校验（SSRF 防线，从 server/sms/attachments 抽出公用）。
 *
 * 解析目标主机并做 DNS 解析：命中本机名、回环、私网/保留段（含 IPv4 映射与
 * NAT64 前缀）即拒绝。2026-09-19 审计：webhook、AI、元典等由管理端配置
 * baseUrl 的出站点此前未走该校验，配置被误填或滥用时可盲打内网。
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export async function assertSafeHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("链接格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 HTTP/HTTPS 链接");
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error("不允许访问本机或内网地址");
  }
  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error("不允许访问本机或内网地址");
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
