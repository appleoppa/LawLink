"use client";
import Link from "next/link";
import type { IntakeStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { approvalHref } from "@/lib/approvals/workspace";

export function IntakeActions({ intakeId, status, canApprove = false, canResubmit = false }: {
  intakeId: string; status?: IntakeStatus; canApprove?: boolean; canResubmit?: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-3">
    <p className="text-sm text-muted-foreground">{status === "NEEDS_REVISION" ? "补充材料后，可在审批工作台重新提交。" : "审批进度与处理记录统一在工作台查阅。"}</p>
    <Button size="sm" variant={canApprove || canResubmit ? "default" : "outline"} asChild>
      <Link href={approvalHref("INTAKE_APPROVE", intakeId)}>{canApprove ? "前往审批" : canResubmit ? "查看补正并重新提交" : "查看审批记录"}</Link>
    </Button>
  </div>;
}
