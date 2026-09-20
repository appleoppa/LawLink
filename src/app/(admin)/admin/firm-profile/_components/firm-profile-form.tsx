"use client";

import { useRef, useState, useTransition } from "react";
import { Building2, Hash, ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renderCaseNoTemplate } from "@/lib/matters/firm-caseno";
import { shParts } from "@/lib/ui/sh-time";
import { saveFirmProfileAction } from "@/server/settings/firm-profile-actions";

type Category = { key: string; label: string; abbr: string; word: string };

type Initial = {
  firmName: string;
  firmSubtitle: string;
  logoDataUrl: string | null;
  matterCodePrefix: string;
  firmShortName: string;
  caseNoTemplate: string;
  categories: Category[];
};

const LOGO_MAX_BYTES = 180 * 1024;

export function FirmProfileForm({ initial }: { initial: Initial }) {
  const [firmName, setFirmName] = useState(initial.firmName);
  const [firmSubtitle, setFirmSubtitle] = useState(initial.firmSubtitle);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(initial.logoDataUrl);
  const [prefix, setPrefix] = useState(initial.matterCodePrefix);
  const [shortName, setShortName] = useState(initial.firmShortName);
  const [template, setTemplate] = useState(initial.caseNoTemplate);
  const [words, setWords] = useState<Record<string, string>>(
    Object.fromEntries(initial.categories.map((c) => [c.key, c.word]))
  );
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // 上海日历年：本地时区在 12/31 或 1/1 边界会取错年份（预览与实际编号须一致）
  const year = shParts(new Date()).y;
  const sample = initial.categories[0]; // 以第一个类别（民商诉讼）做示例
  const caseNoPreview = sample
    ? renderCaseNoTemplate(template, {
        year,
        firmShortName: shortName,
        categoryAbbr: sample.abbr,
        categoryWord: words[sample.key] || sample.word,
        seq: 1
      })
    : "";

  const onPickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error("请选择图片文件（PNG / JPG / WebP / SVG）");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo 过大，请控制在约 180KB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result as string);
    reader.onerror = () => toast.error("读取图片失败");
    reader.readAsDataURL(file);
  };

  const save = () => {
    startTransition(async () => {
      try {
        await saveFirmProfileAction({
          firmName: firmName.trim() || "LawLink",
          firmSubtitle,
          matterCodePrefix: prefix,
          firmShortName: shortName,
          caseNoTemplate: template,
          logoDataUrl,
          categoryWords: words
        });
        toast.success("律所信息已保存");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保存失败");
      }
    });
  };

  return (
    <div className="space-y-5">
      {/* —— 律所品牌 —— */}
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="text-[14px] font-semibold">律所品牌</h2>
        </header>
        <p className="mb-4 text-[12px] text-muted-foreground">
          侧边栏顶部显示的名称、副标题与标志图片。留空名称将回退默认「LawLink」。
        </p>

        <div className="flex items-start gap-5">
          {/* Logo 预览 + 上传 */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
              {logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoDataUrl} alt="Logo 预览" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-muted-foreground">无标志图片</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => onPickLogo(e.target.files?.[0])}
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ImageUp className="h-3 w-3" />
                上传
              </button>
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setLogoDataUrl(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  清除
                </button>
              )}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-[11px]">律所名称</Label>
              <Input
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                placeholder="如：星澜律师事务所"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-[11px]">副标题</Label>
              <Input
                value={firmSubtitle}
                onChange={(e) => setFirmSubtitle(e.target.value)}
                placeholder="如：律师工作台"
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </section>

      {/* —— 内部编号前缀 —— */}
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          <h2 className="text-[14px] font-semibold">系统内部编号</h2>
        </header>
        <p className="mb-4 text-[12px] text-muted-foreground">
          每个案件自动生成的系统编号前缀。格式固定为
          <span className="mx-1 font-mono">前缀-年份-类别-流水</span>，仅前缀可改。
        </p>
        <div className="flex items-end gap-4">
          <div className="w-40">
            <Label className="text-[11px]">编号前缀</Label>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="LL"
              className="mt-1 font-mono"
            />
          </div>
          <div className="pb-2 text-[12px] text-muted-foreground">
            示例：
            <span className="ml-1 font-mono text-foreground/85">
              {(prefix.trim() || "LL")}-{year}-CC-0001
            </span>
          </div>
        </div>
      </section>

      {/* —— 所内案号 —— */}
      <section className="ll-surface rounded-lg border border-border p-5">
        <header className="mb-3 flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          <h2 className="text-[14px] font-semibold">所内案号（自定义模板）</h2>
        </header>
        <p className="mb-4 text-[12px] text-muted-foreground">
          律所习惯的案号，转化收案时按模板自动生成。可用占位符：
          <code className="mx-0.5">{"{年}"}</code>
          <code className="mx-0.5">{"{年2}"}</code>
          <code className="mx-0.5">{"{所}"}</code>
          <code className="mx-0.5">{"{类}"}</code>
          <code className="mx-0.5">{"{类词}"}</code>
          <code className="mx-0.5">{"{序3}"}</code>
          <code className="mx-0.5">{"{序4}"}</code>
          （流水按「年+类别」独立计数）。
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-[11px]">所简称（{"{所}"}）</Label>
            <Input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="如：普"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">案号模板</Label>
            <Input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{年}-{所}{类词}-{序3}"
              className="mt-1 font-mono"
            />
          </div>
        </div>

        <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-[12px]">
          示例（{sample?.label ?? "民商诉讼"}）：
          <span className="ml-1 font-mono text-foreground/90">{caseNoPreview || "—"}</span>
        </div>

        <div className="mt-4">
          <Label className="text-[11px] text-muted-foreground">类别词（{"{类词}"}）映射</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            {initial.categories.map((c) => (
              <div key={c.key} className="rounded-md border border-border bg-card p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{c.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/70">{c.abbr}</span>
                </div>
                <Input
                  value={words[c.key] ?? ""}
                  onChange={(e) => setWords((w) => ({ ...w, [c.key]: e.target.value }))}
                  placeholder={c.word}
                  className="h-8 text-[12px]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          修改前缀 / 模板不影响已生成的历史编号；仅对之后新建的案件生效。
        </p>
        <Button onClick={save} disabled={pending} className="gap-1.5">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          保存
        </Button>
      </div>
    </div>
  );
}
