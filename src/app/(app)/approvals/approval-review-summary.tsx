import type { ApprovalAction } from "@prisma/client";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";
import { ReviewAlert, ReviewSummaryItem } from "@/components/patterns/review-dialog";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;

/** 墨案 07 摘要条：按事项类型取关键字段 */
export function ApprovalReviewSummary({ detail, action }: { detail: Detail; action: ApprovalAction }) {
  const value = (label: string) => detail.fields.find(field => field.label === label)?.value ?? "未记录";
  const items: [string, string, boolean?][] = action === "INVOICE_APPROVE" ? [
    ["申请金额（元）", value("金额（元）"), true], ["发票类型", value("类型")], ["申请附件", `${detail.attachments.length} 份`]
  ] : action === "DOCUMENT_APPROVE" ? [
    ["送审版本", value("版本")], ["上传人", value("上传人")], ["申请附件", `${detail.attachments.length} 份`]
  ] : action === "ARCHIVE_APPROVE" ? [
    ["归档编号", value("归档编号"), true], ["送审材料", detail.archiveReview?.legacy ? "历史未固定" : `${detail.attachments.length} 份`], ["完成时间", value("完成时间")]
  ] : [
    ["申请编号", value("申请编号"), true], ["文件数量", `${value("页数")} 页 × ${value("份数")} 份`], ["用章事项", value("用章事项")]
  ];
  return <>{items.map(([k, v, mono]) => <ReviewSummaryItem key={k} k={k} v={v} mono={mono} />)}</>;
}

/** 首屏风险：归档缺项/历史未固定；执行环节提示 */
export function approvalAlert(detail: Detail) {
  if (detail.archiveReview?.legacy) return <ReviewAlert>首屏风险：历史材料未固定，送审范围待核实</ReviewAlert>;
  if (detail.archiveReview?.hasExceptions) return <ReviewAlert>首屏风险：存在缺项或不适用事项，请逐项核验</ReviewAlert>;
  return null;
}
