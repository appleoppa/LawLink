"use client";

/**
 * 文书模板管理（v5 §4.4 挂账清偿：律师自定义文书模板上传）。
 * 内置模板只读；自定义模板支持上传（docx，自动提取 {{变量}}）与启停。
 * 上传后即出现在案件详情「模板」选择器（按案件类别过滤）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { uploadDocumentTemplate, toggleTemplate } from "@/server/document-templates/actions";
import { VARIABLE_LABEL_CN } from "@/app/(app)/matters/[id]/_components/folder-types";

type Category = "INTAKE" | "RETAINER" | "LITIGATION" | "HEARING" | "WORK_PRODUCT" | "ARCHIVE" | "CLOSING" | "BLANK";
type MatterCat = "CIVIL_COMMERCIAL" | "LABOR_ARBITRATION" | "COMMERCIAL_ARBITRATION" | "CRIMINAL" | "ADMINISTRATIVE" | "NON_LITIGATION" | "LEGAL_COUNSEL" | "SPECIAL_PROJECT";

const CATEGORY_CN: Record<Category, string> = {
  INTAKE: "收案文书", RETAINER: "委托文书", LITIGATION: "诉讼文书", HEARING: "庭审文书",
  WORK_PRODUCT: "工作成果", ARCHIVE: "卷宗文书", CLOSING: "结案文书", BLANK: "空白文档"
};
const MATTER_CAT_CN: Record<MatterCat, string> = {
  CIVIL_COMMERCIAL: "民商事", LABOR_ARBITRATION: "劳动仲裁", COMMERCIAL_ARBITRATION: "商事仲裁", CRIMINAL: "刑事", ADMINISTRATIVE: "行政",
  NON_LITIGATION: "非诉专项", LEGAL_COUNSEL: "法律顾问", SPECIAL_PROJECT: "专项"
};

export type AdminTemplateRow = {
  id: string;
  name: string;
  category: Category;
  description: string | null;
  applicableCategories: MatterCat[];
  variables: string[];
  isBuiltIn: boolean;
  enabled: boolean;
  updatedAt: string;
  createdBy: { name: string } | null;
  docxBlob: { name: string; size: number | null } | null;
};

export function DocumentTemplatesView({ templates }: { templates: AdminTemplateRow[] }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-4">
      <header className="ll-page-head">
        <div>
          <h2 className="ll-page-title">文书模板</h2>
          <p className="ll-page-sub">
            模板在案件详情「生成文书」时按案件类别选用；正文使用 <code className="font-mono text-[11px]">{"{{变量}}"}</code> 占位（如 <code className="font-mono text-[11px]">{"{{client.name}}"}</code>），生成时自动填充。
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          上传模板
        </Button>
      </header>

      <section className="ll-surface">
        <header className="ll-panel-head">
          <h3 className="ll-panel-title">
            <FileText className="h-4 w-4 text-primary" />
            模板库
            <span className="font-mono text-xs text-muted-foreground tabular">
              {templates.filter(t => t.enabled).length}/{templates.length}
            </span>
          </h3>
        </header>
        {templates.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">暂无模板</p>
        ) : (
          <div className="divide-y divide-border/60">
            {templates.map(t => (
              <div key={t.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${t.enabled ? "" : "opacity-55"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[12.75px] font-semibold">{t.name}</span>
                    <span className="badge b-white">{CATEGORY_CN[t.category]}</span>
                    {t.isBuiltIn ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary">内置</span>
                    ) : (
                      <span className="rounded-full border border-[#B7D8D6] bg-[#E4F1F0] px-1.5 py-px text-[10px] text-[#005054]">自定义</span>
                    )}
                    {!t.enabled && <span className="text-[10px] text-muted-foreground">已停用</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular">{t.variables.length} 个变量</span>
                    <span>·</span>
                    <span>{t.applicableCategories.length === 0 ? "适用全部案件类别" : t.applicableCategories.map(c => MATTER_CAT_CN[c]).join("／")}</span>
                    {t.docxBlob && (
                      <>
                        <span>·</span>
                        <span className="font-mono tabular">{Math.max(1, Math.round((t.docxBlob.size ?? 0) / 1024))} KB</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{t.createdBy?.name ?? "系统"} · {new Date(t.updatedAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                  {t.description && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/75">{t.description}</div>}
                </div>
                <ToggleEnabled template={t} />
              </div>
            ))}
          </div>
        )}
        <footer className="ll-panel-foot text-[11px] leading-relaxed text-muted-foreground">
          内置模板由系统维护、只可启停；自定义模板上传后立即生效，停用即从案件模板选择器隐藏。模板源文件加密存储，仅经生成流程读取。
        </footer>
      </section>

      <UploadSheet open={uploadOpen} onOpenChange={setUploadOpen} onDone={() => router.refresh()} />
    </div>
  );
}

function ToggleEnabled({ template }: { template: AdminTemplateRow }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
      <input
        type="checkbox"
        checked={template.enabled}
        disabled={pending}
        onChange={e => startTransition(async () => {
          try {
            await toggleTemplate({ id: template.id, enabled: e.target.checked });
            toast.success(e.target.checked ? "模板已启用" : "模板已停用");
            router.refresh();
          } catch (err) {
            toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
          }
        })}
      />
      {template.enabled ? "启用" : "停用"}
    </label>
  );
}

const SAMPLE_VARS = Object.keys(VARIABLE_LABEL_CN).slice(0, 12);

function UploadSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("LITIGATION");
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState<MatterCat[]>([]);
  const [extraVariables, setExtraVariables] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setName(""); setCategory("LITIGATION"); setDescription(""); setApplicable([]); setExtraVariables(""); setFile(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.warning("请填写模板名称"); return; }
    if (!file) { toast.warning("请选择 docx 模板文件"); return; }
    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("category", category);
    formData.set("description", description.trim());
    formData.set("applicableCategories", applicable.join(","));
    formData.set("extraVariables", extraVariables);
    formData.set("file", file);
    startTransition(async () => {
      try {
        const res = await uploadDocumentTemplate(formData);
        toast.success(`模板已上传（识别到 ${res.variableCount} 个变量）`);
        onOpenChange(false);
        reset();
        onDone();
      } catch (err) {
        toast.error("上传失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border bg-background px-6 py-4">
          <SheetTitle>上传文书模板</SheetTitle>
          <SheetDescription className="text-xs">
            仅支持 .docx；正文用双大括号占位，上传后自动提取变量清单（页眉页脚一并扫描）
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs">模板名称 <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="如：民事授权委托书（所内版）" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">模板大类 <span className="text-destructive">*</span></Label>
              <Select value={category} onValueChange={v => setCategory(v as Category)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_CN) as Category[]).map(c => (
                    <SelectItem key={c} value={c}>{CATEGORY_CN[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">适用案件类别（不选 = 全部）</Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(MATTER_CAT_CN) as MatterCat[]).map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setApplicable(cur => cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c])}
                    className={applicable.includes(c)
                      ? "rounded-full bg-[#E4F1F0] px-2.5 py-1 text-[11px] text-[#005054] shadow-[inset_0_0_0_1px_#B7D8D6]"
                      : "rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"}
                  >
                    {MATTER_CAT_CN[c]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">说明</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} maxLength={300} placeholder="用途、注意事项（可选）" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">模板文件（.docx，≤10MB）<span className="text-destructive">*</span></Label>
              <Input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">补充变量（逗号分隔，可选）</Label>
              <Input value={extraVariables} onChange={e => setExtraVariables(e.target.value)} placeholder="如：custom.claimPoint, custom.courtFee" className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">自动提取漏检时手工补齐；变量须为点分路径。</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-muted-foreground">常用变量（生成时自动填充）</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SAMPLE_VARS.map(v => (
                  <span key={v} className="rounded-full bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title={VARIABLE_LABEL_CN[v]}>
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <SheetFooter className="border-t border-border bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button>
            <Button type="submit" disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              上传
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
