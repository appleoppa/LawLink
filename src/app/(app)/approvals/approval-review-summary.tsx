import type { ApprovalAction } from "@prisma/client";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";
import styles from "@/components/patterns/review-dialog.module.css";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;
export function ApprovalReviewSummary({ detail, action }: { detail: Detail; action: ApprovalAction }) {
  const value = (label: string) => detail.fields.find(field => field.label === label)?.value ?? "未记录";
  const items = action === "INVOICE_APPROVE" ? [
    ["申请金额（元）", value("金额（元）")], ["发票类型", value("类型")], ["申请附件", `${detail.attachments.length} 份`],
  ] : action === "DOCUMENT_APPROVE" ? [
    ["送审版本", value("版本")], ["上传人", value("上传人")], ["申请附件", `${detail.attachments.length} 份`],
  ] : action === "ARCHIVE_APPROVE" ? [
    ["归档编号", value("归档编号")], ["送审材料", detail.archiveReview?.legacy ? "历史未固定" : `${detail.attachments.length} 份`], ["完成时间", value("完成时间")],
  ] : [
    ["申请编号", value("申请编号")], ["文件数量", `${value("页数")} 页 × ${value("份数")} 份`], ["用章事项", value("用章事项")],
  ];
  return <>
    <div className={`${styles.metrics} ${styles.compactMetrics}`}>{items.map(([label, content]) => <div key={label}><span>{label}</span><strong>{content}</strong></div>)}</div>
    {detail.archiveReview && <div className={detail.archiveReview.legacy || detail.archiveReview.hasExceptions ? styles.risk : styles.contextNote}>
      {detail.archiveReview.legacy || detail.archiveReview.hasExceptions ? <AlertTriangle size={17} /> : <ClipboardCheck size={17} />}<span><strong>{detail.archiveReview.legacy ? "历史材料未固定 · 送审范围待核实" : detail.archiveReview.hasExceptions ? "存在缺项或不适用事项 · 请逐项核验" : "请核对送审材料与人工核验事项"}</strong><small>资料页保留清单、材料版本及核验说明</small></span>
    </div>}
    {(detail.task === "issue" || detail.task === "stamp") && <div className={styles.contextNote}><ClipboardCheck size={17} /><span><strong>{detail.task === "issue" ? "审批已通过 · 等待开具发票" : "审批已通过 · 等待盖章回填"}</strong><small>完成后可在处理记录中查看执行进度</small></span></div>}
  </>;
}
