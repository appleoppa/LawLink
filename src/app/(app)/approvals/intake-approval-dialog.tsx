"use client";

import { useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, ClipboardCheck, FileText, History, Paperclip, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { APPROVAL_STATUS_LABELS } from "@/lib/approvals/workspace";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";
import { IntakeApprovalContent } from "./intake-approval-content";
import styles from "@/components/patterns/review-dialog.module.css";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;
type Props = {
  detail: Detail;
  intakeDetail: NonNullable<Detail["intakeDetail"]>;
  note: string;
  onNoteChange: (value: string) => void;
  pending: boolean;
  onDecision: (decision: "approve" | "reject" | "revision") => void;
  onResubmit: () => void;
};
const dateText = (date: Date | string | null) => date ? new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未记录";

export function IntakeApprovalDialog({ detail, intakeDetail, note, onNoteChange, pending, onDecision, onResubmit }: Props) {
  const [tab, setTab] = useState("overview");
  const fields = intakeDetail.sections.flatMap(section => section.fields);
  const value = (label: string) => fields.find(field => field.label === label)?.value ?? "未填写";
  const latest = intakeDetail.checks[0];
  const hitCount = latest?.hits.length ?? 0;
  const riskTitle = !latest ? "尚未检索 · 请核查利益冲突" : !latest.coversCurrentParties ? "检索范围待补充 · 请核查当前当事人" : hitCount ? `检索命中 ${hitCount} 条 · 待人工核查` : "检索未命中 · 仍需人工核查";
  const feeLabel = fields.some(field => field.label === "基础办案费（元）") ? "基础办案费（元）" : "收费金额（元）";
  return <DialogContent className={`flex h-[90dvh] max-h-[960px] w-[calc(100%-48px)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 ${styles.dialog}`}>
    <DialogHeader className={styles.header}>
      <div className={styles.eyebrow}><ClipboardCheck size={15} />立案申请<Badge variant="outline">{APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"}</Badge></div>
      <DialogTitle className={styles.title}>{detail.title}</DialogTitle>
      <DialogDescription className={styles.subtitle}><span>申请人 {detail.requester}</span><span>提交于 {dateText(detail.submittedAt)}</span><span>{value("案件类别")}</span></DialogDescription>
    </DialogHeader>
    <div className={styles.workspace}>
      <Tabs value={tab} onValueChange={setTab} className={styles.reader}>
        <div className={styles.metrics}>
          <div><span>标的金额（元）</span><strong>{value("标的金额（元）")}</strong><small>{value("首个程序 / 审级")}</small></div>
          <div><span>{feeLabel}</span><strong>{value(feeLabel)}</strong><small>{value("收费方式")}</small></div>
          <div><span>主办律师</span><strong>{value("主办律师")}</strong><small>共同承办：{value("共同承办律师")}</small></div>
        </div>
        <button type="button" className={styles.risk} onClick={() => setTab("conflicts")}><AlertTriangle size={17} /><span><strong>{riskTitle}</strong><small>查看查询条件、命中依据与历史结论</small></span><ArrowUpRight size={16} /></button>
        <TabsList aria-label="立案申请详情" className={styles.tabs}>
          <TabsTrigger value="overview"><FileText size={15} />申请资料</TabsTrigger>
          <TabsTrigger value="conflicts"><ShieldCheck size={15} />冲突核查{hitCount > 0 && <span className={styles.tabCount}>{hitCount}</span>}</TabsTrigger>
          <TabsTrigger value="attachments"><Paperclip size={15} />附件<span className={styles.tabCount}>{detail.attachments.length}</span></TabsTrigger>
          <TabsTrigger value="history"><History size={15} />处理记录<span className={styles.tabCount}>{detail.history.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className={styles.panel}><IntakeApprovalContent detail={intakeDetail} view="overview" /></TabsContent>
        <TabsContent value="conflicts" className={styles.panel}><IntakeApprovalContent detail={intakeDetail} view="conflicts" /></TabsContent>
        <TabsContent value="attachments" className={styles.panel}>
          <div className={styles.panelHeading}><h3>申请附件</h3><p>本次申请关联的材料，可按当前权限查阅。</p></div>
          {!detail.attachments.length && <div className={styles.empty}><Paperclip size={28} /><strong>申请人尚未上传附件</strong><p>可结合申请资料判断是否需要退回补充。</p></div>}
          <div className={styles.files}>{detail.attachments.map(file => <div key={file.id} className={styles.file}><span className={styles.fileIcon}><FileText size={22} /></span><div><strong>{file.name}</strong><small>{file.readable ? "申请关联材料" : "当前无附件读取权限"}</small></div>{file.readable && <a href={`/api/documents/${file.id}/download?inline=1`} target="_blank" rel="noreferrer" aria-label={`查看附件：${file.name}`}>查看<ArrowUpRight size={14} /></a>}</div>)}</div>
        </TabsContent>
        <TabsContent value="history" className={styles.panel}>
          <div className={styles.panelHeading}><h3>处理记录</h3><p>逐次保留处理人、时间和意见，供复核申请流转过程。</p></div>
          {!detail.history.length && <div className={styles.empty}><History size={28} /><strong>{detail.status === "PENDING" ? "尚无处理记录" : "此记录未保存逐次处理历史"}</strong><p>{detail.status === "PENDING" ? "处理后将在这里显示审批意见与结果。" : "当前结果见申请状态。"}</p></div>}
          <ol className={styles.timeline}>{detail.history.map(event => <li key={event.id}><div><strong>{event.label}</strong><time>{dateText(event.at)}</time></div><span>{event.userName}</span>{(event.note || event.decision) && <p>{event.note || "未记录审批意见"}</p>}{event.legacy && <small>来自原业务记录</small>}</li>)}</ol>
        </TabsContent>
      </Tabs>
      <aside className={styles.decision} aria-label="立案审批处理">
        <div className={styles.decisionHeading}><span className={styles.sectionIcon}><ClipboardCheck size={18} /></span><div><h3>{detail.task ? "审批处理" : "申请进度"}</h3><p>{detail.task ? "审阅资料后作出决定" : "当前申请状态与后续操作"}</p></div></div>
        <div className={styles.decisionBody}>
          {detail.task ? <><label htmlFor="intake-approval-note">审批意见</label><Textarea id="intake-approval-note" aria-label="审批意见或驳回原因" placeholder="请记录核查意见；驳回或退回补正时必填" value={note} onChange={event => onNoteChange(event.target.value)} maxLength={500} disabled={pending} /><div className={styles.noteCount}>{note.length} / 500</div><p className={styles.decisionHint}><ShieldCheck size={16} />系统检索供核查参考，最终判断及理由由审批人确认。</p></> : <><Badge variant="outline">{APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"}</Badge><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail.canResubmit ? "补充完善申请资料后，可重新提交审批。" : "当前为只读查阅；后续进度会继续记录在此申请中。"}</p></>}
        </div>
        <div className={styles.actions}>
          {detail.task && <><Button disabled={pending} className={styles.approve} onClick={() => onDecision("approve")}><Check size={16} />{pending ? "处理中…" : "审批通过"}</Button><Button disabled={pending} variant="outline" onClick={() => onDecision("revision")}>退回补正</Button><Button disabled={pending} variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDecision("reject")}>驳回</Button><small>通过后转为正式案件</small></>}
          {detail.canResubmit && <Button disabled={pending} onClick={onResubmit}>重新提交审批</Button>}
        </div>
      </aside>
    </div>
  </DialogContent>;
}
