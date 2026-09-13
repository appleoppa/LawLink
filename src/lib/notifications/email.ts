import nodemailer from "nodemailer";

/**
 * 个人级邮件提醒渠道（v5 P1-5 收尾：SMTP 部署环境已就位后启用）。
 *
 * 配置经环境变量注入（见 .env.example「邮件提醒（SMTP）」段）：
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / MAIL_FROM
 * 未配置时 isEmailConfigured()=false，调用方跳过发送（不报错、不阻断扫描），
 * 队列任务以"跳过"完结——提醒失败不可静默的原则由队列重试与死信兜底。
 * 本地验证：docker compose --profile dev up mailpit 后访问 http://localhost:8025。
 */

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined
  });
}

export async function sendReminderEmail(input: {
  to: string;
  userName: string;
  lines: string[];
}): Promise<{ ok: true; skipped?: boolean }> {
  if (!isEmailConfigured()) return { ok: true, skipped: true };
  const transport = buildTransport();
  const body = input.lines.map(l => `- ${l}`).join("\n");
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: input.to,
    subject: `LawLink 期限提醒（${input.userName}，共 ${input.lines.length} 项）`,
    text: `${input.userName}，你好：\n\n以下事项临近或已到期：\n\n${body}\n\n—— LawLink 律师工作台（自动发送）\n`,
    html: `<p>${input.userName}，你好：</p><p>以下事项临近或已到期：</p><ul>${input.lines.map(l => `<li>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}</ul><p style="color:#888">—— LawLink 律师工作台（自动发送）</p>`
  });
  return { ok: true };
}
