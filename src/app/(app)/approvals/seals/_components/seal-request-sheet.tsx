"use client";

import { FormDialogContent as DialogContent, FormDialogBody, FormSection } from "@/components/patterns/form-dialog";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Paperclip, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioChips } from "@/components/ui/radio-chips";
import { listActiveSealPurposes } from "@/server/approval-permissions/actions";
import { createSealRequest } from "@/server/seals/actions";
import {
  type SealTypeConfigRow,
  type MatterOption,
  SEAL_TYPE_CN
} from "./seal-types";
import { MatterCombobox } from "./matter-combobox";


function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function SealRequestSheet({
  open,
  onOpenChange,
  configs,
  matters,
  preset,
  onSubmitted
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  configs: SealTypeConfigRow[];
  matters: MatterOption[];
  onSubmitted?: (id: string) => void;
  preset: {
    draftDocId?: string;
    matterId?: string;
    documentTitle?: string;
  } | null;
}) {
  const [purposeConfigId, setPurposeConfigId] = useState("");
  const [purposes, setPurposes] = useState<Awaited<ReturnType<typeof listActiveSealPurposes>>>([]);
  useEffect(() => { if (open) listActiveSealPurposes().then(setPurposes).catch(() => toast.error("无法读取用章事项，请重新打开申请")); }, [open]);
  const [sealType, setSealType] = useState<string>("");
  const [matterId, setMatterId] = useState<string>("");
  /** 本次用印说明：一句话，说明这次为什么盖章；分类由上方「用章事项」承担（2026-09-19 去重） */
  const [purpose, setPurpose] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [pageCount, setPageCount] = useState(1);
  const [crossPage, setCrossPage] = useState(false);
  const [copies, setCopies] = useState(1);
  const [urgency, setUrgency] = useState<"NORMAL" | "URGENT">("NORMAL");
  const [requestNote, setRequestNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [alsoLegalRep, setAlsoLegalRep] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // 卷宗联动预填
  useEffect(() => {
    if (preset?.matterId) setMatterId(preset.matterId);
    if (preset?.documentTitle) setDocumentTitle(preset.documentTitle);
  }, [preset]);

  const reset = () => {
    setSealType("");
    setPurposeConfigId("");
    setMatterId("");
    setPurpose("");
    setDocumentTitle("");
    setPageCount(1);
    setCrossPage(false);
    setCopies(1);
    setUrgency("NORMAL");
    setRequestNote("");
    setFile(null);
    setAlsoLegalRep(false);
  };

  const enabledConfigs = configs.filter((c) => c.enabled);
  const hasExisting = !!preset?.draftDocId;

  const submit = () => {
    if (!sealType) {
      toast.error("请选择章种类");
      return;
    }
    if (!purpose.trim()) {
      toast.error("请填写本次用印说明");
      return;
    }
    if (!documentTitle.trim()) {
      toast.error("请填写文件标题");
      return;
    }
    if (!hasExisting && !file) {
      toast.error("请上传待盖章稿");
      return;
    }
    if (!hasExisting && file && !isPdfFile(file)) {
      toast.error("需上传 pdf 格式文件");
      return;
    }

    const fd = new FormData();
    fd.set("sealType", sealType);
    if (purposeConfigId) fd.set("purposeConfigId", purposeConfigId);
    if (matterId) fd.set("matterId", matterId);
    fd.set("purpose", purpose.trim());
    fd.set("documentTitle", documentTitle.trim());
    fd.set("pageCount", String(pageCount));
    fd.set("requireCrossPageSeal", String(crossPage));
    fd.set("copies", String(copies));
    fd.set("urgency", urgency);
    fd.set("requestNote", requestNote.trim());
    if (alsoLegalRep && sealType !== "LEGAL_REP_SEAL") {
      fd.set("alsoLegalRep", "true");
    }
    if (hasExisting && preset?.draftDocId) {
      fd.set("existingDraftDocId", preset.draftDocId);
    } else if (file) {
      fd.set("draftDoc", file);
    }

    startTransition(async () => {
      try {
        const res = await createSealRequest(fd);
        toast.success(`已提交 ${res.code}${alsoLegalRep && sealType !== "LEGAL_REP_SEAL" ? "（含法人章配套申请）" : ""}`);
        reset();
        onOpenChange(false);
        if (onSubmitted) onSubmitted(res.id); else router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "提交失败");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建用章申请</DialogTitle>
          <DialogDescription>填写用印事项并核对待盖章文件，提交后可在审批工作台跟进。</DialogDescription>
        </DialogHeader>
        <FormDialogBody>

        <div className="space-y-6">
        <FormSection title="用章信息" description="选择印章、关联案件与事项，并说明本次用印">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 联动提示 */}
          {hasExisting && (
            <div
              className="ll-surface flex items-start gap-2 rounded p-2.5 text-[12px] md:col-span-2"

            >
              <Link2 className="mt-0.5 h-3.5 w-3.5 text-primary" />
              <div>
                <p className="text-foreground">已关联卷宗文档作为待盖章稿</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {preset?.documentTitle}
                </p>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <Label className="text-xs">章种类 *</Label>
            <RadioChips
              className="mt-2"
              items={enabledConfigs.map((c) => ({
                value: c.type as string,
                label: SEAL_TYPE_CN[c.type] ?? c.type,
                description: c.description ?? undefined
              }))}
              value={sealType}
              onChange={setSealType}
            />
            {sealType && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {enabledConfigs.find((c) => c.type === sealType)?.description}
              </p>
            )}
            {sealType && sealType !== "LEGAL_REP_SEAL" && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-background px-2.5 py-1.5 text-[12px]">
                <Checkbox
                  checked={alsoLegalRep}
                  onCheckedChange={(v) => setAlsoLegalRep(v === true)}
                />
                <span>同时加盖 <strong className="text-foreground">法定代表人章</strong></span>
                <span className="text-[11px] text-muted-foreground">
                  会自动建一条配套的法人章审批，与本章并行
                </span>
              </label>
            )}
          </div>

          <div>
            <Label className="text-xs">关联案件 (可选)</Label>
            <div className="mt-1">
              {preset?.matterId ? (
                // 从案件详情页发起时，case 已锁定，不展示可切换的下拉
                <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-[12px]">
                  <span className="text-[11px] text-muted-foreground">已关联</span>
                  <span className="truncate">
                    {matters.find((m) => m.id === preset.matterId)?.title ?? "当前案件"}
                  </span>
                </div>
              ) : (
                <MatterCombobox
                  matters={matters}
                  value={matterId}
                  onChange={setMatterId}
                  placeholder="不关联案件"
                />
              )}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="block text-xs">用章事项
              <select className="my-2 h-9 w-full rounded-md border bg-background px-2 text-sm" value={purposeConfigId} onChange={e => setPurposeConfigId(e.target.value)}>
                <option value="">请选择</option>{purposes.filter(p => !sealType || p.allowedSealTypes.some(t => t === sealType)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Label>
            {!purposes.length && <p className="mb-2 text-xs text-muted-foreground">尚未配置用章事项；启用按事项审批后需由管理员先配置。</p>}
            <Label className="text-xs" htmlFor="seal-purpose">本次用印说明 *</Label>
            <Input
              id="seal-purpose"
              className="mt-2"
              maxLength={60}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="一句话说明这次为什么盖章，如：向华东置业发送催告履行律师函"
            />
          </div>

        </div></FormSection>
        <FormSection title="文件信息" description="核对文件名称、数量与盖章要求">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">文件标题 *</Label>
            <Input
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">页数</Label>
              <Input
                type="number"
                min={1}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">份数</Label>
              <Input
                type="number"
                min={1}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between md:col-span-2">
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox
                checked={crossPage}
                onCheckedChange={(v) => setCrossPage(v === true)}
              />
              需要骑缝章
            </label>
            <RadioChips
              size="sm"
              items={[
                { value: "NORMAL", label: "普通" },
                { value: "URGENT", label: "紧急", accent: "#B42318" }
              ]}
              value={urgency}
              onChange={(v) => setUrgency(v as "NORMAL" | "URGENT")}
            />
          </div>

        </div></FormSection>
        <FormSection title="材料与说明">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">备注</Label>
            <Textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              rows={2}
              className="mt-1 text-[12px]"
            />
          </div>

          {!hasExisting && (
            <div className="md:col-span-2">
              <Label className="text-xs">待盖章稿 *</Label>
              <div className="mt-1">
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground hover:bg-muted/30">
                  <Paperclip className="h-3.5 w-3.5" />
                  {file ? (
                    <span className="flex items-center gap-1 text-foreground">
                      <FileText className="h-3 w-3" />
                      {file.name}
                    </span>
                  ) : (
                    "选择 PDF 文件"
                  )}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files?.[0] ?? null;
                      if (picked && !isPdfFile(picked)) {
                        toast.error("需上传 pdf 格式文件");
                        e.target.value = "";
                        setFile(null);
                        return;
                      }
                      setFile(picked);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div></FormSection>
        </div>
        </FormDialogBody>
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            提交申请
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
