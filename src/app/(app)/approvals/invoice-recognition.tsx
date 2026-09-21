"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recognizeInvoiceFromImage, type RecognizedInvoice } from "@/server/ai/actions";
import { actionErrorMessage } from "@/lib/action-error";

/** 保留原财务处理页的发票识别能力，由用户选择是否识别。 */
export function InvoiceRecognition({ file, onNumber, requestedAmount }: { file: File | null; onNumber: (number: string) => void; requestedAmount?: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RecognizedInvoice | null>(null);
  const generation = useRef(0);
  useEffect(() => { const current = ++generation.current; setResult(null); setPending(false); return () => { generation.current = current + 1; }; }, [file]);
  async function recognize() {
    if (!file) return;
    const current = generation.current;
    setPending(true);
    try {
      const fd = new FormData(); fd.set("file", file);
      const response = await recognizeInvoiceFromImage(fd);
      if (generation.current !== current) return;
      if (!response.ok) { toast.error(response.message); return; }
      setResult(response.data);
      if (response.data.invoiceNumber) onNumber(response.data.invoiceNumber);
      toast.success("发票信息已识别，请核对后提交");
    } catch (e) { if (generation.current === current) toast.error(e instanceof Error ? actionErrorMessage(e) : "识别失败，请手动填写"); }
    finally { if (generation.current === current) setPending(false); }
  }
  const amount = result?.totalWithTax ?? result?.totalAmount;
  return <div className="space-y-2"><Button type="button" variant="outline" size="sm" disabled={!file || pending || file.size > 6 * 1024 * 1024} onClick={recognize}>{pending ? "正在识别…" : "识别发票信息"}</Button>
    <p className="text-xs text-muted-foreground">可使用已配置的智能识别服务读取所选发票（限 6MB），也可直接手填号码。</p>
    {result && <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm"><p>发票号码：{result.invoiceNumber || "未识别"}</p><p>购方：{result.buyerName || "未识别"}</p><p>销方：{result.sellerName || "未识别"}</p><p>金额：{amount ?? "未识别"}</p>{typeof amount === "number" && requestedAmount && Math.abs(amount - Number(requestedAmount)) > 0.01 && <p className="text-destructive">识别金额与申请金额不一致，请核对。</p>}</div>}
  </div>;
}
