"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { triggerDueReminderScan } from "@/server/reminders/actions";
import { actionErrorMessage } from "@/lib/action-error";

export function ReminderScanButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleScan() {
    startTransition(async () => {
      try {
        const r = await triggerDueReminderScan();
        const total = r.deadlineNotified + r.hearingNotified;
        router.refresh();
        toast.success(`扫描完成：新推送 ${total} 条`, {
          description: `期限 ${r.deadlineNotified}·开庭 ${r.hearingNotified}（去重跳过 ${r.suppressed}）`
        });
      } catch (err) {
        toast.error("扫描失败", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <button type="button" onClick={handleScan} disabled={isPending} className="btn btn-secondary btn-sm shrink-0">
      {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      立即扫描
    </button>
  );
}
