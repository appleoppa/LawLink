// @vitest-environment node
// B1 全量枚举回归（v3 §2 缺口）：一个送达页挂多份文书时逐件取件逐件记录——
// 不因首个成功而漏掉其余文件；部分失败显示部分完成；页面无候选时才给页面级状态。
// 直接驱动 downloadFromUrl 的对外入口 downloadSmsAttachments，mock 网络与存储。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, net, store, guards } = vi.hoisted(() => ({
  db: { document: { findFirst: vi.fn(), create: vi.fn() }, smsMessage: { update: vi.fn() }, matter: { findUnique: vi.fn() }, smsInboundFile: { createMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn() } },
  net: { fetch: vi.fn() },
  store: { writeFile: vi.fn(async () => "storage-key") },
  guards: { writable: vi.fn(), safeUrl: vi.fn(async (u: string) => new URL(u)), timeline: vi.fn() }
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/storage", () => ({ storage: store }));
vi.mock("@/lib/storage/crypto", () => ({ encryptBuffer: vi.fn(() => ({ ciphertext: Buffer.from("x"), algorithm: "aes-256-gcm", iv: Buffer.alloc(12), authTag: Buffer.alloc(16) })), sha256: vi.fn((b: Buffer) => `hash-${b.length}`) }));
// P3-3 后出站统一走 safeFetch（undici 钉扎），mock 模块并委托给 net.fetch 打桩
vi.mock("@/lib/net/safe-url", () => ({
  assertSafeHttpUrl: guards.safeUrl,
  safeFetch: (u: string, init?: unknown) => net.fetch(new URL(u), init)
}));
vi.mock("@/lib/archive/guard", () => ({ assertDocumentWritable: guards.writable }));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/timeline/record", () => ({ recordTimelineEvent: guards.timeline }));

import { downloadSmsAttachments } from "@/server/sms/attachments";

const page = (links: string[]) =>
  new Response(`<html><body>${links.map(l => `<a href="${l}">文书</a>`).join("")}</body></html>`, { headers: { "content-type": "text/html" } });
const pdf = (bytes = 100) =>
  new Response(Buffer.alloc(bytes), { headers: { "content-type": "application/pdf", "content-length": String(bytes) } });

const parsed = (urls: string[]) => ({
  smsType: "HEARING" as const,
  urls,
  documentLinks: [],
  importantItems: [],
  credentials: []
}) as never;

function route(map: Record<string, Response>) {
  net.fetch.mockImplementation(async (input: URL) => {
    const r = map[input.toString()];
    if (!r) throw new Error(`unexpected fetch ${input}`);
    return r;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", net.fetch);
  guards.writable.mockResolvedValue(undefined);
  guards.timeline.mockResolvedValue(undefined);
  db.document.findFirst.mockResolvedValue(null);
  db.document.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: `doc-${data.name}`, name: data.name, mimeType: "application/pdf", size: 100 }));
});

describe("短信附件取件全量枚举（B1）", () => {
  it("页面挂三份文书时全部取件，不因首个成功而返回", async () => {
    route({
      "https://court.example/page": page(["https://court.example/f1.pdf", "https://court.example/f2.pdf", "https://court.example/f3.pdf"]),
      "https://court.example/f1.pdf": pdf(),
      "https://court.example/f2.pdf": pdf(),
      "https://court.example/f3.pdf": pdf()
    });
    const results = await downloadSmsAttachments({ smsId: "s1", userId: "u1", parsed: parsed(["https://court.example/page"]), matterId: "m1", procedureId: null });
    const downloaded = results.filter(r => r.status === "DOWNLOADED");
    expect(downloaded).toHaveLength(3);
    expect(results.map(r => r.url)).toContain("https://court.example/f2.pdf");
    expect(results.map(r => r.url)).toContain("https://court.example/f3.pdf");
  });

  it("三份中一份失败时显示部分完成：两份成功记录在案，失败单独记录", async () => {
    net.fetch.mockImplementation(async (input: URL) => {
      const u = input.toString();
      if (u === "https://court.example/page") return page(["https://court.example/a.pdf", "https://court.example/b.pdf", "https://court.example/c.pdf"]);
      if (u === "https://court.example/b.pdf") return new Response("gone", { status: 404 });
      return pdf();
    });
    const results = await downloadSmsAttachments({ smsId: "s1", userId: "u1", parsed: parsed(["https://court.example/page"]), matterId: "m1", procedureId: null });
    expect(results.filter(r => r.status === "DOWNLOADED")).toHaveLength(2);
    const failed = results.find(r => r.status === "FAILED");
    expect(failed?.url).toBe("https://court.example/b.pdf");
    expect(failed?.message).toContain("404");
  });

  it("页面无任何文件候选时返回页面级状态（登录页判定不受影响）", async () => {
    route({ "https://court.example/login": new Response("<html><body>请输入验证码登录后查收文书</body></html>", { headers: { "content-type": "text/html" } }) });
    const results = await downloadSmsAttachments({ smsId: "s1", userId: "u1", parsed: parsed(["https://court.example/login"]), matterId: "m1", procedureId: null });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("LOGIN_REQUIRED");
  });

  it("同案已存在的附件按内容哈希识别为已下载，重复来源不重复保存", async () => {
    route({ "https://court.example/dup.pdf": pdf() });
    db.document.findFirst.mockResolvedValue({ id: "existing", name: "传票.pdf", mimeType: "application/pdf", size: 100 });
    const results = await downloadSmsAttachments({ smsId: "s1", userId: "u1", parsed: parsed(["https://court.example/dup.pdf"]), matterId: "m1", procedureId: null });
    expect(results[0].status).toBe("ALREADY_DOWNLOADED");
    expect(db.document.create).not.toHaveBeenCalled();
  });
});
