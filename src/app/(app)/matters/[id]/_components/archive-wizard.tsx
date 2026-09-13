"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpenCheck, ExternalLink, Loader2, AlertTriangle, FileCheck2, Sparkles, Upload, FileCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { archiveMatter, getArchivePrepData } from "@/server/archive/actions";
import { uploadDocument } from "@/server/documents/actions";
import { CLOSED_REASON_CN } from "@/server/archive/schemas";
import type { ArchiveChecklist, ArchiveChecklistItem } from "@/lib/archive/checklists";
import type { ArchiveClosedReason } from "@prisma/client";
import { ARCHIVE_MANUAL_CHECKS } from "@/lib/archive/snapshot";

interface LinkedDoc {
  id: string;
  name: string;
}

interface AvailableDocument extends LinkedDoc {
  category: string;
  mimeType: string | null;
  size: number | null;
  folderName: string | null;
}

// checklist item.id → DocumentCategory（用于上传时分类）
function inferCategory(itemId: string): string {
  if (itemId.includes("contract") || itemId.includes("retainer") || itemId.includes("counsel"))
    return "CONTRACT";
  if (itemId.includes("evidence")) return "EVIDENCE";
  if (
    itemId.includes("pleading") ||
    itemId.includes("opinion") ||
    itemId.includes("agent") ||
    itemId.includes("legal_opinion")
  )
    return "PLEADING";
  if (itemId.includes("judgment") || itemId.includes("ruling")) return "JUDGMENT";
  if (
    itemId.includes("intake") ||
    itemId.includes("closing") ||
    itemId.includes("power_of_attorney") ||
    itemId.includes("risk_disclosure") ||
    itemId.includes("hearing")
  )
    return "PROCEDURE";
  return "OTHER";
}

interface Props {
  matterId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ArchiveWizardDialog({ matterId, open, onOpenChange }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [checklist, setChecklist] = useState<ArchiveChecklist | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [itemStatuses, setItemStatuses] = useState<Record<string, "MISSING" | "NOT_APPLICABLE">>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [manualNotes, setManualNotes] = useState<Record<string, string>>({});
  const [availableDocuments, setAvailableDocuments] = useState<AvailableDocument[]>([]);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof getArchivePrepData>>["policy"] | null>(null);
  const [closedReason, setClosedReason] = useState<ArchiveClosedReason>("JUDGMENT");
  const [completedAt, setCompletedAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [judgmentSummary, setJudgmentSummary] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryFromClose, setSummaryFromClose] = useState(false);
  const [forceWithMissing, setForceWithMissing] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingItemRef = useRef<ArchiveChecklistItem | null>(null);

  async function refreshPrep(resetAssignments = false) {
    const data = await getArchivePrepData(matterId);
    setChecklist(data.checklist);
    setPolicy(data.policy);
    setAvailableDocuments(data.availableDocuments);
    const preselected = Object.fromEntries(Object.entries(data.docsByItem).map(([itemId, docs]) => [itemId, docs.map((doc) => doc.id)]));
    setAssignments((current) => resetAssignments ? preselected : Object.fromEntries(Object.keys({ ...current, ...preselected }).map((itemId) => [itemId, [...new Set([...(current[itemId] ?? []), ...(preselected[itemId] ?? [])])]])));
    if (data.matter.closedAt) {
      setCompletedAt(data.matter.closedAt.toISOString().slice(0, 10));
    }
    if (data.existingSummary) {
      setSummary(data.existingSummary);
      setSummaryFromClose(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSummaryFromClose(false);
    setAssignments({});
    setItemStatuses({});
    setItemNotes({});
    setManualChecks({});
    setManualNotes({});
    setForceWithMissing(false);
    refreshPrep(true)
      .catch((err) => {
        toast.error("加载归档数据失败", { description: err instanceof Error ? err.message : "" });
        onOpenChange(false);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matterId]);

  function triggerUpload(item: ArchiveChecklistItem) {
    pendingItemRef.current = item;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选同一文件
    const item = pendingItemRef.current;
    pendingItemRef.current = null;
    if (!file || !item) return;

    setUploadingItemId(item.id);
    try {
      const fd = new FormData();
      fd.set("matterId", matterId);
      fd.set("name", file.name.replace(/\.[^.]+$/, "") || item.label);
      fd.set("category", inferCategory(item.id));
      fd.set("archiveChecklistItemId", item.id);
      fd.set("encrypted", "false");
      fd.set("file", file);
      await uploadDocument(fd);
      toast.success(`已上传：${item.label}`, { description: file.name });
      await refreshPrep();
    } catch (err) {
      toast.error("上传失败", { description: err instanceof Error ? err.message : "" });
    } finally {
      setUploadingItemId(null);
    }
  }

  const missingRequired = checklist
    ? checklist.items.filter((i) => !i.autoGenerated && i.required && !(assignments[i.id]?.length > 0))
    : [];

  function handleSubmit() {
    if (!summary.trim()) {
      toast.warning("请填写结案小结");
      return;
    }
    if (missingRequired.length > 0 && !forceWithMissing) {
      toast.warning(`仍有 ${missingRequired.length} 项必交材料没有关联文件`, {
        description: "确实缺失或不适用时，须逐项说明并申请例外审批。"
      });
      return;
    }
    if (missingRequired.some((item) => !itemNotes[item.id]?.trim())) {
      toast.warning("请逐项填写必交材料缺项或不适用理由");
      return;
    }
    if (ARCHIVE_MANUAL_CHECKS.some((item) => !manualChecks[item.id])) {
      toast.warning("请完成全部归档人工核验事项");
      return;
    }
    if (!policy?.configured) {
      toast.error("律所尚未配置归档制度", { description: "请管理员先在“管理后台—归档制度”关联现行制度原文。" });
      return;
    }
    startTransition(async () => {
      try {
        const checklistItems = Object.fromEntries((checklist?.items ?? []).filter((item) => !item.autoGenerated).map((item) => {
          const documentIds = assignments[item.id] ?? [];
          return [item.id, {
            status: documentIds.length ? "ATTACHED" as const : itemStatuses[item.id] ?? "MISSING" as const,
            documentIds,
            note: itemNotes[item.id] ?? ""
          }];
        }));
        const result = await archiveMatter({
          matterId,
          summary,
          closedReason,
          completedAt: new Date(completedAt),
          judgmentSummary,
          checklistItems,
          manualChecks: Object.fromEntries(ARCHIVE_MANUAL_CHECKS.map((item) => [item.id, { confirmed: !!manualChecks[item.id], note: manualNotes[item.id] ?? "" }])),
          forceWithMissing
        });
        toast.success(
          result.status === "APPROVED"
            ? `案件已归档（${result.archiveNo}）`
            : `归档申请已提交（${result.archiveNo}），等待管理员审批`,
          {
            description: "卷宗封皮 + 目录已自动生成至归档卷宗"
          }
        );
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("归档失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-primary" />
            归档案件
          </DialogTitle>
          <DialogDescription>
            逐项关联实际材料并完成归档核验。提交后材料范围固定，由审批人逐件审阅。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[68vh] pr-4">
            <div className="space-y-5">
              {/* 结案信息 */}
              <section className="space-y-3">
                <h3 className="text-sm font-medium">结案信息</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">结案方式 *</Label>
                    <Select
                      value={closedReason}
                      onValueChange={(v) => setClosedReason(v as ArchiveClosedReason)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CLOSED_REASON_CN) as ArchiveClosedReason[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {CLOSED_REASON_CN[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">结案日期 *</Label>
                    <Input
                      type="date"
                      value={completedAt}
                      onChange={(e) => setCompletedAt(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">裁判结果摘要</Label>
                  <Textarea
                    value={judgmentSummary}
                    onChange={(e) => setJudgmentSummary(e.target.value)}
                    placeholder="如：一审判决支持原告诉请，对方未上诉，判决于 2026-04-15 生效"
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-xs">结案小结 *</Label>
                    {summaryFromClose && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                        <Sparkles className="h-3 w-3" />
                        已引用结案时填写的小结，可直接编辑
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={summary}
                    onChange={(e) => {
                      setSummary(e.target.value);
                      setSummaryFromClose(false);
                    }}
                    placeholder="案件办理过程概述、关键节点、得失复盘等"
                    rows={3}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">制度依据</h3>
                {policy?.configured ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium"><BookOpenCheck className="h-4 w-4 text-primary" />{policy.name} · {policy.version}</p>
                    <p className="mt-1 text-xs text-muted-foreground">生效日期：{policy.effectiveAt}。本次申请会固定制度原文及内容校验值。</p>
                    <a href={`/api/firm-files/${policy.sourceFileId}/download?inline=1`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline">查看制度原文：{policy.sourceFileName}<ExternalLink className="h-3 w-3" /></a>
                  </div>
                ) : (
                  <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>尚未配置律所归档制度</AlertTitle><AlertDescription>系统内置清单不能代替本所制度。请管理员先到“管理后台—归档制度”关联现行制度原文。</AlertDescription></Alert>
                )}
              </section>

              {checklist && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{checklist.title}</h3>
                    <span className="text-xs text-muted-foreground">
                      从本案已有材料中选择，或在对应项补传；带 * 为必交
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                  <div className="divide-y divide-border/60 rounded-lg border border-border/60">
                    {checklist.items.map((item) => {
                      const documentIds = assignments[item.id] ?? [];
                      const docs = documentIds.flatMap((id) => {
                        const document = availableDocuments.find((candidate) => candidate.id === id);
                        return document ? [document] : [];
                      });
                      const hasDocs = documentIds.length > 0;
                      const isUploading = uploadingItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          className={`space-y-3 px-3 py-3 ${item.autoGenerated ? "bg-primary/5" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span>{item.label}</span>
                              {item.required && <span className="text-destructive">*</span>}
                              {item.autoGenerated && (
                                <span className="inline-flex items-center gap-1 text-xs text-primary">
                                  <Sparkles className="h-3 w-3" />
                                  按本次材料生成
                                </span>
                              )}
                              {hasDocs && !item.autoGenerated && (
                                <span className="inline-flex items-center gap-1 text-xs text-[var(--green)]">
                                  <FileCheck className="h-3 w-3" />
                                  已关联 {docs.length} 份
                                </span>
                              )}
                            </div>
                            {item.hint && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.hint}</p>
                            )}
                          </div>
                          {!item.autoGenerated && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => triggerUpload(item)}
                              disabled={isUploading || isPending}
                              className="h-8 shrink-0 px-2 text-xs"
                            >
                              {isUploading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Upload className="mr-1 h-3 w-3" />
                                  补传材料
                                </>
                              )}
                            </Button>
                          )}
                          </div>
                          {!item.autoGenerated && <>
                            <div className="text-xs text-muted-foreground"><span>选择本案已有材料</span>
                              <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border bg-card p-2" role="group" aria-label={`${item.label}关联材料`}>
                                {availableDocuments.length ? availableDocuments.map((document) => <label key={document.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 text-sm text-foreground hover:bg-muted/60"><Checkbox checked={documentIds.includes(document.id)} onCheckedChange={(value) => setAssignments((current) => ({ ...current, [item.id]: value === true ? [...new Set([...(current[item.id] ?? []), document.id])] : (current[item.id] ?? []).filter((id) => id !== document.id) }))} /><span className="min-w-0 flex-1 break-words"><span className="text-xs text-muted-foreground">{document.folderName ?? "散件"} / </span>{document.name}</span></label>) : <p className="py-3 text-center text-xs text-muted-foreground">本案暂无可选材料，请使用“补传材料”。</p>}
                              </div>
                              <span className="mt-1 block">同一文件确有必要时可关联多个清单项。</span>
                            </div>
                            {hasDocs ? <div className="flex flex-wrap gap-2">{docs.map((document) => <a key={document.id} href={`/api/documents/${document.id}/download?inline=1`} target="_blank" rel="noreferrer" className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs text-primary underline" title={document.name}>{document.name}</a>)}</div> : <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                              <Select value={itemStatuses[item.id] ?? "MISSING"} onValueChange={(value) => setItemStatuses((current) => ({ ...current, [item.id]: value as "MISSING" | "NOT_APPLICABLE" }))}><SelectTrigger aria-label={`${item.label}缺项状态`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MISSING">缺失</SelectItem><SelectItem value="NOT_APPLICABLE">不适用</SelectItem></SelectContent></Select>
                              <Input aria-label={`${item.label}缺项或不适用说明`} value={itemNotes[item.id] ?? ""} onChange={(event) => setItemNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.required ? "必交项缺失或不适用时必须说明理由" : "可填写缺失或不适用说明"} maxLength={1000} />
                            </div>}
                          </>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div><h3 className="text-sm font-medium">人工核验事项</h3><p className="mt-1 text-xs text-muted-foreground">以下确认由申请人作出，审批人仍须独立复核。</p></div>
                <div className="space-y-2">{ARCHIVE_MANUAL_CHECKS.map((item) => <div key={item.id} className="rounded-lg border p-3"><label className="flex items-start gap-3"><Checkbox checked={!!manualChecks[item.id]} onCheckedChange={(value) => setManualChecks((current) => ({ ...current, [item.id]: value === true }))} /><span className="text-sm">{item.label}</span></label><Input className="mt-2" value={manualNotes[item.id] ?? ""} onChange={(event) => setManualNotes((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`${item.label}说明`} placeholder="必要时填写核验说明、原件去向或页码状态" maxLength={1000} /></div>)}</div>
              </section>

              {missingRequired.length > 0 && (
                <Alert variant="destructive" className="border-destructive/50 bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-sm font-medium text-destructive">
                    仍有 {missingRequired.length} 项必交材料没有关联文件
                  </AlertTitle>
                  <AlertDescription className="mt-1 text-xs text-destructive/85">
                    <div className="mb-1">缺项：{missingRequired.map((x) => x.label).join("、")}</div>
                    <div>
                      请优先选择或补传实际文件。确实无法补齐或不适用时，逐项说明理由并申请例外审批。
                    </div>
                  </AlertDescription>
                  <label className="mt-3 flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={forceWithMissing}
                      onCheckedChange={(v) => setForceWithMissing(!!v)}
                    />
                    <span className="text-xs text-destructive">
                      申请缺项或不适用例外审批
                    </span>
                  </label>
                </Alert>
              )}

              {/* v0.16: 审批流提示 */}
              <Alert className="border-primary/30 bg-primary/5">
                <AlertTitle className="text-xs font-medium text-primary">
                  归档审批流程
                </AlertTitle>
                <AlertDescription className="mt-0.5 text-[11.5px] text-muted-foreground">
                  提交后固定本次材料名称、大小、内容校验值和制度版本。审批人逐项核验通过后，案件才转为已归档。
                </AlertDescription>
              </Alert>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || loading || !policy?.configured}
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            提交归档审批
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
