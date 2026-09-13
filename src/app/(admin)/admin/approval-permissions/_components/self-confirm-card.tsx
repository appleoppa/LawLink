"use client";

/**
 * 自确认清单管理卡（4.3）：按操作开关低影响动作的申请人自确认。
 * 归档、开票、盖章回填、法定代表人章由服务端硬排除，任何配置不可自确认。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { saveSelfConfirmListAdmin } from "@/server/approval-permissions/self-confirm-actions";

const ACTION_META: { action: string; label: string; hint: string }[] = [
  { action: "DOCUMENT_APPROVE", label: "文书送审", hint: "上传人自我确认即生效，不再进入审批队列" },
  { action: "SEAL_APPROVE", label: "用章申请（非法人章）", hint: "申请人自确认后直接进入待盖章；法定代表人章始终走完整审批" },
  { action: "INTAKE_APPROVE", label: "收案审批", hint: "清单可配置；收案转化的自确认接线随收案专项启用" }
];

export function SelfConfirmCard({ initialActions }: { initialActions: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState<string[]>(initialActions);
  const [error, setError] = useState<string | null>(null);

  function toggle(action: string) {
    const next = enabled.includes(action) ? enabled.filter(a => a !== action) : [...enabled, action];
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      try {
        await saveSelfConfirmListAdmin({
          items: next.map(a => ({ action: a, categories: [], sealTypes: [] }))
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
        setEnabled(initialActions);
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4 text-primary" />
        自确认清单（低影响动作）
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        命中清单的提交动作由申请人自我确认即完成原审批环节，审计动作标记为「自确认」。
        归档、开票、盖章回填与法定代表人章由服务端硬排除，永远走完整审批，不可在此配置。
      </p>
      <div className="mt-3 space-y-2">
        {ACTION_META.map(meta => (
          <label
            key={meta.action}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{meta.label}</span>
              <span className="block text-[11.5px] text-muted-foreground">{meta.hint}</span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={enabled.includes(meta.action)}
              disabled={pending}
              onChange={() => toggle(meta.action)}
            />
          </label>
        ))}
      </div>
      {pending && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 保存中…
        </div>
      )}
      {error && <div className="mt-2 text-[12.5px] text-destructive">{error}</div>}
    </div>
  );
}
