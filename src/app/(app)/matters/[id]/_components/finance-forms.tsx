"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Paperclip, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { RadioChips } from "@/components/ui/radio-chips";
import {
  billingCreateSchema,
  feeEntryCreateSchema,
  type BillingCreateInput,
  type FeeEntryCreateInput
} from "@/server/finance/schemas";
import {
  getMatterFinance,
  createBilling,
  createFeeEntry,
  listMatterInvoiceRequests
} from "@/server/finance/actions";
import { uploadDocument } from "@/server/documents/actions";
import { recognizeInvoiceFromImage, type RecognizedInvoice } from "@/server/ai/actions";
import { shDayKey } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

// ============ AddBillingSheet ============

export function AddBillingSheet({
  open,
  onOpenChange,
  matterId
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
}) {
  const router=useRouter();
  useEffect(()=>{if(!open)return;let active=true;void getMatterFinance(matterId).then(fin=>{if(active&&fin.ledgerReady){onOpenChange(false);router.push(`/finance/reconciliation?matterId=${matterId}`);}}).catch(()=>{});return()=>{active=false;};},[open,matterId,onOpenChange,router]);
  const [isPending, startTransition] = useTransition();
  const [contractFile, setContractFile] = useState<File | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors }
  } = useForm<BillingCreateInput>({
    resolver: zodResolver(billingCreateSchema),
    defaultValues: {
      matterId,
      title: "",
      contractAmount: 0,
      schedule: "",
      status: "ACTIVE"
    }
  });
  const billingStatus = useWatch({ control, name: "status" });

  function onSubmit(values: BillingCreateInput) {
    startTransition(async () => {
      try {
        await createBilling(values);
        if (contractFile) {
          const fd = new FormData();
          fd.set("matterId", matterId);
          fd.set("name", contractFile.name);
          fd.set("category", "CONTRACT");
          fd.set("encrypted", "true");
          fd.set("tags", `合同,${values.title}`);
          fd.set("file", contractFile);
          await uploadDocument(fd);
          toast.success("合同已创建，附件已加密入库");
        } else {
          toast.success("合同已创建");
        }
        reset();
        setContractFile(null);
        onOpenChange(false);
      } catch (err) {
        toast.error("失败", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>新增合同</DialogTitle>
          <DialogDescription className="text-xs">
            一个案件可以有多份合同（如分阶段委托）。可同时上传合同扫描件，加密入库后归到本案材料库。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <Field label="合同名称" required error={errors.title?.message}>
              <Input
                placeholder="如：委托代理合同 - 一审阶段"
                {...register("title")}
              />
            </Field>

            <Field label="合同金额（元）" required error={errors.contractAmount?.message as string | undefined}>
              <Input
                type="number"
                step="0.01"
                className="font-mono tabular"
                {...register("contractAmount", { valueAsNumber: true })}
              />
            </Field>

            <Field label="状态">
              <RadioChips
                size="sm"
                items={[
                  { value: "DRAFT", label: "草稿" },
                  { value: "ACTIVE", label: "生效中" },
                  { value: "CLOSED", label: "已结清" }
                ]}
                value={billingStatus}
                onChange={(v) => setValue("status", v as BillingCreateInput["status"])}
              />
            </Field>

            <Field label="签订日期" error={errors.signedAt?.message}>
              {/* 留空时保持 undefined（草稿）；用字符串注册，空串会在 zod 校验报错并显示，避免 Invalid Date 静默失败 */}
              <Input type="date" {...register("signedAt")} />
            </Field>

            <Field label="阶段付款约定">
              <Textarea
                rows={3}
                placeholder="如：签约时收 30%，立案时收 30%，判决生效后收 40%"
                {...register("schedule")}
              />
            </Field>

            <Field label="合同附件（可选）">
              <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border px-3 py-3 text-[12px] text-muted-foreground hover:bg-muted/30">
                <Paperclip className="h-3.5 w-3.5" />
                {contractFile ? (
                  <span className="flex items-center gap-1 text-foreground">
                    <FileText className="h-3 w-3" />
                    {contractFile.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({(contractFile.size / 1024).toFixed(0)} KB)
                    </span>
                  </span>
                ) : (
                  "选择 PDF / docx 文件，提交时自动加密入库"
                )}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => setContractFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </Field>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ AddFeeEntrySheet ============

// 工厂而非内联字面量：occurredAt 须在每次打开/重置时取「现在」，常驻挂载的对话框跨天后仍会默认昨天
function feeEntryDefaults(matterId: string): FeeEntryCreateInput {
  return {
    matterId,
    billingId: "",
    type: "RECEIVED",
    amount: 0,
    // yyyy-MM-dd 字符串默认值：date input 才能正确回显，提交时由 zod coerce 成 Date（上海当日）
    occurredAt: shDayKey(new Date()) as unknown as Date,
    invoiceNo: "",
    payerOrPayee: "",
    method: "",
    note: ""
  };
}

export function AddFeeEntrySheet({
  open,
  onOpenChange,
  matterId,
  billings
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  billings: { id: string; title: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [invoiceRequests, setInvoiceRequests] = useState<
    Awaited<ReturnType<typeof listMatterInvoiceRequests>>
  >([]);

  useEffect(() => {
    if (!open) return;
    listMatterInvoiceRequests(matterId)
      .then(setInvoiceRequests)
      .catch(() => setInvoiceRequests([]));
  }, [open, matterId]);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors }
  } = useForm<FeeEntryCreateInput>({
    resolver: zodResolver(feeEntryCreateSchema),
    defaultValues: feeEntryDefaults(matterId)
  });

  // 打开（变为 true）时重置默认值：defaultValues 只在首次渲染求值，跨天打开默认「发生日期」会是昨天
  useEffect(() => {
    if (open) reset(feeEntryDefaults(matterId));
  }, [open, matterId, reset]);

  const type = useWatch({ control, name: "type" });
  const billingId = useWatch({ control, name: "billingId" });

  function onSubmit(values: FeeEntryCreateInput) {
    startTransition(async () => {
      try {
        await createFeeEntry(values);
        toast.success(
          values.type === "RECEIVED" ? "实收已录入" : "记录已创建"
        );
        reset();
        onOpenChange(false);
      } catch (err) {
        toast.error("失败", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[92vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>新增收付记录</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <Field label="类型" required>
              <RadioChips
                size="sm"
                items={[
                  { value: "RECEIVABLE", label: "应收" },
                  { value: "RECEIVED", label: "实收", accent: "#1A7F45" },
                  { value: "REFUND", label: "退款", accent: "#B42318" },
                  { value: "COST", label: "成本" }
                ]}
                value={type}
                onChange={(v) => setValue("type", v as FeeEntryCreateInput["type"])}
              />
            </Field>

            <Field label="金额（元）" required error={errors.amount?.message}>
              <Input
                type="number"
                step="0.01"
                className="font-mono tabular"
                {...register("amount", { valueAsNumber: true })}
              />
            </Field>

            <Field label="发生日期" required error={errors.occurredAt?.message}>
              <Input type="date" {...register("occurredAt")} />
            </Field>

            {billings.length > 0 && (
              <Field label="关联合同">
                <Select
                  value={billingId || "none"}
                  onValueChange={(v) =>
                    setValue("billingId", v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {billings.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {/* 字段联动：付款/收款方名称随类型；应收尚未发生资金往来，不填支付方式 */}
            <Field label={type === "REFUND" || type === "COST" ? "收款方" : "付款方"}>
              <Input placeholder={type === "COST" ? "如 法院 / 鉴定机构 / 快递公司" : "如 上海青石建设有限公司"} {...register("payerOrPayee")} />
            </Field>

            {type !== "RECEIVABLE" && (
              <Field label="方式">
                <Input placeholder="转账 / 现金 / 支付宝" {...register("method")} />
              </Field>
            )}

            {(type === "RECEIVED" || type === "RECEIVABLE") && invoiceRequests.length > 0 && (
              <Field
                label="关联申请发票"
                hint="选中后自动填金额；已开具的会填真实发票号，未开具的填占位 req:xxxxxxxx"
              >
                <Select
                  value="none"
                  onValueChange={(v) => {
                    if (v === "none") return;
                    const req = invoiceRequests.find((r) => r.id === v);
                    if (!req) return;
                    setValue("amount", Number(req.amount), { shouldDirty: true });
                    // 优先用真实发票号（财务已 ISSUED 时回填），否则用占位
                    const invoiceNoValue = req.invoiceNo ?? `req:${req.id.slice(0, 8)}`;
                    setValue("invoiceNo", invoiceNoValue, { shouldDirty: true });
                    const existing = getValues("note") ?? "";
                    const noteText = req.invoiceNo
                      ? `关联申请发票 #${req.id.slice(0, 8)}${req.title ? "（" + req.title + "）" : ""}`
                      : `关联申请发票（未开具）#${req.id.slice(0, 8)}${req.title ? "（" + req.title + "）" : ""}`;
                    setValue("note", existing ? `${existing}\n${noteText}` : noteText, {
                      shouldDirty: true
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="从已申请发票中选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {invoiceRequests.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        ¥{Number(r.amount).toLocaleString()} ·{" "}
                        {r.title ?? "未命名"} ·{" "}
                        {r.invoiceNo ? `已开具 ${r.invoiceNo}` : r.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {type !== "RECEIVABLE" && (
            <Field label="发票号">
              <Input className="font-mono" {...register("invoiceNo")} />
            </Field>
            )}

            {type !== "RECEIVABLE" && (
            <InvoiceOcrBlock
              onRecognized={(data) => {
                if (data.invoiceNumber)
                  setValue("invoiceNo", data.invoiceNumber, { shouldDirty: true });
                if (data.totalWithTax || data.totalAmount) {
                  setValue("amount", Number(data.totalWithTax ?? data.totalAmount), {
                    shouldDirty: true
                  });
                }
                if (data.sellerName)
                  setValue("payerOrPayee", data.sellerName, { shouldDirty: true });
                if (data.invoiceDate) {
                  const d = new Date(data.invoiceDate);
                  // 回填也用 yyyy-MM-dd 字符串：Date 对象不会被 date input 回显，用户将无法核对
                  if (!isNaN(d.getTime()))
                    setValue("occurredAt", shDayKey(d) as unknown as Date, { shouldDirty: true });
                }
              }}
            />
            )}

            <Field label="备注">
              <Textarea rows={2} {...register("note")} />
            </Field>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {type === "RECEIVED" ? "记录实收" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Invoice OCR ============

function InvoiceOcrBlock({
  onRecognized
}: {
  onRecognized: (data: RecognizedInvoice) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecognizedInvoice | null>(null);

  const recognize = async () => {
    if (!file) {
      toast.warning("请先选择发票图片");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await recognizeInvoiceFromImage(fd);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPreview(res.data);
      onRecognized(res.data);
      toast.success("已识别并自动填入");
    } catch (e) {
      toast.error(e instanceof Error ? actionErrorMessage(e) : "识别失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-border bg-muted/20 p-3">
      <Label className="flex items-center gap-1.5 text-xs">
        <Sparkles className="h-3 w-3 text-primary" />
        AI 发票识别（可选）
      </Label>
      <p className="text-[11px] text-muted-foreground">
        上传增值税发票（JPG / PNG / PDF），识别后自动填发票号 / 金额 / 销售方 / 开票日
      </p>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/30">
          <Paperclip className="h-3 w-3" />
          {file ? (
            <span className="flex items-center gap-1 text-foreground">
              <FileText className="h-3 w-3" />
              {file.name}
            </span>
          ) : (
            "选择发票（JPG / PNG / PDF）"
          )}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={recognize}
          disabled={!file || busy}
          className="h-8 gap-1 text-[11px]"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          识别
        </Button>
      </div>
      {preview && (
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-border bg-background p-2 text-[10.5px] text-muted-foreground">
          {preview.invoiceType && <div>类型：{preview.invoiceType}</div>}
          {preview.invoiceNumber && (
            <div>
              发票号：<span className="font-mono text-foreground/85">{preview.invoiceNumber}</span>
            </div>
          )}
          {preview.invoiceDate && <div>开票日：{preview.invoiceDate}</div>}
          {preview.sellerName && <div>销售方：{preview.sellerName}</div>}
          {preview.buyerName && <div>购买方：{preview.buyerName}</div>}
          {preview.totalWithTax != null && (
            <div>
              价税合计：
              <span className="font-mono text-foreground/85">¥{preview.totalWithTax}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Shared Field ============

function Field({
  label,
  required,
  error,
  hint,
  children
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
