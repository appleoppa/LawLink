"use client";
import {ExecutionTerminationPanel} from "@/components/matters/execution-termination-panel";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ApprovalAction } from "@prisma/client";
import { toast } from "sonner";
import { AlertTriangle, BookOpenCheck, ChevronRight, Clock3, FileCheck2, FileText, Paperclip, History, Search, ShieldCheck } from "lucide-react";
import { ACTION_LABELS } from "@/lib/approvals/rules";

/* 墨案 07：审批列表案卷脊——执行环节 teal、待审批琥珀、已批准绿、驳回红、归档金线 */
const ACTION_TONE: Record<string, string> = {
  INTAKE_APPROVE: "amber",
  DOCUMENT_APPROVE: "violet",
  ARCHIVE_APPROVE: "bronze",
  INVOICE_APPROVE: "teal",
  SEAL_APPROVE: "amber",
  SEAL_STAMP: "amber"
};
import { APPROVAL_STATUS_LABELS, WORKSPACE_TABS, type WorkspaceTab } from "@/lib/approvals/workspace";
import { getApprovalDetail, type listApprovalWorkspace } from "@/server/approval-permissions/inbox";
import { convertIntakeToMatter, declineIntake, markIntakeNeedsRevision, resubmitIntake } from "@/server/intakes/actions";
import { approveDocument, rejectDocument, submitDocumentForReview } from "@/server/documents/actions";
import { approveArchiveRecord, rejectArchiveRecord } from "@/server/archive/actions";
import { approveInvoiceRequest, rejectInvoiceRequest } from "@/server/invoices/actions";
import { approveSealRequest, rejectSealRequest, stampSealRequest, cancelSealRequest } from "@/server/seals/actions";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ReviewDialogContent, ReviewEmpty, ReviewFields, ReviewFileRow, ReviewHistory, ReviewSection, ReviewStatusLine } from "@/components/patterns/review-dialog";
import { PageHeader, Pager, Segmented } from "@/components/patterns/moan";
import { FilterSelect } from "@/components/patterns/filter-select";
import { ApprovalReviewSummary, approvalAlert } from "./approval-review-summary";
import { Checkbox } from "@/components/ui/checkbox";
import { ApprovalCreateMenu } from "./approval-create-menu";
import { IntakeApprovalDialog } from "./intake-approval-dialog";
import { InvoiceRecognition } from "./invoice-recognition";
import { ARCHIVE_DOCUMENT_STATUS_LABELS } from "@/lib/archive/snapshot";
import { formatDateTime } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof listApprovalWorkspace>>;
type Selection = { id: string; action: ApprovalAction };
const dateText = (date: Date | string | null) => date ? formatDateTime(date) : "—";

export function ApprovalInbox({ data, initialSelection }: { data: Data; initialSelection?: Selection }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(data.query.q ?? "");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getApprovalDetail>> | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [exceptionApproved, setExceptionApproved] = useState(false);
  const [pending, start] = useTransition();
  const opened = useRef<string | null>(null);
  function navigate(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("id"); params.delete("page");
    for (const [key, value] of Object.entries(patch)) { if (value) params.set(key, value); else params.delete(key); }
    router.push("/approvals?" + params.toString());
  }
  const open = useCallback((row: Selection) => {
    start(async () => {
      try {
        const d = await getApprovalDetail(row);
        setSelected(row); setDetail(d); setNote(""); setFile(null); setInvoiceNo(""); setVerified(new Set()); setExceptionApproved(false);
      } catch (e) { toast.error(e instanceof Error ? e.message : "无法读取申请"); }
    });
  }, []);
  useEffect(() => {
    if (!initialSelection) return;
    const key = initialSelection.action + initialSelection.id;
    if (opened.current === key) return;
    opened.current = key;
    open(initialSelection);
  }, [initialSelection, open]);
  useEffect(() => { setQuery(data.query.q ?? ""); }, [data.query.q]);

  function process(decision: "approve" | "reject" | "revision") {
    if (!selected || !detail?.task || detail.task==="terminate") return;
    const r = selected;
    if (decision === "approve" && (detail.task === "issue" || detail.task === "stamp") && !file) { toast.error(detail.task === "issue" ? "请上传电子发票" : "请上传盖章后的 PDF 扫描件"); return; }
    if (decision === "approve" && r.action === "INVOICE_APPROVE" && file && !invoiceNo.trim()) { toast.error("上传电子发票时必须填写发票号码"); return; }
    if (decision !== "approve" && !note.trim()) { toast.error("请填写原因"); return; }
    start(async () => {
      try {
        if (detail.task === "stamp") {
          const fd = new FormData(); fd.set("id", r.id); if (file) fd.set("stampedDoc", file); await stampSealRequest(fd);
        } else if (r.action === "INTAKE_APPROVE") {
          if (decision === "approve") await convertIntakeToMatter(r.id, note);
          else if (decision === "revision") await markIntakeNeedsRevision({ id: r.id, reason: note });
          else await declineIntake({ id: r.id, reason: note });
        } else if (r.action === "DOCUMENT_APPROVE") {
          if (decision === "approve") await approveDocument(r.id, note); else await rejectDocument(r.id, note);
        } else if (r.action === "ARCHIVE_APPROVE") {
          if (decision === "approve") await approveArchiveRecord({ archiveId: r.id, note, verificationIds: [...verified], exceptionApproved }); else await rejectArchiveRecord({ archiveId: r.id, note });
        } else if (r.action === "INVOICE_APPROVE") {
          if (decision === "approve") { const fd = new FormData(); fd.set("requestId", r.id); fd.set("processNote", note); fd.set("invoiceNo", invoiceNo); if (file) fd.set("invoiceFile", file); await approveInvoiceRequest(fd); }
          else await rejectInvoiceRequest({ requestId: r.id, reason: note });
        } else {
          if (decision === "approve") await approveSealRequest({ id: r.id, note }); else await rejectSealRequest({ id: r.id, reason: note });
        }
        toast.success("处理完成，可在“我已处理”中查阅");
        setSelected(null); router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "处理失败");
        // 状态或权限已变化时重读详情，不能保留失效的处理按钮。
        try { setDetail(await getApprovalDetail(r)); } catch { setSelected(null); }
        router.refresh();
      }
    });
  }
  function applicantAction(action: "resubmit" | "cancel") {
    if (!selected) return;
    const id = selected.id;
    start(async () => { try { if (action === "resubmit") { if (selected.action === "DOCUMENT_APPROVE") await submitDocumentForReview(id); else await resubmitIntake(id); } else await cancelSealRequest({ id }); toast.success(action === "resubmit" ? "已重新提交" : "已撤回申请"); setSelected(null); router.refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "操作失败"); } });
  }
  const tabs = Object.entries(WORKSPACE_TABS).filter(([key]) => key !== "all" || data.canViewAll) as [WorkspaceTab, string][];
  function toggleVerification(id: string, checked: boolean) {
    setVerified((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }
  const archiveReady = !detail?.archiveReview || (!detail.archiveReview.legacy
    && detail.archiveReview.verificationIds.every((id) => verified.has(id))
    && (!detail.archiveReview.hasExceptions || (exceptionApproved && !!note.trim())));

  /* 墨案 07：状态徽章（执行环节 teal，批准绿，驳回红仅终态） */
  function rowStatus(r: Data["rows"][number]): { cls: string; text: string; spine: string } {
    if (r.task === "issue") return { cls: "b-teal", text: "待开票", spine: "teal" };
    if (r.task === "stamp") return { cls: "b-teal", text: "待盖章回填", spine: "teal" };
    if (r.status === "PENDING") return { cls: "b-white", text: "待审批", spine: ACTION_TONE[r.action] === "bronze" ? "bronze" : "amber" };
    if (r.status === "APPROVED") return { cls: "b-green", text: "已批准", spine: "green" };
    if (r.status === "REJECTED") return { cls: "b-outline-red", text: "已驳回", spine: "red" };
    return { cls: "b-slate", text: APPROVAL_STATUS_LABELS[r.status] ?? "状态待核实", spine: "slate" };
  }
  const rowActionLabel = (r: Data["rows"][number]) => r.task === "issue" ? "查看并开票" : r.task === "stamp" ? "查看并回填" : r.task ? "查看并处理" : "查看记录";
  const waitDays = (d: Date | string) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const alert = detail && selected ? approvalAlert(detail) : null;

  const actionOptions = Object.entries(ACTION_LABELS).filter(([key]) => key !== "SEAL_STAMP").map(([value, label]) => ({ value, label }));
  const statusOptions = Object.entries(APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label }));

  return <div className="mo-list">
    <PageHeader
      title="审批"
      sub={<>收案、文书、归档、开票与用章统一审阅 · 待我审批 <b>{data.counts.pending}</b> 件{data.query.tab === "pending" ? " · 含批准后待开票与待盖章回填" : ""}</>}
      actions={<ApprovalCreateMenu />}
    />

    <Segmented
      className="mb-3"
      items={tabs.map(([key, label]) => ({ key, label, count: data.counts[key] }))}
      value={data.query.tab}
      onChange={(key) => navigate({ tab: key })}
    />

    <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); navigate({ q: query.trim() }); }}>
      <label className="mo-toolbar-input">
        <Search aria-hidden />
        <input aria-label="搜索审批" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索申请、申请人或案件" />
      </label>
      <FilterSelect label="事项" value={data.query.type ?? undefined} options={actionOptions} onChange={(v) => navigate({ type: v })} />
      <FilterSelect label="状态" value={data.query.status ?? undefined} options={statusOptions} onChange={(v) => navigate({ status: v })} />
      <label className="mo-filter-btn">
        {data.query.tab === "processed" ? "处理日起" : "提交日起"}
        <input type="date" aria-label="起始日期" className="bg-transparent text-[12.5px] text-[var(--t-primary)] outline-none" value={data.query.start ?? ""} onChange={e => navigate({ start: e.target.value })} />
      </label>
      <label className="mo-filter-btn">
        至
        <input type="date" aria-label="结束日期" className="bg-transparent text-[12.5px] text-[var(--t-primary)] outline-none" value={data.query.end ?? ""} onChange={e => navigate({ end: e.target.value })} />
      </label>
      {(data.query.q || data.query.type || data.query.status || data.query.start || data.query.end) ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); navigate({ q: undefined, type: undefined, status: undefined, start: undefined, end: undefined }); }}>重置筛选</button>
      ) : null}
    </form>

    <div className="card overflow-hidden">
      {data.rows.map(r => {
        const st = rowStatus(r);
        const actionText = ACTION_LABELS[r.action].replace("审批", "").replace("申请", "");
        return <div key={r.action + r.id} role="presentation" onClick={() => !pending && open(r)} className="mo-list-row mo-spine cursor-pointer" data-spine={st.spine}>
          <span className={`badge b-${ACTION_TONE[r.action] ?? "slate"} shrink-0 justify-center`} style={{ width: 52 }}>{actionText}</span>
          <div className="min-w-0 flex-1">
            <div className="rt truncate">{r.title}</div>
            <div className="rm truncate">
              申请人 {r.requester}{r.matter ? ` · ${r.matter}` : ""} · {dateText(r.submittedAt)}
              {r.task && r.status === "PENDING" && waitDays(r.submittedAt) >= 1 ? ` · 已等待 ${waitDays(r.submittedAt)} 天` : ""}
              {r.processor ? ` · 最近处理 ${r.processor} ${dateText(r.processedAt)}` : ""}
            </div>
          </div>
          <span className={`badge ${st.cls} shrink-0`}>{r.status === "PENDING" && r.task === "approve" ? <span className="bdot" /> : null}{st.text}</span>
          <button type="button" disabled={pending} onClick={(e) => { e.stopPropagation(); open(r); }} className="btn btn-ghost btn-sm shrink-0">
            {rowActionLabel(r)}
            <ChevronRight />
          </button>
        </div>;
      })}
      {!data.rows.length && <div className="empty"><div className="empty-ic"><History /></div><div className="mo-empty-title">暂无符合条件的{WORKSPACE_TABS[data.query.tab]}记录</div><div className="mo-empty-desc">可切换记录范围，或调整筛选条件。</div></div>}
      <div className="border-t border-[var(--bd-hair)]">
        <Pager page={data.page} totalPages={totalPages} summary={<>共 {data.total} 条 · 第 {data.page} / {totalPages} 页</>} onChange={(p) => navigate({ page: String(p) })} />
      </div>
    </div>

    <Dialog open={!!selected} onOpenChange={value => { if (!value && !pending) setSelected(null); }}>{detail?.intakeDetail ? <IntakeApprovalDialog key={selected?.id} detail={detail} intakeDetail={detail.intakeDetail} note={note} onNoteChange={setNote} pending={pending} onDecision={process} onResubmit={() => applicantAction("resubmit")} /> : <ReviewDialogContent
      key={selected?.id}
      title={detail?.title ?? "申请详情"}
      eyebrow={selected ? ACTION_LABELS[selected.action] : "审批申请"}
      status={detail ? <span className={`badge ${detail.task ? "b-amber" : detail.status === "REJECTED" ? "b-outline-red" : detail.status === "PENDING" ? "b-amber" : "b-green"}`}><span className="bdot" />{APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"}</span> : <span className="badge b-slate">加载中</span>}
      description={<><span>申请人 {detail?.requester ?? "—"}</span><span>· 提交于 {dateText(detail?.submittedAt ?? null)}</span>{detail?.task && detail.submittedAt ? <span>· 已等待 {waitDays(detail.submittedAt)} 天</span> : null}</>}
      summary={detail && selected && <ApprovalReviewSummary detail={detail} action={selected.action} />}
      alert={alert}
      tabs={[
        { id: "overview", label: detail?.archiveReview ? "资料与核验" : "申请资料", content: <>
          <ReviewFields title="当前申请内容" icon={<FileText />} fields={detail?.fields ?? []} />
          {detail?.archiveReview && (detail.archiveReview.legacy ? <ReviewSection title="历史材料未固定" icon={<AlertTriangle />}><div className="conf-sum"><div className="cs-ic"><AlertTriangle /></div><div><div className="cs-t">该申请只保存了勾选结果</div><div className="cs-d">无法还原当时实际送审材料。请驳回后由申请人重新关联材料并提交。</div></div></div></ReviewSection> : <>
            {detail.archiveReview.policy && <ReviewSection title="制度依据" icon={<BookOpenCheck />} extra={<a className="text-[var(--teal-deep)]" href={`/api/firm-files/${detail.archiveReview.policy.sourceFileId}/download?inline=1`} target="_blank" rel="noreferrer">查看制度原文 →</a>}>
              <div className="arow"><span className="k">制度</span><span className="v">{detail.archiveReview.policy.name} · {detail.archiveReview.policy.version}</span></div>
              <div className="arow"><span className="k">生效日期</span><span className="v mono">{detail.archiveReview.policy.effectiveAt}</span></div>
            </ReviewSection>}
            <ReviewSection title="实际归档材料" icon={<Paperclip />}>
              {detail.archiveReview.items.map(item => <div key={item.id} className="arow" style={{ alignItems: "flex-start" }}>
                <Checkbox className="mt-0.5" aria-label={`核验清单项：${item.label}`} checked={verified.has(`item:${item.id}`)} onCheckedChange={value => toggleVerification(`item:${item.id}`, value === true)} />
                <div className="v min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.label}{item.required ? " *" : ""}</span><span className={`badge ${item.status === "ATTACHED" ? "b-teal" : item.status === "AUTO_GENERATED" ? "b-slate" : item.status === "NOT_APPLICABLE" ? "b-white" : "b-red"}`}>{item.status === "ATTACHED" ? "已关联材料" : item.status === "AUTO_GENERATED" ? "系统生成" : item.status === "NOT_APPLICABLE" ? "不适用" : "缺失"}</span></div>
                  {item.note && <p className="t-xs t-mute mt-1">说明：{item.note}</p>}
                  {item.documentIds.map(documentId => { const attachment = detail.attachments.find(document => document.id === documentId); const snapshotDocument = detail.archiveReview?.documents.find(document => document.id === documentId); return <div key={documentId} className="mt-2 flex items-start gap-2 rounded-[8px] bg-[var(--bg-sunken)] p-2"><Checkbox disabled={!attachment?.readable} aria-label={`核验文件：${attachment?.name ?? documentId}`} checked={verified.has(`document:${documentId}`)} onCheckedChange={value => toggleVerification(`document:${documentId}`, value === true)} /><span className="min-w-0 flex-1 break-words text-[12.5px]">{attachment?.readable ? <a className="text-[var(--teal-deep)] underline" href={`/api/documents/${documentId}/download?inline=1`} target="_blank" rel="noreferrer">{attachment.name}</a> : `${attachment?.name ?? "材料"}（当前无法读取）`}{snapshotDocument && <span className="mt-1 block font-mono text-[11px] text-[var(--t-muted)]">{snapshotDocument.folderName ? `${snapshotDocument.folderName} · ` : ""}v{snapshotDocument.version} · {ARCHIVE_DOCUMENT_STATUS_LABELS[snapshotDocument.workflowStatus] ?? "状态待核实"} · {snapshotDocument.isLatest ? "当前版本" : "历史版本"} · {Math.max(1, Math.ceil(snapshotDocument.size / 1024))} KB · SHA-256 {snapshotDocument.sha256.slice(0, 12)}…</span>}</span></div>; })}
                </div>
              </div>)}
            </ReviewSection>
            {detail.archiveReview.excludedDocuments.length > 0 && <ReviewSection title={`本案另有 ${detail.archiveReview.excludedDocuments.length} 份材料未纳入本次归档`} icon={<AlertTriangle />}><div className="panel-body"><p className="t-xs t-mute">这些文件只展示名称，不因归档审批开放内容。请判断是否属于无关草稿、重复件，或应退回补充。</p><ul className="mt-2 max-h-28 list-disc space-y-1 overflow-y-auto pl-5 text-[12px]">{detail.archiveReview.excludedDocuments.map(document => <li key={document.id}>{document.folderName ? `${document.folderName} / ` : ""}{document.name}</li>)}</ul></div></ReviewSection>}
            <ReviewSection title="人工核验事项" icon={<ShieldCheck />}>
              {detail.archiveReview.manualChecks.map(item => <label key={item.id} className="arow cursor-pointer" style={{ alignItems: "flex-start" }}><Checkbox className="mt-0.5" aria-label={`复核：${item.label}`} checked={verified.has(`manual:${item.id}`)} onCheckedChange={value => toggleVerification(`manual:${item.id}`, value === true)} /><span className="v"><span className="font-semibold">{item.label}</span>{item.note && <span className="t-xs t-mute mt-1 block">申请人说明：{item.note}</span>}</span></label>)}
              {detail.archiveReview.hasExceptions && <label className="arow cursor-pointer" style={{ alignItems: "flex-start", background: "var(--amber-bg)" }}><Checkbox className="mt-0.5" aria-label="核准归档缺项或不适用例外" checked={exceptionApproved} onCheckedChange={value => setExceptionApproved(value === true)} /><span className="v"><span className="font-semibold">核准缺项或不适用例外</span><span className="t-xs t-mute mt-1 block">勾选后还须在审批意见中说明接受理由。</span></span></label>}
            </ReviewSection>
          </>)}
        </> },
        { id: "attachments", label: "附件", count: detail?.attachments.length ?? 0, content: detail?.attachments.length ? <ReviewSection title="申请附件" icon={<Paperclip />}>{detail.attachments.map(d => <ReviewFileRow key={d.id} id={d.id} name={d.name} readable={d.readable} />)}</ReviewSection> : <ReviewEmpty icon={<Paperclip />} title="暂无申请附件" desc="当前申请未关联可展示的材料。" /> },
        { id: "history", label: "处理记录", count: detail?.history.length ?? 0, content: <ReviewHistory items={detail?.history ?? []} emptyText={detail?.status === "PENDING" ? "尚无处理记录" : "此记录未保存逐次处理历史"} emptyDesc={detail?.status === "PENDING" ? "处理后将在这里显示审批意见与结果。" : "当前结果见申请状态。"} /> },
      ]}
      sidebarTitle={detail?.task === "issue" ? "完成开票" : detail?.task === "stamp" ? "盖章回填" : detail?.task === "terminate" ? "核实终止执行" : detail?.task ? "审批" : "申请进度"}
      sidebar={<>
        {detail?.task === "approve" && <ReviewStatusLine tone="amber" title="等待你的审批" desc={`你有本事项的${selected ? ACTION_LABELS[selected.action] : "审批"}授权${detail.submittedAt ? ` · 已等待 ${waitDays(detail.submittedAt)} 天` : ""}`} />}
        {selected&&["INVOICE_APPROVE","SEAL_APPROVE"].includes(selected.action)&&<ExecutionTerminationPanel kind={selected.action==="INVOICE_APPROVE"?"INVOICE":"SEAL"} id={selected.id} onChanged={()=>{open(selected);router.refresh();}}/>}
        {(detail?.task === "issue" || detail?.task === "stamp") && <ReviewStatusLine tone="teal" title={detail.task === "issue" ? "审批已通过 · 等待开具发票" : "审批已通过 · 等待盖章回填"} desc="执行环节不可再次驳回" />}
        {detail && !detail.task && <ReviewStatusLine tone={detail.status === "REJECTED" ? "red" : detail.status === "PENDING" ? "amber" : "green"} title={APPROVAL_STATUS_LABELS[detail.status] ?? "状态待核实"} desc={detail.canResubmit ? "补充完善后可重新提交审批" : "当前为只读查阅，后续进度会继续记录在此申请中"} />}
        {detail?.task && detail.task !== "stamp" && detail.task!=="terminate" && <><label htmlFor="approval-note" className="op-label">审批意见</label><textarea id="approval-note" className="op-area" aria-label="审批意见或驳回原因" placeholder="请记录处理意见；驳回时必填" value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={pending} /><div className="t-xs t-faint mt-1 text-right font-mono">{note.length} / 500</div></>}
        {detail?.task && (detail.task === "stamp" || (selected?.action === "INVOICE_APPROVE" && detail.task!=="terminate")) && <label className="mt-3 block space-y-2"><span className="op-label" style={{ margin: "12px 0 7px" }}>{detail.task === "stamp" ? "盖章后的 PDF 扫描件（必传）" : "电子发票（上传后记为已开具）"}</span><Input type="file" aria-label={detail.task === "stamp" ? "盖章后的 PDF 扫描件（必传）" : "电子发票（上传后记为已开具）"} accept={detail.task === "stamp" ? "application/pdf" : "application/pdf,image/*"} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>}
        {detail?.task && detail.task!=="terminate" && selected?.action === "INVOICE_APPROVE" && <Input className="mt-2" aria-label="发票号码" placeholder="发票号码" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />}
        {detail?.task && detail.task!=="terminate" && selected?.action === "INVOICE_APPROVE" && <InvoiceRecognition file={file} onNumber={setInvoiceNo} requestedAmount={detail.fields.find(f => f.label === "金额（元）")?.value} />}
        {detail?.archiveReview && detail.task === "approve" && <div className="op-check"><span className={`box ${archiveReady ? "checked" : ""}`}>{archiveReady ? <FileCheck2 /> : null}</span><span>{archiveReady ? "清单、材料与人工核验事项已全部核对。" : "请在「资料与核验」逐项勾选清单、文件与人工核验事项后再通过。"}</span></div>}
        <div className="side-note" style={{ marginTop: 16 }}><Clock3 /><span>审批结果与意见同事务写入审计日志，处理后不可重复审批；审批授权不扩大案件其他材料的访问范围。</span></div>
      </>}
      footer={detail && (detail.task || detail.canResubmit || detail.canCancel) ? <>
        {detail.task === "approve" && <button type="button" className="btn btn-danger" disabled={pending} onClick={() => process("reject")}>驳回</button>}
        {detail.task === "approve" && selected?.action === "INTAKE_APPROVE" && <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => process("revision")}>退回补正</button>}
        {detail.task && detail.task!=="terminate" && <button type="button" className="btn btn-approve" disabled={pending || !archiveReady} onClick={() => process("approve")}>{detail.task === "stamp" ? "完成盖章回填" : detail.task === "issue" ? "完成开票" : selected?.action === "ARCHIVE_APPROVE" ? <><FileCheck2 />逐项核验并通过</> : "审批通过"}</button>}
        {detail.canResubmit && <button type="button" className="btn btn-primary" disabled={pending} onClick={() => applicantAction("resubmit")}>重新提交审批</button>}
        {detail.canCancel && <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => applicantAction("cancel")}>撤回用章申请</button>}
      </> : undefined}
    />}</Dialog>
  </div>;
}
