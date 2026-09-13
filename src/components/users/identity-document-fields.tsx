"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { FileImage, Loader2, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  IDENTITY_IMAGE_MAX_BYTES,
  identityDocumentTypeLabel,
  identityDocumentTypes,
  type IdentityDocumentTypeValue
} from "@/lib/identity-documents";
import { getIdentityRecognitionConfig, recognizeIdentityDocument } from "@/server/identity-documents/recognition";

export type IdentityDocumentDraft = {
  documentType: IdentityDocumentTypeValue;
  documentName: string;
  documentNumber: string;
  primaryFile: File | null;
  secondaryFile: File | null;
};

export function IdentityDocumentFields({
  value,
  disabled,
  errors,
  onChange,
  onRecognizedName
}: {
  value: IdentityDocumentDraft;
  disabled?: boolean;
  errors?: Partial<Record<"documentType" | "documentName" | "documentNumber" | "primaryFile", string>>;
  onChange: (next: IdentityDocumentDraft) => void;
  onRecognizedName: (name: string) => void;
}) {
  const [recognizing, startRecognition] = useTransition();
  const portraitLike = ["PRC_RESIDENT_ID", "HK_MACAO_TAIWAN_RESIDENCE_PERMIT", "FOREIGN_PERMANENT_RESIDENT_ID"].includes(value.documentType);
  const primaryLabel = portraitLike ? "人像面照片" : "个人资料页照片";
  const secondaryLabel = portraitLike ? "另一面照片（选填）" : "补充页照片（选填）";

  function setFile(field: "primaryFile" | "secondaryFile", file: File | null) {
    if (file && (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > IDENTITY_IMAGE_MAX_BYTES)) {
      toast.error(file.size > IDENTITY_IMAGE_MAX_BYTES ? "单张证件照片不能超过10MB" : "证件照片仅支持 JPG、PNG 或 WebP");
      return;
    }
    onChange({ ...value, [field]: file });
  }

  function recognize() {
    if (!value.primaryFile) {
      toast.warning("请先选择主要证件照片");
      return;
    }
    startRecognition(async () => {
      try {
        const config = await getIdentityRecognitionConfig();
        if (!config.configured) {
          toast.warning("视觉识别服务尚未配置，请手工录入");
          return;
        }
        const remoteConsent = config.local || window.confirm(`证件照片将发送至 ${config.host} 进行本次识别。是否继续？`);
        if (!remoteConsent) return;
        const formData = new FormData();
        formData.set("file", value.primaryFile!);
        formData.set("selectedType", value.documentType);
        formData.set("remoteConsent", String(remoteConsent));
        const result = await recognizeIdentityDocument(formData);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        const recognizedType = result.data.documentType && result.data.documentType !== "UNKNOWN" ? result.data.documentType : value.documentType;
        onChange({
          ...value,
          documentType: recognizedType,
          documentName: recognizedType === "OTHER" ? value.documentName : "",
          documentNumber: result.data.documentNumber || value.documentNumber
        });
        if (result.data.name) onRecognizedName(result.data.name);
        toast.success("识别结果已填入，请对照原件核对", { description: `识别置信度：${result.data.confidence === "HIGH" ? "较高" : result.data.confidence === "MEDIUM" ? "中等" : "较低"}` });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "识别失败，请手工录入");
      }
    });
  }

  return <section className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
    <div>
      <h3 className="text-sm font-semibold">身份证件</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">证件类型和号码用于稳定识别本人。自动识别仅作预填，请对照原件核对。</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="证件类型" required error={errors?.documentType}>
        <Select disabled={disabled} value={value.documentType} onValueChange={documentType => onChange({ ...value, documentType: documentType as IdentityDocumentTypeValue, documentName: documentType === "OTHER" ? value.documentName : "" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{identityDocumentTypes.map(type => <SelectItem key={type} value={type}>{identityDocumentTypeLabel[type]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {value.documentType === "OTHER" && <Field label="证件名称" required error={errors?.documentName}>
        <Input disabled={disabled} maxLength={60} value={value.documentName} onChange={event => onChange({ ...value, documentName: event.target.value })} placeholder="请输入证件全称" />
      </Field>}
      <Field label="证件号码" required error={errors?.documentNumber}>
        <Input disabled={disabled} autoComplete="off" spellCheck={false} maxLength={50} className="font-mono uppercase" value={value.documentNumber} onChange={event => onChange({ ...value, documentNumber: event.target.value })} placeholder={value.documentType === "PRC_RESIDENT_ID" ? "请输入18位居民身份证号码" : "请输入证件号码"} />
      </Field>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <IdentityFileField label={`${primaryLabel}（选填）`} file={value.primaryFile} disabled={disabled} error={errors?.primaryFile} onChange={file => setFile("primaryFile", file)} />
      <IdentityFileField label={secondaryLabel} file={value.secondaryFile} disabled={disabled} onChange={file => setFile("secondaryFile", file)} />
    </div>
    <p className="-mt-1 text-xs text-muted-foreground">
      照片可稍后在「资料 → 身份证件」补充上传；涉及身份核验时请在核验前完成采集。
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={disabled || recognizing || !value.primaryFile} onClick={recognize} className="gap-1.5">
        {recognizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
        {recognizing ? "正在识别" : "自动识别"}
      </Button>
      <p className="text-xs text-muted-foreground">调用前会显示当前识别服务；非本地服务需每次确认。</p>
    </div>
  </section>;
}

function IdentityFileField({ label, required, file, disabled, error, onChange }: { label: string; required?: boolean; file: File | null; disabled?: boolean; error?: string; onChange: (file: File | null) => void }) {
  return <Field label={label} required={required} error={error}>
    {file ? <div className="space-y-2 rounded-lg border bg-background p-2">
      <FilePreview file={file} />
      <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-xs text-muted-foreground">{file.name}</span><Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`移除${label}`} onClick={() => onChange(null)}><X className="h-4 w-4" /></Button></div>
    </div> : <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-background px-3 py-4 text-center text-xs text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
      <FileImage className="h-5 w-5" />
      <span>选择 JPG、PNG 或 WebP，最大10MB</span>
      <Input className="sr-only" type="file" disabled={disabled} accept="image/jpeg,image/png,image/webp" aria-label={`选择${label}`} onChange={event => onChange(event.target.files?.[0] ?? null)} />
    </label>}
  </Field>;
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <Image unoptimized src={url} alt="待上传证件照片预览" width={480} height={224} className="h-28 w-full rounded-md bg-muted object-contain" /> : null;
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5">
    <Label className="flex items-center gap-1 text-xs">{label}{required && <span className="text-destructive">*</span>}</Label>
    {children}
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>;
}
