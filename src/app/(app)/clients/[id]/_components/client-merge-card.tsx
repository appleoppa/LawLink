"use client";

/**
 * 客户档案合并卡（P0-1 存量重复合并入口）。
 * 仅管理员/主办可见（由页面判定）；输入被合并方的客户编号（KH-…）与依据，
 * 调用 mergeClientsByCode：被合并档案软删并并入本档案，历史身份快照不改写。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mergeClientsByCode } from "@/server/clients/dedup";

export function ClientMergeCard({ keepId, keepName }: { keepId: string; keepName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mergeCode, setMergeCode] = useState("");
  const [basis, setBasis] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!mergeCode.trim() || !basis.trim()) {
      setError("请填写被合并客户编号与合并依据");
      return;
    }
    if (!confirm(
      `确认将「${mergeCode}」并入「${keepName}」？\n` +
      "被合并档案将停用并标注并入痕迹；其联系人、收案与案件关联转移至本档案；" +
      "历史冲突核查、审批与正式成果中的身份快照保持原貌。"
    )) return;
    startTransition(async () => {
      try {
        await mergeClientsByCode({ keepId, mergeCode: mergeCode.trim(), basis: basis.trim() });
        toast.success("合并完成");
        setOpen(false); setMergeCode(""); setBasis("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "合并失败");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <GitMerge className="h-3.5 w-3.5" />
          合并重复客户档案
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
            <GitMerge className="h-3.5 w-3.5 text-primary" />
            将另一档案并入「{keepName}」
          </div>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-[13px]"
            placeholder="被合并客户的编号（KH-2026-0001）"
            value={mergeCode}
            onChange={e => setMergeCode(e.target.value)}
          />
          <input
            className="w-full rounded-md border px-2 py-1.5 text-[13px]"
            placeholder="合并依据（如：同一主体重复建档，记入审计）"
            value={basis}
            onChange={e => setBasis(e.target.value)}
          />
          {error && <div className="text-[12px] text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <button className="rounded-md border px-2.5 py-1 text-[12.5px] hover:bg-accent" onClick={() => setOpen(false)}>取消</button>
            <button
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12.5px] text-primary-foreground disabled:opacity-50"
              disabled={pending}
              onClick={submit}
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" />}
              确认合并
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
