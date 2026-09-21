"use client";
/**
 * 法定放假安排卡（F-5）：按年查看已录入安排，批量录入当年国务院通知
 * （每行「YYYY-MM-DD 名称」，调休上班日行尾加 /调休）。仅超级管理员可保存。
 */
import { useState, useTransition } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveHolidayBatch } from "@/server/calendar/holiday-actions";
import { formatDate } from "@/lib/utils";

export type HolidayRow = { id: string; date: Date; name: string; kind: string };

export function HolidayCard({ year, rows, canEdit }: { year: number; rows: HolidayRow[]; canEdit: boolean }) {
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  function parseLines(raw: string): { entries: { date: string; name: string; kind: "HOLIDAY" | "WORKDAY" }[]; error?: string } {
    const entries: { date: string; name: string; kind: "HOLIDAY" | "WORKDAY" }[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+?)(\s*\/\s*调休)?$/);
      if (!m) return { entries, error: `无法识别行：「${trimmed}」，应为「YYYY-MM-DD 名称」（调休上班日行尾加 /调休）` };
      entries.push({ date: m[1], name: m[2].trim(), kind: m[3] ? "WORKDAY" : "HOLIDAY" });
    }
    return { entries };
  }

  function save() {
    const { entries, error } = parseLines(text);
    if (error) {
      toast.error("格式有误", { description: error });
      return;
    }
    if (entries.length === 0) {
      toast.error("请先按行录入安排");
      return;
    }
    startTransition(async () => {
      try {
        const r = await saveHolidayBatch({ entries });
        toast.success(`已保存 ${r.count} 条`);
        setText("");
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title" style={{ fontSize: 13 }}>
          <CalendarDays className="ic" strokeWidth={1.8} />
          法定放假安排 · {year} 年
        </div>
        <span className="t-xs t-mute">届满日顺延依据（民诉法第八十五条第三款）</span>
      </div>
      <div className="panel-body" style={{ paddingTop: 8 }}>
        {rows.length === 0 ? (
          <p className="t-xs t-mute" style={{ lineHeight: 1.7, marginBottom: 8 }}>
            尚未录入 {year} 年安排。未录入时期限届满日保持「请人工核对顺延」提示；每年国务院通知发布后录入一次（几分钟），系统将自动把落在休假日的届满日顺延到下一工作日并在依据栏标注。
          </p>
        ) : (
          <div className="t-xs" style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {rows.map((r) => (
              <span key={r.id} className="offset-chip" title={r.kind === "WORKDAY" ? "调休上班日" : "放假日"}>
                {formatDate(r.date)} {r.name}{r.kind === "WORKDAY" ? "（调休上班）" : ""}
              </span>
            ))}
          </div>
        )}
        {canEdit ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={"每行一条：YYYY-MM-DD 名称\n如：2026-10-01 国庆节\n调休上班日：2026-09-27 上班 /调休"}
              className="text-xs font-mono"
            />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" onClick={save} disabled={isPending} className="gap-1.5">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存本批
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
