"use client";

/**
 * v1.0: 工作流开关卡片（律所信息页，仅 ADMIN）。
 * 目前只有一个开关：外部联系人审核流（默认关——小所信任环境直接通过）。
 */
import { useState, useTransition } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { saveWorkflowTogglesAction } from "@/server/settings/workflow-toggles-actions";

export function WorkflowTogglesCard({
  initialExternalContactReview
}: {
  initialExternalContactReview: boolean;
}) {
  const [externalContactReview, setExternalContactReview] = useState(
    initialExternalContactReview
  );
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    const prev = externalContactReview;
    setExternalContactReview(next);
    startTransition(async () => {
      try {
        await saveWorkflowTogglesAction({ externalContactReview: next });
        toast.success(next ? "已开启联系人审核" : "已关闭联系人审核（新增直接通过）");
      } catch (err) {
        setExternalContactReview(prev);
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-base font-semibold">工作流开关</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        按团队规模选择流程松紧；改动即时生效。
      </p>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={externalContactReview}
          onCheckedChange={(v) => toggle(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">外部联系人需管理员审核</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">
            关闭（默认）：任何人新增法院/仲裁机构等外部联系人后全所直接可见。
            开启：普通律师新增的联系人需管理员/主任律师审核后展示。
          </span>
        </span>
      </label>
    </section>
  );
}
