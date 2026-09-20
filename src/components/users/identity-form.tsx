"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getProfileIdentity, bindMyIdentity, correctUserIdentity } from "@/server/users/profile-actions";
import { correctUserIdentityWithPhotos } from "@/server/identity-documents/actions";
import { identityDocumentTypeLabel, identityDocumentTypes, type IdentityDocumentTypeValue } from "@/lib/identity-documents";

type Summary = Awaited<ReturnType<typeof getProfileIdentity>>;
export function IdentityForm({ adminTargetId }: { adminTargetId?: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [editing, setEditing] = useState(false);
  const [documentType, setDocumentType] = useState<IdentityDocumentTypeValue>("PRC_RESIDENT_ID");
  const [documentName, setDocumentName] = useState("");
  const [number, setNumber] = useState("");
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [secondaryFile, setSecondaryFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const prefix = `identity-${adminTargetId ?? "self"}`;
  const load = useCallback(async () => {
    try { setSummary(await getProfileIdentity(adminTargetId)); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "身份信息读取失败"); }
  }, [adminTargetId]);
  useEffect(() => { void load(); }, [load]);
  function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (!summary) return;
    if (secondaryFile && !primaryFile) {
      setSaveError("请先选择新的主要证件照片");
      return;
    }
    setSaveError("");
    start(async () => {
      try {
        const identity = { identityDocumentType: documentType, identityDocumentName: documentName, identityDocumentNumber: number };
        let updated;
        if (adminTargetId && primaryFile) {
          const formData = new FormData();
          formData.set("id", adminTargetId);
          formData.set("identityDocumentType", identity.identityDocumentType);
          formData.set("identityDocumentName", identity.identityDocumentName);
          formData.set("identityDocumentNumber", identity.identityDocumentNumber);
          formData.set("reason", reason);
          formData.set("expectedUpdatedAt", summary.updatedAt);
          formData.set("identityImagePrimary", primaryFile);
          if (secondaryFile) formData.set("identityImageSecondary", secondaryFile);
          updated = await correctUserIdentityWithPhotos(formData);
        } else updated = adminTargetId
          ? await correctUserIdentity({ id: adminTargetId, ...identity, reason, expectedUpdatedAt: summary.updatedAt })
          : await bindMyIdentity({ ...identity, currentPassword: password, expectedUpdatedAt: summary.updatedAt });
        setSummary(updated); setEditing(false); setNumber(""); setDocumentName(""); setPrimaryFile(null); setSecondaryFile(null); setPassword(""); setReason("");
        toast.success(adminTargetId ? "身份信息已更新并记录核对原因" : "身份证件已登记");
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "登记失败";
        setSaveError(message);
        toast.error(message);
      }
    });
  }

  const editForm = editing && summary ? (
    // 不用 <form>：本组件在个人设置中位于基本资料表单内部，嵌套表单非法；回车在外层拦截后直接提交
    <div className="space-y-3 rounded-lg border bg-background p-4" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}>
      <fieldset disabled={pending} className="space-y-3">
        <div className="space-y-2"><Label>证件类型</Label><Select value={documentType} onValueChange={value => { setDocumentType(value as IdentityDocumentTypeValue); if (value !== "OTHER") setDocumentName(""); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{identityDocumentTypes.map(type => <SelectItem key={type} value={type}>{identityDocumentTypeLabel[type]}</SelectItem>)}</SelectContent></Select></div>
        {documentType === "OTHER" && <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>证件名称</Label><Input id={`${prefix}-name`} required maxLength={60} value={documentName} onChange={e => setDocumentName(e.target.value)} placeholder="请输入证件全称" /></div>}
        <div className="space-y-2"><Label htmlFor={`${prefix}-number`}>证件号码</Label><Input id={`${prefix}-number`} autoComplete="off" spellCheck={false} maxLength={50} required value={number} onChange={e => setNumber(e.target.value)} placeholder={documentType === "PRC_RESIDENT_ID" ? "请输入18位居民身份证号码" : "请输入证件号码"} /></div>
        {adminTargetId && <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`${prefix}-photo-primary`}>新的主要证件照片（选填）</Label><Input id={`${prefix}-photo-primary`} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setPrimaryFile(event.target.files?.[0] ?? null)} /></div>
          <div className="space-y-2"><Label htmlFor={`${prefix}-photo-secondary`}>新的另一面／补充页（选填）</Label><Input id={`${prefix}-photo-secondary`} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setSecondaryFile(event.target.files?.[0] ?? null)} /></div>
          {primaryFile && <p className="sm:col-span-2 text-xs text-muted-foreground">保存后，现有照片将标记为已被替代并保留审计；不会物理删除。</p>}
        </div>}
        {adminTargetId ? <div className="space-y-2"><Label htmlFor={`${prefix}-reason`}>核对及更正原因</Label><Input id={`${prefix}-reason`} required minLength={4} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="说明核对依据，勿填写完整证件号或手机号" /></div>
          : <div className="space-y-2"><Label htmlFor={`${prefix}-password`}>当前密码</Label><Input id={`${prefix}-password`} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>}
        <p className="text-xs text-muted-foreground">{adminTargetId ? "请依据证件原件核对，变更原因将保存在审计记录中。" : "请核对证件属于本人。登记后本人不能更换或清空。"}</p>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <div className="flex gap-2"><Button type="button" onClick={() => save()}>{pending ? "正在保存…" : "确认登记"}</Button><Button type="button" variant="ghost" onClick={() => { setEditing(false); setNumber(""); setDocumentName(""); setPrimaryFile(null); setSecondaryFile(null); setPassword(""); setReason(""); }}>取消</Button></div>
      </fieldset>
    </div>
  ) : null;

  // 管理后台：保持原有分区版式（含照片上传与更正原因）
  if (adminTargetId) {
    return <section className="space-y-4 border-t pt-5">
      <div><h3 className="text-sm font-semibold">身份信息</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">证件类型和号码用于人员核对。登记不代表已完成实名认证；修改联系方式不会影响历史案件归属。</p></div>
      {error ? <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" onClick={() => void load()}>重新读取</Button></div> : !summary ? <p className="text-sm text-muted-foreground">正在读取身份信息…</p> : <>
        <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{summary.documentTypeLabel ?? "身份证件"}</span><span className="font-mono text-sm">{summary.number ?? "未登记"}</span>
          {!editing && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setSaveError(""); setDocumentType(summary.documentType ?? "PRC_RESIDENT_ID"); setDocumentName(summary.documentType === "OTHER" ? summary.documentTypeLabel ?? "" : ""); setEditing(true); }}>{summary.number ? "更正身份证件" : "登记身份证件"}</Button>}
        </div>
        {summary.photos.length > 0 && <div className="flex flex-wrap gap-2">{summary.photos.map((photo, index) => <a key={photo.id} href={`/api/users/${summary.userId}/identity-documents/${photo.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">查看证件照片{index + 1}</a>)}</div>}
        {summary.number && <p className="text-xs text-muted-foreground">已登记。证件信息如有错误，请在上方更正并记录原因。</p>}
        {editForm}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { void load(); }}>刷新身份信息</Button>
      </>}
    </section>;
  }

  // 个人设置：并入基本资料字段列的「证件号码」行（无上传，登记需当前密码）
  return <div className="space-y-2">
    {error ? <div role="alert" className="flex items-center gap-2"><p className="text-sm text-destructive">{error}</p><Button type="button" variant="ghost" size="sm" onClick={() => void load()}>重新读取</Button></div>
      : !summary ? <>
        <Label>证件号码</Label>
        <div className="flex min-h-10 items-center rounded-md border px-3"><span className="text-sm text-muted-foreground">正在读取…</span></div>
      </> : !editing ? <>
        <Label>证件号码</Label>
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border px-3">
          {summary.number ? (
            <span className="min-w-0 truncate font-mono text-sm">{summary.number}<span className="ml-2 font-sans text-xs text-muted-foreground">{summary.documentTypeLabel}</span></span>
          ) : (
            <span className="text-sm text-muted-foreground">未登记</span>
          )}
          {!summary.number && <Button type="button" variant="ghost" size="sm" onClick={() => { setSaveError(""); setDocumentType(summary.documentType ?? "PRC_RESIDENT_ID"); setDocumentName(summary.documentType === "OTHER" ? summary.documentTypeLabel ?? "" : ""); setEditing(true); }}>登记</Button>}
        </div>
        {summary.number && <p className="text-xs text-muted-foreground">如需更正，请联系管理员核对。</p>}
        {summary.photos.length > 0 && <div className="flex flex-wrap gap-2">{summary.photos.map((photo, index) => <a key={photo.id} href={`/api/users/${summary.userId}/identity-documents/${photo.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">查看证件照片{index + 1}</a>)}</div>}
      </> : editForm}
  </div>;
}
