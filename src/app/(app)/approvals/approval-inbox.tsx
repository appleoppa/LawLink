"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ApprovalAction } from "@prisma/client";
import { toast } from "sonner";
import { AlertTriangle, BookOpenCheck, ClipboardCheck, Clock3, FileCheck2, FileText, Paperclip, ArrowUpRight, History, Search } from "lucide-react";
import { ACTION_LABELS } from "@/lib/approvals/rules";

/* 墨案 07：审批列表按事项类型着脊线（红仅用章类风险语义，金=归档） */
const ACTION_SPINE: Record<string, string> = {
  INTAKE_APPROVE: "#96650B",
  DOCUMENT_APPROVE: "#1E56C8",
  ARCHIVE_APPROVE: "#8A6B3E",
  INVOICE_APPROVE: "#6C3FC5",
  SEAL_APPROVE: "#B42318",
  SEAL_STAMP: "#B42318"
};
import { APPROVAL_STATUS_LABELS, WORKSPACE_TABS, type WorkspaceTab } from "@/lib/approvals/workspace";
import { getApprovalDetail, type listApprovalWorkspace } from "@/server/approval-permissions/inbox";
import { convertIntakeToMatter, declineIntake, markIntakeNeedsRevision, resubmitIntake } from "@/server/intakes/actions";
import { approveDocument, rejectDocument, submitDocumentForReview } from "@/server/documents/actions";
import { approveArchiveRecord, rejectArchiveRecord } from "@/server/archive/actions";
import { approveInvoiceRequest, rejectInvoiceRequest } from "@/server/invoices/actions";
import { approveSealRequest, rejectSealRequest, stampSealRequest, cancelSealRequest } from "@/server/seals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ReviewDialogContent, ReviewFields } from "@/components/patterns/review-dialog";
import reviewStyles from "@/components/patterns/review-dialog.module.css";
import { ApprovalReviewSummary } from "./approval-review-summary";
import { Checkbox } from "@/components/ui/checkbox";
import { ApprovalCreateMenu } from "./approval-create-menu";
import { IntakeApprovalDialog } from "./intake-approval-dialog";
import { InvoiceRecognition } from "./invoice-recognition";
import { ARCHIVE_DOCUMENT_STATUS_LABELS } from "@/lib/archive/snapshot";

type Data = Awaited<ReturnType<typeof listApprovalWorkspace>>;
type Selection = { id: string; action: ApprovalAction };
const dateText = (date: Date | string | null) => date ? new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";

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
    if (!selected || !detail?.task) return;
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

  /* 墨案 07：状态徽章（执行环节用紫，批准绿、驳回红仅终态） */
  function rowStatus(r: Data["rows"][number]): { cls: string; text: string } {
    if (r.task === "issue") return { cls: "b-violet", text: "待开票" };
    if (r.task === "stamp") return { cls: "b-violet", text: "待盖章回填" };
    if (r.status === "PENDING") return { cls: "b-white", text: "待审批" };
    if (r.status === "APPROVED") return { cls: "b-green", text: "已批准" };
    if (r.status === "REJECTED") return { cls: "b-outline-red", text: "已驳回" };
    return { cls: "b-slate", text: APPROVAL_STATUS_LABELS[r.status] ?? "状态待核实" };
  }

  const pillCls = "inline-flex h-[32px] items-center gap-1.5 rounded-full border border-[#CFD7D3] bg-card px-3 text-[12.5px] text-muted-foreground shadow-[0_1px_2px_rgba(12,25,39,0.05)] transition-colors hover:border-input hover:bg-muted [&>select]:max-w-[9rem] [&>select]:truncate [&>select]:bg-transparent [&>select]:text-[12.5px] [&>select]:text-foreground [&>select]:outline-none";

  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="ll-page-title flex items-center gap-2"><ClipboardCheck className="h-[22px] w-[22px] text-primary" strokeWidth={1.8} />审批工作台</h1>
        <p className="ll-page-sub">收案、文书、归档、开票与用章，申请进度和处理记录统一查阅。</p></div>
      <ApprovalCreateMenu />
    </header>

    {/* 分段四视图（效果图 07 segmented，带计数） */}
    <div className="inline-flex gap-0.5 self-start rounded-[10px] bg-[#E9EDEB] p-[3px]" role="tablist" aria-label="审批记录范围">
      {tabs.map(([key, label]) => <button role="tab" aria-selected={data.query.tab === key} key={key} onClick={() => navigate({ tab: key })}
        className={"inline-flex h-[30px] items-center gap-1.5 rounded-[7px] px-3.5 text-[12.5px] transition-colors " + (data.query.tab === key ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(12,25,39,0.08)]" : "text-muted-foreground hover:text-foreground")}>
        {label}<span className="font-mono text-[11px] tabular opacity-60">{data.counts[key]}</span>
      </button>)}
    </div>

    {/* 工具栏（搜索 + 筛选胶囊，效果图 03 ListToolbar 语言） */}
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); navigate({ q: query.trim() }); }}>
      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98A3AD]" />
        <input aria-label="搜索审批" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索申请、申请人或案件"
          className="h-[32px] w-[240px] rounded-full border border-[#CFD7D3] bg-card pl-9 pr-3 text-[12.5px] shadow-[0_1px_2px_rgba(12,25,39,0.05)] outline-none placeholder:text-[#98A3AD] focus:border-[#007B7F] focus:shadow-[0_0_0_3px_rgba(0,123,127,0.12)]" />
      </label>
      <label className={pillCls}>事项
        <select aria-label="审批事项筛选" value={data.query.type ?? ""} onChange={e => navigate({ type: e.target.value })}>
          <option value="">全部</option>
          {Object.entries(ACTION_LABELS).filter(([key]) => key !== "SEAL_STAMP").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className={pillCls}>状态
        <select aria-label="审批状态筛选" value={data.query.status ?? ""} onChange={e => navigate({ status: e.target.value })}>
          <option value="">全部</option>
          {Object.entries(APPROVAL_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className={pillCls}>{data.query.tab === "processed" ? "处理日起" : "提交日起"}
        <input type="date" aria-label="起始日期" className="bg-transparent text-[12.5px] outline-none" value={data.query.start ?? ""} onChange={e => navigate({ start: e.target.value })} />
      </label>
      <label className={pillCls}>至
        <input type="date" aria-label="结束日期" className="bg-transparent text-[12.5px] outline-none" value={data.query.end ?? ""} onChange={e => navigate({ end: e.target.value })} />
      </label>
      <button type="button" onClick={() => { setQuery(""); navigate({ q: undefined, type: undefined, status: undefined, start: undefined, end: undefined }); }}
        className="inline-flex h-[32px] items-center rounded-full px-3 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">重置</button>
    </form>
    {data.query.tab === "pending" && <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />待办同时包含待审批、批准后待开票和待盖章回填。</p>}

    {/* 卡片行列表（效果图 07 bk-row：脊线 + 定宽事项徽章 + 标题/编号行 + 右侧状态徽章） */}
    <div className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
      {data.rows.map(r => {
        const st = rowStatus(r);
        return <button type="button" key={r.action + r.id} disabled={pending} onClick={() => open(r)}
          className="relative flex w-full items-center gap-3.5 border-b border-[#E8ECEA] py-3 pl-[22px] pr-4 text-left transition-colors last:border-b-0 hover:bg-[#F7FAF9] disabled:opacity-60">
          <span className="absolute left-0 top-[10px] bottom-[10px] w-[3px] rounded-r" style={{ background: ACTION_SPINE[r.action] ?? "#CFD7D3" }} aria-hidden />
          <span className="badge b-amber inline-flex w-[44px] shrink-0 justify-center !text-[11px]">{ACTION_LABELS[r.action].replace("审批", "")}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{r.title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              申请人 {r.requester}{r.matter ? ` · ${r.matter}` : ""} · {dateText(r.submittedAt)}
              {r.processor ? ` · 最近处理 ${r.processor} ${dateText(r.processedAt)}` : ""}
            </span>
          </span>
          <span className={`badge ${st.cls} shrink-0`}>{st.text}</span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-[#98A3AD]" />
        </button>;
      })}
      {!data.rows.length && <div className="p-12 text-center"><History className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p>暂无符合条件的{WORKSPACE_TABS[data.query.tab]}记录</p><p className="mt-2 text-sm text-muted-foreground">可切换记录范围，或调整筛选条件。</p></div>}
      <footer className="flex items-center justify-between gap-3 border-t border-[#E8ECEA] px-4 py-3 text-[11.5px] text-muted-foreground"><span>共 {data.total} 条 · 第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={data.page <= 1} onClick={() => navigate({ page: String(data.page - 1) })}>上一页</Button><Button size="sm" variant="ghost" disabled={data.page * data.pageSize >= data.total} onClick={() => navigate({ page: String(data.page + 1) })}>下一页</Button></div></footer>
    </div>
    <Dialog open={!!selected} onOpenChange={value => { if (!value && !pending) setSelected(null); }}>{detail?.intakeDetail ? <IntakeApprovalDialog key={selected?.id} detail={detail} intakeDetail={detail.intakeDetail} note={note} onNoteChange={setNote} pending={pending} onDecision={process} onResubmit={() => applicantAction("resubmit")} /> : <ReviewDialogContent
      key={selected?.id}
      title={detail?.title ?? "申请详情"}
      eyebrow={selected ? ACTION_LABELS[selected.action] : "审批申请"}
      status={<Badge variant="outline">{detail ? APPROVAL_STATUS_LABELS[detail.status] : "加载中"}</Badge>}
      description={<><span>申请人 {detail?.requester}</span><span>提交于 {dateText(detail?.submittedAt ?? null)}</span></>}
      summary={detail && selected && <ApprovalReviewSummary detail={detail} action={selected.action} />}
      tabs={[
        { id: "overview", label: detail?.archiveReview ? "资料与核验" : "申请资料", icon: <FileText size={15} />, content: <><section className="space-y-4"><h2 className="text-sm font-semibold">当前申请内容</h2><ReviewFields fields={detail?.fields ?? []} />
        {detail?.archiveReview && <div className="space-y-4 border-t pt-4">
          {detail.archiveReview.legacy ? <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"><p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" />历史材料未固定</p><p className="mt-2 text-sm text-muted-foreground">该申请只保存了勾选结果，无法还原当时实际送审材料。请驳回后由申请人重新关联材料并提交。</p></div> : <>
            {detail.archiveReview.policy && <div className="rounded-lg border bg-muted/30 p-4"><p className="flex items-center gap-2 text-sm font-medium"><BookOpenCheck className="h-4 w-4 text-primary" />制度依据</p><p className="mt-2 text-sm">{detail.archiveReview.policy.name} · {detail.archiveReview.policy.version}</p><p className="mt-1 text-xs text-muted-foreground">生效日期：{detail.archiveReview.policy.effectiveAt}</p><a className="mt-2 inline-block text-sm text-primary underline" href={`/api/firm-files/${detail.archiveReview.policy.sourceFileId}/download?inline=1`} target="_blank" rel="noreferrer">查看制度原文：{detail.archiveReview.policy.sourceFileName}</a></div>}
            <div className="space-y-2"><h3 className="text-sm font-semibold">实际归档材料</h3>{detail.archiveReview.items.map(item => <div key={item.id} className="rounded-lg border p-3">
              <div className="flex items-start gap-3"><Checkbox aria-label={`核验清单项：${item.label}`} checked={verified.has(`item:${item.id}`)} onCheckedChange={value => toggleVerification(`item:${item.id}`, value === true)} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{item.label}{item.required ? " *" : ""}</p><Badge variant="outline">{item.status === "ATTACHED" ? "已关联材料" : item.status === "AUTO_GENERATED" ? "系统生成" : item.status === "NOT_APPLICABLE" ? "不适用" : "缺失"}</Badge></div>{item.note && <p className="mt-1 text-xs text-muted-foreground">说明：{item.note}</p>}
                {item.documentIds.map(documentId => { const attachment = detail.attachments.find(document => document.id === documentId); const snapshotDocument = detail.archiveReview?.documents.find(document => document.id === documentId); return <div key={documentId} className="mt-2 flex items-start gap-2 rounded-md bg-muted/40 p-2"><Checkbox disabled={!attachment?.readable} aria-label={`核验文件：${attachment?.name ?? documentId}`} checked={verified.has(`document:${documentId}`)} onCheckedChange={value => toggleVerification(`document:${documentId}`, value === true)} /><span className="min-w-0 flex-1 break-words text-sm">{attachment?.readable ? <a className="text-primary underline" href={`/api/documents/${documentId}/download?inline=1`} target="_blank" rel="noreferrer">{attachment.name}</a> : `${attachment?.name ?? "材料"}（当前无法读取）`}{snapshotDocument && <span className="mt-1 block font-mono text-xs text-muted-foreground">{snapshotDocument.folderName ? `${snapshotDocument.folderName} · ` : ""}v{snapshotDocument.version} · {ARCHIVE_DOCUMENT_STATUS_LABELS[snapshotDocument.workflowStatus] ?? "状态待核实"} · {snapshotDocument.isLatest ? "当前版本" : "历史版本"} · {Math.max(1, Math.ceil(snapshotDocument.size / 1024))} KB · SHA-256 {snapshotDocument.sha256.slice(0, 12)}…</span>}</span></div>; })}
              </div></div>
            </div>)}</div>
            {detail.archiveReview.excludedDocuments.length > 0 && <div className="rounded-lg border border-[var(--amber-line)] bg-[var(--amber-bg)] p-3"><p className="text-sm font-medium">本案另有 {detail.archiveReview.excludedDocuments.length} 份材料未纳入本次归档</p><p className="mt-1 text-xs text-muted-foreground">这些文件只展示名称，不因归档审批开放内容。请判断是否属于无关草稿、重复件，或应退回补充。</p><ul className="mt-2 max-h-28 list-disc space-y-1 overflow-y-auto pl-5 text-xs">{detail.archiveReview.excludedDocuments.map(document => <li key={document.id}>{document.folderName ? `${document.folderName} / ` : ""}{document.name}</li>)}</ul></div>}
            <div className="space-y-2"><h3 className="text-sm font-semibold">人工核验事项</h3>{detail.archiveReview.manualChecks.map(item => <label key={item.id} className="flex items-start gap-3 rounded-lg border p-3"><Checkbox aria-label={`复核：${item.label}`} checked={verified.has(`manual:${item.id}`)} onCheckedChange={value => toggleVerification(`manual:${item.id}`, value === true)} /><span className="text-sm"><span className="font-medium">{item.label}</span>{item.note && <span className="mt-1 block text-xs text-muted-foreground">申请人说明：{item.note}</span>}</span></label>)}</div>
            {detail.archiveReview.hasExceptions && <label className="flex items-start gap-3 rounded-lg border border-[var(--amber-line)] bg-[var(--amber-bg)] p-3"><Checkbox aria-label="核准归档缺项或不适用例外" checked={exceptionApproved} onCheckedChange={value => setExceptionApproved(value === true)} /><span className="text-sm"><span className="font-medium">核准缺项或不适用例外</span><span className="mt-1 block text-xs text-muted-foreground">勾选后还须在审批意见中说明接受理由。</span></span></label>}
          </>}
        </div>}

      </section>
</> },
        { id: "attachments", label: "附件", icon: <Paperclip size={15} />, count: detail?.attachments.length ?? 0, content: <section className="space-y-4"><div className={reviewStyles.panelHeading}><h3>申请附件</h3><p>查阅本次申请关联的材料。</p></div>{!detail?.attachments.length && <div className={reviewStyles.empty}><Paperclip size={28} /><strong>暂无申请附件</strong><p>当前申请未关联可展示的材料。</p></div>}<div>{detail?.attachments.map(d => <div key={d.id} className={reviewStyles.file}><span className={reviewStyles.fileIcon}><FileText size={22} /></span><div><strong>{d.name}</strong><small>{d.readable ? "申请关联材料" : "当前无附件读取权限"}</small></div>{d.readable && <a href={"/api/documents/" + d.id + "/download?inline=1"} target="_blank" rel="noreferrer">查看<ArrowUpRight size={14} /></a>}</div>)}</div></section> },
        { id: "history", label: "处理记录", icon: <History size={15} />, count: detail?.history.length ?? 0, content: <><section className="space-y-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />处理历史</h2>
        {!detail?.history.length && <p className="text-sm text-muted-foreground">{detail?.status === "PENDING" ? "尚无处理记录。" : "此记录未保存逐次处理历史，当前结果见申请状态。"}</p>}
        {detail?.history.map(h => <div key={h.id} className="border-l-2 pl-4"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{h.label} · {h.userName}</span><span className="text-xs text-muted-foreground">{dateText(h.at)}</span></div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{h.note || (h.decision ? "未记录审批意见" : "")}</p>{h.legacy && <p className="mt-1 text-xs text-muted-foreground">来自原业务记录</p>}</div>)}
      </section>
      </> },
      ]}
      sidebarTitle={detail?.task === "issue" ? "完成开票" : detail?.task === "stamp" ? "盖章回填" : detail?.task ? "审批处理" : "申请进度"}
      sidebarDescription={detail?.task ? "结合申请资料与附件处理" : "当前申请状态与后续操作"}
      sidebar={<><div className={reviewStyles.decisionBody}>
        {detail?.task && <div className="space-y-4">{detail.task !== "stamp" && <div><label htmlFor="approval-note" className="mb-2 block text-xs font-medium">审批意见</label><Textarea id="approval-note" aria-label="审批意见或驳回原因" placeholder="请记录处理意见；驳回时必填" value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={pending} /><p className={reviewStyles.noteCount}>{note.length} / 500</p></div>}
        {(detail.task === "stamp" || selected?.action === "INVOICE_APPROVE") && <label className="block space-y-2 text-sm"><span>{detail.task === "stamp" ? "盖章后的 PDF 扫描件（必传）" : "电子发票（上传后记为已开具）"}</span><Input type="file" aria-label={detail.task === "stamp" ? "盖章后的 PDF 扫描件（必传）" : "电子发票（上传后记为已开具）"} accept={detail.task === "stamp" ? "application/pdf" : "application/pdf,image/*"} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>}
        {selected?.action === "INVOICE_APPROVE" && <Input aria-label="发票号码" placeholder="发票号码" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />}
        {selected?.action === "INVOICE_APPROVE" && <InvoiceRecognition file={file} onNumber={setInvoiceNo} requestedAmount={detail.fields.find(f => f.label === "金额（元）")?.value} />}
        </div>}
        {detail?.canResubmit && <div className="flex justify-end border-t pt-4"><Button disabled={pending} onClick={() => applicantAction("resubmit")}>重新提交审批</Button></div>}
      {detail?.canCancel && <div className="flex justify-end border-t pt-4"><Button variant="outline" disabled={pending} onClick={() => applicantAction("cancel")}>撤回用章申请</Button></div>}
      {!detail?.task && !detail?.canResubmit && !detail?.canCancel && <p className="border-t pt-3 text-xs text-muted-foreground">当前为只读查阅；后续进度会继续记录在此申请中。</p>}
    
      </div><div className={`${reviewStyles.actions} ${reviewStyles.reviewActions}`}>{detail?.task && <>{detail.task === "approve" && <><Button disabled={pending} variant="outline" onClick={() => process("reject")}>驳回</Button>{selected?.action === "INTAKE_APPROVE" && <Button disabled={pending} variant="outline" onClick={() => process("revision")}>退回补正</Button>}</>}<Button className={reviewStyles.approve} disabled={pending || !archiveReady} onClick={() => process("approve")}>{detail.task === "stamp" ? "完成盖章回填" : detail.task === "issue" ? "完成开票" : selected?.action === "ARCHIVE_APPROVE" ? <><FileCheck2 className="mr-2 h-4 w-4" />逐项核验并通过</> : "审批通过"}</Button></>}</div></>}
    />}</Dialog>
  </div>;
}
