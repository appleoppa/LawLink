"use client";

/**
 * 顶栏「法院短信」入口（2026-09-19 用户确认）：法院短信是有时效的外部来件队列
 * （送达回执、开庭传票），不是导航分类，也不该藏进工具抽屉——因此与通知铃并排，
 * 图标带未处理角标；点开列未处理短信，可就地标记已处理，或进整页做关联与转开庭/期限。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listSmsMessages, markSmsProcessed } from "@/server/sms/actions";
import { shMonthDayTime } from "@/lib/ui/sh-time";
import { cn } from "@/lib/utils";

type Sms = Awaited<ReturnType<typeof listSmsMessages>>[number];

const TYPE_LABEL: Record<string, string> = {
  HEARING_NOTICE: "开庭",
  SERVICE_NOTICE: "送达",
  FEE_NOTICE: "缴费",
  MEDIATION: "调解",
  ENFORCEMENT: "执行",
  FILING_NOTICE: "立案",
  JUDGMENT_NOTICE: "判决",
  EVIDENCE_SUBMIT: "举证",
  OTHER: "其他"
};
/** 开庭与举证是有期限的，角标与徽章用暖色提示 */
const URGENT_TYPES = new Set(["HEARING_NOTICE", "EVIDENCE_SUBMIT", "FEE_NOTICE"]);

function summaryOf(sms: Sms): string {
  const parsed = (sms.parsedJson ?? {}) as { summary?: string; court?: string | null };
  return parsed.summary?.trim() || sms.rawText.slice(0, 60);
}
function courtOf(sms: Sms): string | null {
  const parsed = (sms.parsedJson ?? {}) as { court?: string | null };
  return parsed.court?.trim() || null;
}

export function SmsPopover() {
  const [items, setItems] = useState<Sms[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setItems(await listSmsMessages({ scope: "mine", processed: "unprocessed" }));
    } catch {
      // 无权限或接口异常时静默：入口本身按权限渲染
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const count = items.length;
  const urgent = items.some((s) => URGENT_TYPES.has(s.smsType));

  async function markDone(id: string) {
    setBusyId(id);
    try {
      await markSmsProcessed({ id });
      setItems((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) load(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="btn btn-secondary btn-icon relative"
          aria-label={count > 0 ? `法院短信（${count} 条未处理）` : "法院短信"}
          title="法院短信"
        >
          <Mail strokeWidth={1.8} />
          {count > 0 ? (
            <span
              className={cn(
                "absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-white",
                urgent ? "bg-[var(--red)]" : "bg-[var(--amber)]"
              )}
              aria-hidden
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">法院短信</span>
          <span className="text-xs text-muted-foreground">{count > 0 ? `未处理 ${count}` : "均已处理"}</span>
        </div>

        {count === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有未处理的法院短信</div>
        ) : (
          <ul className="max-h-[380px] overflow-y-auto">
            {items.slice(0, 8).map((sms) => (
              <li key={sms.id} className="border-b last:border-0">
                <div className="px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={cn("badge", URGENT_TYPES.has(sms.smsType) ? "b-amber" : "b-white")} style={{ fontSize: 10 }}>
                      {TYPE_LABEL[sms.smsType] ?? "其他"}
                    </span>
                    <span className="min-w-0 truncate">{courtOf(sms) ?? "未识别法院"}</span>
                    <span className="ml-auto shrink-0 font-mono">{shMonthDayTime(sms.receivedAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-foreground/85">{summaryOf(sms)}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Link
                      href={`/inbox?focus=${sms.id}`}
                      onClick={() => setOpen(false)}
                      className="btn btn-secondary btn-sm"
                    >
                      去处理
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === sms.id}
                      onClick={() => void markDone(sms.id)}
                    >
                      标记已处理
                    </button>
                    {sms.matchedMatter ? (
                      <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground" title={sms.matchedMatter.title}>
                        已关联 {sms.matchedMatter.internalCode}
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--amber)]">未关联案件</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t px-3 py-2 text-right">
          <Link href="/inbox" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">
            全部短信 →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
