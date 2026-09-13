"use client";

import { Hourglass, XCircle, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ArchiveStatus = "PENDING_REVIEW" | "REJECTED" | "APPROVED";

interface ArchiveRecord {
  id: string;
  archiveNo: string;
  status: ArchiveStatus;
  reviewedAt: Date | null;
  reviewNote: string | null;
  archivedBy: string;
  missingItems: string[];
}

interface Props {
  record: ArchiveRecord | null;
  onReArchive?: () => void;
}

export function ArchiveStatusBanner({ record, onReArchive }: Props) {
  if (!record || record.status === "APPROVED") return null;

  const isRejected = record.status === "REJECTED";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3",
        isRejected
          ? "border-destructive/50 bg-destructive/10"
          : "border-[#9B7BF7]/50 bg-[#9B7BF7]/10"
      )}
    >
      <div className={cn("mt-0.5", isRejected ? "text-destructive" : "text-[#9B7BF7]")}>
        {isRejected ? <XCircle className="h-4 w-4" /> : <Hourglass className="h-4 w-4" />}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium", isRejected ? "text-destructive" : "text-[#9B7BF7]")}>
            {isRejected ? "归档申请被驳回" : "归档申请审批中"}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              isRejected
                ? "border-destructive/50 text-destructive"
                : "border-[#9B7BF7]/50 text-[#9B7BF7]"
            )}
          >
            {record.archiveNo}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {isRejected
            ? record.reviewNote
              ? `驳回原因：${record.reviewNote}`
              : "管理员未填写驳回原因"
            : "归档申请已提交，请等待管理员审批。审批通过后案件将转为只读。"}
        </div>
        {isRejected && record.missingItems.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            上次缺项：{record.missingItems.join("、")}
          </div>
        )}
      </div>
      {isRejected && onReArchive && (
        <button
          type="button"
          onClick={onReArchive}
          className="mt-0.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted/80"
        >
          <Archive className="h-3 w-3" />
          重新归档
        </button>
      )}
    </div>
  );
}
