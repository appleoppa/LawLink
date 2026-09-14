"use client";

/**
 * 日程页订阅日历弹窗；仅打开时加载订阅链接。
 * 展示当前用户的 ICS 订阅 URL，可复制 / 重置；URL 即凭证。
 */
import { useEffect, useState, useTransition } from "react";
import { CalendarPlus, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getCalendarToken, regenerateCalendarToken } from "@/server/calendar/actions";

export function CalendarSubscriptionDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
          订阅日历
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>订阅日历</DialogTitle>
          <DialogDescription>
            在手机或电脑日历中查看 LawLink 日程。
          </DialogDescription>
        </DialogHeader>
        <CalendarSubscriptionContent />
      </DialogContent>
    </Dialog>
  );
}

function CalendarSubscriptionContent() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getCalendarToken()
      .then((res) => {
        if (!cancelled) setToken(res.token);
      })
      .catch(() => {
        if (!cancelled) toast.error("获取订阅链接失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const url = token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/calendar/${token}`
    : null;

  function copyUrl() {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("订阅链接已复制"))
      .catch(() => toast.error("复制失败，请手动选中复制"));
  }

  function regenerate() {
    if (
      !confirm(
        "重置后旧订阅链接立即失效，已订阅的日历需要重新添加。确定重置？"
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await regenerateCalendarToken();
        setToken(res.token);
        toast.success("已重置订阅链接");
      } catch (err) {
        toast.error("重置失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <div className="min-w-0">
      <p className="mb-4 text-[12px] leading-5 text-muted-foreground">
        把下方链接添加到 Apple 日历 / Google Calendar / Outlook 的「订阅日历」，
        开庭、期限、任务和保全到期会自动同步到手机日历（含过去 7 天 ~ 未来 90 天，
        事项只显示客户名不含完整案件名）。这是单向订阅，更新频率由日历应用决定。
        链接即凭证，请勿外发；怀疑泄露时点「重置链接」作废旧链接。
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在获取订阅链接…
        </div>
      ) : url ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="block w-full min-w-0 break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11.5px]">
            {url}
          </code>
          <Button variant="outline" size="sm" onClick={copyUrl} className="h-8 gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            复制链接
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={pending}
            className="h-8 gap-1.5 text-muted-foreground"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            重置链接
          </Button>
        </div>
      ) : (
        <p className="text-sm text-destructive">订阅链接不可用，请刷新重试。</p>
      )}
    </div>
  );
}
