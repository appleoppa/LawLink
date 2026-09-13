"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  parseMatterImportAction,
  commitMatterImportAction,
  type ImportPreview,
  type ImportResult
} from "@/server/imports/actions";

export function MatterImportView() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parsing, startParse] = useTransition();
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    startParse(async () => {
      try {
        const p = await parseMatterImportAction(fd);
        setPreview(p);
      } catch (e) {
        setPreview(null);
        toast.error(e instanceof Error ? e.message : "解析失败");
      }
    });
  };

  const doImport = () => {
    if (!preview) return;
    const valid = preview.rows.filter((r) => r.valid).map((r) => ({ rowNo: r.rowNo, raw: r.raw }));
    if (valid.length === 0) {
      toast.error("没有可导入的有效行");
      return;
    }
    startImport(async () => {
      try {
        const res = await commitMatterImportAction({ rows: valid });
        setResult(res);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
        toast.success(`导入完成：成功 ${res.succeeded.length}，失败 ${res.failed.length}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "导入失败");
      }
    });
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-5">
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h2 className="text-lg">案件批量导入</h2>
        </header>
        <p className="mb-4 text-[12px] text-muted-foreground">
          下载 Excel 模板填写后上传 → 预览校验（有误的行会标红，仅导入无误行）→ 确认导入。
          每行将创建客户（按名称+证件号查重）、案件（自动编号 + 所内案号 + 主办）、当事人（驱动利益冲突），
          「办理中」的案件按类型自动生成首程序。
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/imports/matters/template" download>
            <Button variant="outline" className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              下载模板
            </Button>
          </a>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={parsing} className="gap-1.5">
            {parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            上传并预览
          </Button>
          {fileName && <span className="text-[12px] text-muted-foreground">{fileName}</span>}
        </div>
      </section>

      {/* —— 预览 —— */}
      {preview && (
        <section className="ll-surface rounded-lg border border-border p-5">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-medium">
              预览
              <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                共 {preview.total} 行 · 可导入{" "}
                <span className="text-emerald-700">{preview.validCount}</span> · 有误{" "}
                <span className={preview.total - preview.validCount > 0 ? "text-destructive" : ""}>
                  {preview.total - preview.validCount}
                </span>
              </span>
            </h3>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>
                取消
              </Button>
              <Button size="sm" onClick={doImport} disabled={importing || preview.validCount === 0} className="gap-1.5">
                {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                确认导入 {preview.validCount} 行
              </Button>
            </div>
          </header>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">行</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">校验</th>
                  {preview.columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {c.header}
                      {c.required && <span className="text-destructive">*</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.rowNo}
                    className={r.valid ? "border-b border-border" : "border-b border-border bg-destructive/5"}
                  >
                    <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.rowNo}</td>
                    <td className="px-2 py-1.5">
                      {r.valid ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-destructive"
                          title={r.errors.join("；")}
                        >
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span className="max-w-[220px] truncate">{r.errors.join("；")}</span>
                        </span>
                      )}
                    </td>
                    {preview.columns.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-2 py-1.5">
                        {r.raw[c.key] || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* —— 结果 —— */}
      {result && (
        <section className="ll-surface rounded-lg border border-border p-5">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-medium">
              导入结果 · 成功 <span className="text-emerald-700">{result.succeeded.length}</span> · 失败{" "}
              <span className={result.failed.length > 0 ? "text-destructive" : ""}>{result.failed.length}</span>
            </h3>
            <Button variant="ghost" size="sm" onClick={reset}>
              再导入一批
            </Button>
          </header>

          {result.succeeded.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-[12px] text-muted-foreground">成功创建：</p>
              <ul className="space-y-0.5 text-[12px]">
                {result.succeeded.map((s) => (
                  <li key={s.rowNo} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                      <span className="font-mono text-muted-foreground">第{s.rowNo}行</span>
                      <span className="font-mono">{s.internalCode}</span>
                      {s.firmCaseNo && <span className="font-mono text-muted-foreground">{s.firmCaseNo}</span>}
                      <span className="truncate">{s.title}</span>
                    </div>
                    {s.causeDowngradeReason && (
                      <div className="ml-5 flex items-start gap-1.5 text-[11px] text-amber-600">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          案由已降级为自由文本（{s.causeDowngradeReason}），案件已导入，请事后人工核对案由
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.failed.length > 0 && (
            <div>
              <p className="mb-1 text-[12px] text-destructive">失败行：</p>
              <ul className="space-y-0.5 text-[12px]">
                {result.failed.map((f) => (
                  <li key={f.rowNo} className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span className="font-mono">第{f.rowNo}行</span>
                    <span>{f.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
