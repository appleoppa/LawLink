import { describe, it, expect, vi } from "vitest";
import { isEmailConfigured, sendReminderEmail } from "@/lib/notifications/email";
import { watermarkImage } from "@/lib/documents/watermark";

describe("邮件提醒渠道（SMTP）", () => {
  it("未配置 SMTP 时跳过发送（不抛错、不建传输器）", async () => {
    delete process.env.SMTP_HOST;
    expect(isEmailConfigured()).toBe(false);
    const res = await sendReminderEmail({ to: "a@b.c", userName: "叶森", lines: ["x"] });
    expect(res).toEqual({ ok: true, skipped: true });
  });
});

describe("图像水印（sharp）", () => {
  it("PNG 加水印后仍为有效图像且字节改变；无效输入返回 null 回退原件", async () => {
    const sharp = (await import("sharp")).default;
    const base = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#ffffff" }
    }).png().toBuffer();
    const marked = await watermarkImage({ buf: base, text: "LawLink download by YeSen 2026-09-13" });
    expect(marked).not.toBeNull();
    expect(marked!.length).toBeGreaterThan(base.length);
    const meta = await sharp(marked).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(400);

    expect(await watermarkImage({ buf: Buffer.from("not an image"), text: "x" })).toBeNull();
  });
});
