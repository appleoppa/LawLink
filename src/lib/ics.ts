/**
 * v0.9.3 ICS 日历文件生成（RFC 5545 简化版）
 *
 * 用于：保全到期 / 开庭 / 期限 一键导出 .ics，拖进 Apple 日历 / Google
 * Calendar / Outlook 即可在手机原生日历看到提醒。
 *
 * 不依赖第三方库；纯字符串拼接。
 */

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end?: Date;       // 不传 = 1 小时事件；如果是 allDay 用 startAllDay
  allDay?: boolean; // true → 用 DTSTART;VALUE=DATE
  description?: string;
  location?: string;
  reminderMinutes?: number[]; // 提前多少分钟提醒（多个）
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// YYYYMMDDTHHmmssZ
function fmtUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// YYYYMMDD（all-day 用）
function fmtDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ICS 文本要做的转义：\, ; , \n
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// 长行折叠（>75 字节按 ICS 规范折行）
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + (i === 0 ? 75 : 74));
    out.push(i === 0 ? chunk : " " + chunk);
    i += i === 0 ? 75 : 74;
  }
  return out.join("\r\n");
}

export function buildIcs(opts: {
  prodId?: string;
  calendarName?: string;
  events: IcsEvent[];
}): string {
  const prodId = opts.prodId ?? "-//LawLink//ZH-CN";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  if (opts.calendarName) {
    lines.push(fold(`X-WR-CALNAME:${esc(opts.calendarName)}`));
  }

  const now = new Date();
  for (const ev of opts.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}@lawlink.local`);
    lines.push(`DTSTAMP:${fmtUtc(now)}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.start)}`);
      const end = ev.end ?? new Date(ev.start.getTime() + 86400000);
      lines.push(`DTEND;VALUE=DATE:${fmtDate(end)}`);
    } else {
      lines.push(`DTSTART:${fmtUtc(ev.start)}`);
      const end = ev.end ?? new Date(ev.start.getTime() + 3600000);
      lines.push(`DTEND:${fmtUtc(end)}`);
    }
    lines.push(fold(`SUMMARY:${esc(ev.title)}`));
    if (ev.description) lines.push(fold(`DESCRIPTION:${esc(ev.description)}`));
    if (ev.location) lines.push(fold(`LOCATION:${esc(ev.location)}`));
    for (const m of ev.reminderMinutes ?? []) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:${esc(ev.title)}`);
      lines.push(`TRIGGER:-PT${m}M`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** 浏览器端：下载 .ics 文件 */
export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
