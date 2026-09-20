"use client";
/**
 * B2 OCR 设置卡：默认复用上方 AI 设置的视觉模型（图片识别）；可选配置独立 HTTP OCR 网关
 * （支持任意云厂商 / 自建网关，声明 supportsPdf 后可整体识别扫描 PDF）。未配置时来件分析
 * 对扫描件降级为「需人工（无 OCR）」，保存、取件与人工确认照常（不显示为分析成功）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function OcrSettingsForm({ initial }: { initial: { endpoint: string; apiKey: string; supportsPdf: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [apiKey, setApiKey] = useState("");
  const [supportsPdf, setSupportsPdf] = useState(initial.supportsPdf);

  function save() {
    start(async () => {
      try {
        const { saveOcrSettingsAction } = await import("@/server/settings/ocr-actions");
        await saveOcrSettingsAction({ endpoint: endpoint.trim(), apiKey: apiKey.trim() || undefined, supportsPdf });
        toast.success("OCR 设置已保存");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="text-sm font-medium">OCR 服务（可选）</div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        默认直接使用上方 AI 设置的视觉模型识别图片（无需额外配置）。如需识别无文本层的扫描 PDF，或希望用专用云 OCR，配置下方 HTTP 网关：
        系统以 <code className="rounded bg-muted px-1">{"{ contentBase64, mimeType }"}</code> POST，期望返回 <code className="rounded bg-muted px-1">{"{ text }"}</code>；
        部署方可自行对接阿里 / 腾讯 / 百度等云 OCR 或自建网关。留空即不启用（扫描件将标记「需人工」降级处理）。
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="ocr-endpoint">OCR 网关地址（可选）</Label>
          <Input id="ocr-endpoint" placeholder="https://ocr.example.com/recognize" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ocr-key">API Key（可选，留空保持不变）</Label>
          <Input id="ocr-key" type="password" placeholder={initial.apiKey ? "已保存（留空不变）" : "未设置"} value={apiKey} onChange={e => setApiKey(e.target.value)} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={supportsPdf} onChange={e => setSupportsPdf(e.target.checked)} />
        该网关支持直接识别扫描 PDF（整体送 PDF 字节）
      </label>
      <div className="mt-3">
        <Button size="sm" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存 OCR 设置"}</Button>
      </div>
    </div>
  );
}
