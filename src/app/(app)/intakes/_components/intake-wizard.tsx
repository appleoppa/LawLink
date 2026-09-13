"use client";

/**
 * 新建收案向导（墨案 05 效果图 · 从零重写）。
 * 布局 = 效果图：右侧抽屉 / 四步条 + 进度 / 宣纸画布 + 白卡分区 / chip 选择行 /
 * 当事人实体卡 / 底部固定操作栏。契约不变：intakeCreateSchema → createIntake。
 */
import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, ChevronRight, Loader2, Plus, Sparkles, ShieldAlert } from "lucide-react";

import { intakeCreateSchema } from "@/server/intakes/schemas";
import { createIntake } from "@/server/intakes/actions";
import { checkClientDuplicate } from "@/server/clients/dedup";
import { CauseCombobox } from "@/app/(app)/matters/_components/cause-combobox";
import { ClientCombobox } from "./client-combobox";
import {
  matterCategoryLabel,
  procedureTypeLabel,
  litigationStandingLabel
} from "@/lib/enums";
import { proceduresByCategory } from "@/lib/procedures-by-category";
import { matterCategoryKind, type CategoryKind } from "@/lib/enums";
import type { MatterCategory, ProcedureType, LitigationStanding } from "@prisma/client";
import { cn } from "@/lib/utils";

type FormValues = {
  title: string;
  category: MatterCategory;
  causeId: string;
  causeFreeText: string;
  receivedAt: string;
  firstProcedureType?: ProcedureType;
  firstAgency: string;
  jurisdiction: string;
  ourStanding?: LitigationStanding;
  claimAmount: string;
  clientId: string;
  clientName: string;
  clientType: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION" | undefined;
  clientIdNumber: string;
  contactName: string;
  contactPhone: string;
  parties: { role: string; name: string; idNumber: string; standing?: LitigationStanding; ordinal: number }[];
  feeType: "FIXED" | "CONTINGENCY" | "TIMED" | undefined;
  feeAmount: string;
  contingencyTerms: string;
  feeSchedule: string;
  feeNote: string;
  ownerUserId: string;
  coUserIds: string[];
  description: string;
};

const CATEGORIES: MatterCategory[] = [
  "CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION",
  "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"
];

const WIZ_STEPS = ["收案信息", "当事人与冲突", "收费与承办", "确认提交"] as const;

const STEP_FIELDS: string[][] = [
  ["title", "category", "firstProcedureType", "ourStanding", "jurisdiction", "firstAgency", "claimAmount", "receivedAt"],
  ["clientId", "clientName", "parties", "contactName", "contactPhone"],
  ["feeType", "feeAmount", "contingencyTerms", "ownerUserId"]
];

const FEE_TYPES = [
  { value: "FIXED", label: "固定收费" },
  { value: "CONTINGENCY", label: "风险代理" },
  { value: "TIMED", label: "计时收费" }
] as const;

const PARTY_ROLES = [
  { value: "OPPOSING_PARTY", label: "相对方" },
  { value: "THIRD_PARTY", label: "第三人" }
] as const;

export function IntakeWizard({
  open,
  onOpenChange,
  clientOptions,
  colleagues,
  onSubmitted
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 提交成功回调（审批创建入口用于直接跳转审批详情） */
  onSubmitted?: (intakeId: string) => void;
  clientOptions: { id: string; name: string; type: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION" }[];
  colleagues: { id: string; name: string; role?: string; isTeammate?: boolean }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dup, setDup] = useState<{ idNumberDuplicate: { id: string; name: string } | null; nameDuplicates: { id: string; name: string }[] } | null>(null);

  const methods = useForm<FormValues>({
    resolver: zodResolver(intakeCreateSchema as never) as never,
    defaultValues: {
      title: "",
      category: "CIVIL_COMMERCIAL",
      causeId: "",
      causeFreeText: "",
      receivedAt: new Date().toISOString().slice(0, 10),
      firstAgency: "",
      jurisdiction: "",
      claimAmount: "",
      clientId: "",
      clientName: "",
      clientType: undefined,
      clientIdNumber: "",
      contactName: "",
      contactPhone: "",
      parties: [{ role: "OPPOSING_PARTY", name: "", idNumber: "", standing: undefined, ordinal: 1 }],
      feeType: undefined,
      feeAmount: "",
      contingencyTerms: "",
      feeSchedule: "",
      feeNote: "",
      ownerUserId: "",
      coUserIds: [],
      description: ""
    }
  });
  const { register, watch, setValue, handleSubmit, trigger, formState: { errors } } = methods;
  const partiesArray = useFieldArray({ control: methods.control, name: "parties" });

  const category = watch("category");
  const kind: CategoryKind = matterCategoryKind(category);
  const isLitigation = kind === "litigation";
  const procedureOptions = useMemo(() => proceduresByCategory[category] ?? [], [category]);
  const firstProcedureType = watch("firstProcedureType");
  const clientName = watch("clientName");
  const clientId = watch("clientId");
  const clientIdNumber = watch("clientIdNumber");
  const clientType = watch("clientType");
  const feeType = watch("feeType");
  const ownerUserId = watch("ownerUserId");
  const coUserIds = watch("coUserIds");

  // 切类别：清程序与地位（沿用旧表单联动规则）
  useEffect(() => {
    if (firstProcedureType && !procedureOptions.includes(firstProcedureType)) {
      setValue("firstProcedureType", undefined);
      setValue("ourStanding", undefined);
    }
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  // 查重（P0-1）：新建客户时 名称+证件号 防抖查重
  useEffect(() => {
    if (!open || clientId || (!clientName && !clientIdNumber)) { setDup(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await checkClientDuplicate({
          idType: clientType === "INDIVIDUAL" ? "ID_CARD" : "USCC",
          idNumber: clientIdNumber || undefined,
          name: clientName || undefined
        });
        setDup(res ?? null);
      } catch { setDup(null); }
    }, 600);
    return () => clearTimeout(t);
  }, [clientName, clientIdNumber, clientId, clientType, open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onOpenChange(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, submitting, onOpenChange]);

  async function next() {
    const ok = await trigger(STEP_FIELDS[step] as never, { shouldFocus: true });
    if (ok) setStep(s => Math.min(s + 1, WIZ_STEPS.length - 1));
    else toast.warning("本步还有必填项未完成，请按提示补全");
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        receivedAt: values.receivedAt ? new Date(values.receivedAt) : undefined,
        claimAmount: values.claimAmount === "" ? undefined : Number(values.claimAmount),
        feeAmount: values.feeAmount === "" ? undefined : Number(values.feeAmount)
      } as never;
      const res = await createIntake(payload);
      toast.success("收案已提交审批");
      onOpenChange(false);
      setStep(0);
      if (onSubmitted && res?.id) { onSubmitted(res.id); router.refresh(); return; }
      router.push("/matters?tab=intake");
      router.refresh();
    } catch (err) {
      toast.error("提交失败", { description: err instanceof Error ? err.message : "" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const err = (k: string) => (errors as Record<string, { message?: string } | undefined>)[k]?.message;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(12,25,39,0.44)] backdrop-blur-[2px]" onClick={() => !submitting && onOpenChange(false)} />
      {/* 墨案 05：右侧抽屉 */}
      <aside className="absolute inset-y-0 right-0 flex w-[min(820px,94vw)] flex-col bg-card shadow-[0_24px_64px_-12px_rgba(12,25,39,0.24)]">
        {/* 头部：标题 + AI 徽章 + 关闭 */}
        <div className="flex items-center gap-3 border-b border-border px-6 pt-4">
          <h2 className="text-[17px] font-bold tracking-tight">新建收案</h2>
          <span className="badge b-violet"><Sparkles className="h-3 w-3" />AI 辅助录入已开启</span>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="关闭" className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {/* 步骤条 + 进度 */}
        <div className="border-b border-border px-6 pb-3 pt-2">
          <div className="flex items-center">
            {WIZ_STEPS.map((label, i) => (
              <div key={label} className="flex items-center">
                {i > 0 && <div className={cn("mx-2 h-px w-8", i <= step ? "bg-primary" : "bg-border")} />}
                <button type="button" onClick={() => i <= step && setStep(i)} className={cn("flex items-center gap-1.5 text-[12px]", i === step ? "font-semibold text-[#005054]" : "text-muted-foreground/70")}>
                  <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px]", i === step ? "bg-primary text-primary-foreground shadow-[0_0_0_3px_rgba(0,123,127,0.15)]" : i < step ? "bg-[#E4F1F0] text-[#005054]" : "bg-muted text-muted-foreground")}>{i < step ? "✓" : i + 1}</span>
                  {label}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>
        </div>

        {/* 主体：宣纸画布 + 白卡分区 */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto bg-[#F2F4F3] px-5 py-4">
            {/* ───── 第 1 步：收案信息 ───── */}
            {step === 0 && (
              <>
                <Card title="基本信息" required>
                  <F label="案件名称" required error={err("title")}>
                    <input {...register("title")} placeholder="如：青石建设与华东置业建设工程施工合同纠纷" className={inputCls} />
                  </F>
                  <F label="案件类别" required>
                    <Chips options={CATEGORIES.map(c => ({ value: c, label: matterCategoryLabel[c] }))} value={category} onChange={c => setValue("category", c, { shouldDirty: true })} />
                  </F>
                  {isLitigation && (
                    <>
                      <F label="代理程序" required error={err("firstProcedureType")}>
                        <Chips options={procedureOptions.map(p => ({ value: p, label: procedureTypeLabel[p] }))} value={firstProcedureType} onChange={p => setValue("firstProcedureType", p, { shouldDirty: true })} />
                      </F>
                      <F label="我方诉讼地位" required error={err("ourStanding")}>
                        <Chips
                          options={(firstProcedureType
                            ? (["PLAINTIFF", "DEFENDANT", "THIRD_PARTY"] as LitigationStanding[])
                            : (Object.keys(litigationStandingLabel) as LitigationStanding[])).map(s => ({ value: s, label: litigationStandingLabel[s] }))}
                          value={watch("ourStanding")}
                          onChange={s => setValue("ourStanding", s, { shouldDirty: true })}
                        />
                      </F>
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <F label="案由" hint={isLitigation && !firstProcedureType ? "请先选择代理程序" : undefined}>
                      <CauseCombobox
                        category={category}
                        procedureType={firstProcedureType}
                        value={watch("causeId") || ""}
                        disabled={isLitigation && !firstProcedureType}
                        onChange={(id, name) => { setValue("causeId", id || "", { shouldDirty: true }); setValue("causeFreeText", name || "", { shouldDirty: true }); }}
                      />
                    </F>
                    <F label="收案日期" required error={err("receivedAt")}>
                      <input type="date" {...register("receivedAt")} className={cn(inputCls, "font-mono")} />
                    </F>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <F label="管辖地区"><input {...register("jurisdiction")} placeholder="如：上海市长宁区" className={inputCls} /></F>
                    <F label="争议解决机构"><input {...register("firstAgency")} placeholder="法院 / 仲裁机构" className={inputCls} /></F>
                  </div>
                  <F label="标的额（元）" error={err("claimAmount")}><input {...register("claimAmount")} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "font-mono")} /></F>
                </Card>
              </>
            )}

            {/* ───── 第 2 步：当事人与冲突 ───── */}
            {step === 1 && (
              <>
                <Card title="委托方" required>
                  {dup && (dup.idNumberDuplicate || dup.nameDuplicates.length > 0) && (
                    <div className="mb-3 rounded-[10px] border border-[#EBD8AB] bg-[#FAF0DB] px-3.5 py-3">
                      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#7A5205]"><ShieldAlert className="h-3.5 w-3.5" />查重命中：已存在相同或疑似主体</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-[#8A6420]">身份持续唯一：请关联既有档案；确为不同主体时继续新建，稍后可在客户档案中合并。</p>
                      <ul className="mt-2 space-y-1">
                        {dup.idNumberDuplicate && <li key="exact" className="text-[11.5px] font-medium text-[#8A6420]">· {dup.idNumberDuplicate.name}（证件号一致）</li>}
                        {dup.nameDuplicates.filter(d => d.id !== dup.idNumberDuplicate?.id).map(d => <li key={d.id} className="text-[11.5px] text-[#8A6420]">· {d.name}（同名疑似）</li>)}
                      </ul>
                    </div>
                  )}
                  <ClientCombobox
                    clientId={clientId}
                    clientName={clientName}
                    clientType={clientType ?? ""}
                    options={clientOptions}
                    onPickExisting={(id: string, name: string) => { setValue("clientId", id, { shouldDirty: true }); setValue("clientName", name, { shouldDirty: true }); }}
                    onTypeNew={(name: string) => { setValue("clientId", "", { shouldDirty: true }); setValue("clientName", name, { shouldDirty: true }); setValue("clientType", undefined, { shouldDirty: true }); }}
                    onPickYuandian={(c: { name: string; idNumber?: string; address?: string; legalRep?: string }) => { setValue("clientId", "", { shouldDirty: true }); setValue("clientName", c.name, { shouldDirty: true }); setValue("clientType", "COMPANY", { shouldDirty: true }); if (c.idNumber) setValue("clientIdNumber", c.idNumber, { shouldDirty: true }); }}
                    onClear={() => { setValue("clientId", "", { shouldDirty: true }); setValue("clientName", "", { shouldDirty: true }); }}
                  />
                  {!clientId && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <F label="联系人"><input {...register("contactName")} className={inputCls} /></F>
                      <F label="联系电话"><input {...register("contactPhone")} className={inputCls} /></F>
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-muted-foreground">冲突预检将随主体信息自动发起；命中阻塞未出结论前不能提交审批。</p>
                </Card>

                <Card title={isLitigation ? "相对方 / 第三人" : "相关方"} required={isLitigation}>
                  <div className="space-y-2.5">
                    {partiesArray.fields.map((f, i) => (
                      <div key={f.id} className="rounded-xl border border-[#E8ECEA] bg-card px-4 py-3">
                        <div className="mb-2.5 flex items-center gap-2.5">
                          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[#10233A] text-[13px] font-bold text-white">{(watch(`parties.${i}.name`) || "？").charAt(0)}</span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{watch(`parties.${i}.name`) || "待填写主体"}</span>
                          <span className="badge b-white">{PARTY_ROLES.find(r => r.value === watch(`parties.${i}.role`))?.label}</span>
                          {partiesArray.fields.length > 1 && (
                            <button type="button" onClick={() => partiesArray.remove(i)} className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label="移除"><X className="h-3.5 w-3.5" /></button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                          <F label="角色">
                            <select value={watch(`parties.${i}.role`)} onChange={e => setValue(`parties.${i}.role`, e.target.value, { shouldDirty: true })} className={inputCls}>
                              {PARTY_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          </F>
                          <F label="名称" required>
                            <input {...register(`parties.${i}.name`)} placeholder="当事人 / 机构名称" className={inputCls} />
                          </F>
                          <F label="证件号（选填）">
                            <input {...register(`parties.${i}.idNumber`)} className={cn(inputCls, "font-mono")} />
                          </F>
                        </div>
                        {isLitigation && (
                          <div className="mt-2.5">
                            <F label="诉讼地位" required error={(() => { const arr = errors.parties as unknown as ({ standing?: { message?: string } })[] | undefined; return arr?.[i]?.standing?.message; })()}>
                              <Chips
                                options={(["DEFENDANT", "PLAINTIFF", "THIRD_PARTY", "JOINT_DEFENDANT", "JOINT_PLAINTIFF"] as LitigationStanding[]).map(s => ({ value: s, label: litigationStandingLabel[s] }))}
                                value={watch(`parties.${i}.standing`)}
                                onChange={s => setValue(`parties.${i}.standing`, s, { shouldDirty: true, shouldValidate: true })}
                              />
                            </F>
                          </div>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => partiesArray.append({ role: "THIRD_PARTY", name: "", idNumber: "", standing: undefined, ordinal: partiesArray.fields.length + 1 })} className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#CFD7D3] text-[12.5px] text-muted-foreground hover:border-input hover:bg-muted/50">
                      <Plus className="h-3.5 w-3.5" />添加当事人
                    </button>
                  </div>
                </Card>
              </>
            )}

            {/* ───── 第 3 步：收费与承办 ───── */}
            {step === 2 && (
              <Card title="收费与承办" required>
                <F label="收费方式" required error={err("feeType")}>
                  <Chips options={FEE_TYPES.map(f => ({ value: f.value, label: f.label }))} value={feeType} onChange={v => setValue("feeType", v, { shouldDirty: true })} />
                </F>
                <div className="grid grid-cols-2 gap-3">
                  <F label={feeType === "CONTINGENCY" ? "基础办案费（元）" : "律师费（元）"} error={err("feeAmount")}>
                    <input {...register("feeAmount")} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "font-mono")} />
                  </F>
                  <F label="付款安排"><input {...register("feeSchedule")} placeholder="如：签约 40% / 开庭前 30% / 判决 30%" className={inputCls} /></F>
                </div>
                {feeType === "CONTINGENCY" && (
                  <F label="风险收费方式说明" required><textarea {...register("contingencyTerms")} rows={2} placeholder="基础费 + 风险比例…" className={cn(inputCls, "h-auto py-2")} /></F>
                )}
                <F label="备注"><textarea {...register("feeNote")} rows={2} className={cn(inputCls, "h-auto py-2")} /></F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="主办律师" required error={err("ownerUserId")}>
                    <select value={ownerUserId} onChange={e => setValue("ownerUserId", e.target.value, { shouldDirty: true })} className={inputCls}>
                      <option value="">选择主办律师</option>
                      {colleagues.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </F>
                  <F label="协办人员">
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {colleagues.filter(u => u.id !== ownerUserId).map(u => {
                        const on = coUserIds.includes(u.id);
                        return (
                          <button type="button" key={u.id} aria-pressed={on} onClick={() => setValue("coUserIds", on ? coUserIds.filter(x => x !== u.id) : [...coUserIds, u.id], { shouldDirty: true })}
                            className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors", on ? "border-[#B7D8D6] bg-[#E4F1F0] font-semibold text-[#005054]" : "border-[#CFD7D3] bg-card text-muted-foreground hover:border-input hover:bg-muted")}>
                            {on && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{u.name}
                          </button>
                        );
                      })}
                    </div>
                  </F>
                </div>
              </Card>
            )}

            {/* ───── 第 4 步：确认提交 ───── */}
            {step === 3 && (
              <>
                <Card title="补充说明">
                  <F label="备注 / 案情摘要"><textarea {...register("description")} rows={4} placeholder="客户来源、核心诉求、注意事项…" className={cn(inputCls, "h-auto py-2")} /></F>
                </Card>
                <Card title="确认信息">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
                    {[["案件名称", watch("title") || "—"], ["类别", matterCategoryLabel[category]], ["代理程序", firstProcedureType ? procedureTypeLabel[firstProcedureType] : "—"], ["委托方", clientName || "—"], ["主办律师", colleagues.find(u => u.id === ownerUserId)?.name ?? "—"], ["收费", feeType ? `${FEE_TYPES.find(f => f.value === feeType)?.label} ¥${watch("feeAmount") || 0}` : "—"]].map(([k, v]) => (
                      <div key={k as string} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="mt-0.5 truncate font-medium">{v}</dd></div>
                    ))}
                  </dl>
                  <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">提交后进入审批流；冲突检索自动携带以上主体信息发起，命中阻塞需人工结论后方可转正式案件。</p>
                </Card>
              </>
            )}
          </div>

          {/* 底部操作栏（固定） */}
          <div className="flex items-center gap-2.5 border-t border-border bg-card px-6 py-3.5">
            <div className="mr-auto text-[11.5px] text-muted-foreground">第 {step + 1} / 4 步 · {WIZ_STEPS[step]}</div>
            <button type="button" onClick={() => onOpenChange(false)} disabled={submitting} className="btn btn-ghost btn-sm">取消</button>
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} disabled={submitting} className="btn btn-secondary btn-sm">上一步</button>}
            {step < 3 ? (
              <button type="button" onClick={next} disabled={submitting} className="btn btn-primary btn-sm">下一步 · {WIZ_STEPS[step + 1]}<ChevronRight className="h-3.5 w-3.5" /></button>
            ) : (
              <button type="submit" disabled={submitting} className="btn btn-primary btn-sm">{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}提交审批</button>
            )}
          </div>
        </form>
      </aside>
    </div>
  );
}

/* ── 效果图 05 原子件 ── */

const inputCls = "h-[36px] w-full rounded-lg border border-[#CFD7D3] bg-card px-3 text-[13px] text-foreground shadow-[inset_0_1px_2px_rgba(12,25,39,0.05)] outline-none transition-colors placeholder:text-[#98A3AD] focus:border-[#007B7F] focus:shadow-[0_0_0_3px_rgba(0,123,127,0.12)]";

function Card({ title, required, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-card shadow-[0_1px_2px_rgba(12,25,39,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]">
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
        <span className="h-3.5 w-[3px] rounded-full bg-primary" />
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{title}{required && <span className="ml-1 text-destructive">*</span>}</h3>
      </div>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </section>
  );
}

function F({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-foreground/75">{label}{required && <span className="ml-0.5 text-destructive">*</span>}</label>
      {children}
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value?: string; onChange: (v: never) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on}
            onClick={() => onChange(o.value as never)}
            className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors", on ? "border-[#B7D8D6] bg-[#E4F1F0] font-semibold text-[#005054]" : "border-[#CFD7D3] bg-card text-muted-foreground hover:border-input hover:bg-muted")}>
            {on && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}{o.label}
          </button>
        );
      })}
    </div>
  );
}
