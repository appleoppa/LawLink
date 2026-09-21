"use client";

/**
 * 新建收案（墨案 05 效果图：右侧抽屉 + 四步连续表单）。
 *
 * 业务逻辑完整沿用原收案登记表单（v0.30–v1.x）：
 * 类别决定表单结构（诉讼仲裁 / 非诉专项 / 顾问）、程序→诉讼地位与机构联动、
 * 标题自动生成、委托方建档查重（身份持续唯一）、元典企业回填、起诉状 OCR 识别对方主体、
 * AI 案由推荐、委托合同加密上传。提交后自动携带全部主体发起冲突检索（与收案详情同一入口）。
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm, useFieldArray, FormProvider, useWatch, type FieldErrors, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Loader2, Paperclip, Plus, ScanLine, Sparkles, X } from "lucide-react";
import type { MatterCategory, ProcedureType, LitigationStanding, FeeType, PartyRole, BarFilingType, ClientType } from "@prisma/client";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColleaguePicker } from "@/components/matters/colleague-picker";
import {
  matterCategoryLabel,
  procedureTypeLabel,
  litigationStandingLabel,
  feeTypeLabel,
  procedureToStandingOptions,
  barFilingLabel,
  BAR_FILING_OPTIONS,
  matterCategoryKind,
  PROJECT_BUSINESS_TYPES,
  COUNSEL_TYPES,
  type CategoryKind
} from "@/lib/enums";
import { agencyOptionsForProcedure, isAgencyAllowedForProcedure, isNationalAgency } from "@/lib/china-regions";
import { proceduresByCategory, suggestHandlingAgency } from "@/lib/procedures-by-category";
import { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";
import { intakeCreateSchema, type IntakeCreateInput } from "@/server/intakes/schemas";
import { saveIntakeRevision } from "@/server/intakes/revision-actions";
import { createIntake, resubmitIntake } from "@/server/intakes/actions";
import { uploadDocument } from "@/server/documents/actions";
import { parsePleading } from "@/server/ai/parse-pleading";
import { recommendCause, type CauseRecommendation } from "@/server/ai/recommend-cause";
import { getEnterpriseDetail, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";
import { runCheckAndSave } from "@/server/conflicts/actions";
import { checkClientDuplicate } from "@/server/clients/dedup";
import { PartyCard } from "@/app/(app)/matters/_components/party-card";
import { CauseCombobox } from "@/app/(app)/matters/_components/cause-combobox";
import { CauseAiManualDialog } from "@/app/(app)/matters/_components/cause-ai-manual-dialog";
import { readFormPath } from "@/lib/form-path";
import { cn } from "@/lib/utils";
import { ClientCombobox } from "./client-combobox";
import { CauseRecommendationDialog } from "./cause-recommendation-dialog";
import { JurisdictionSelect } from "./jurisdiction-select";
import type { TeamColleague } from "@/lib/teams/colleagues";
import { ChoiceField } from "@/components/patterns/choice-field";
import { shDayKey } from "@/lib/ui/sh-time";

const CATEGORIES: MatterCategory[] = ["CIVIL_COMMERCIAL", "LABOR_ARBITRATION", "COMMERCIAL_ARBITRATION", "CRIMINAL", "ADMINISTRATIVE", "NON_LITIGATION", "LEGAL_COUNSEL", "SPECIAL_PROJECT"];
const FEE_TYPES: FeeType[] = ["FIXED", "CONTINGENCY", "TIMED"];
const STEPS = ["收案信息", "当事人与冲突", "收费与团队", "确认提交"] as const;

// 我方为被动方时，可上传起诉状/申请书 OCR 识别对方
const RECEIVING_STANDINGS = new Set<LitigationStanding>([
  "DEFENDANT", "JOINT_DEFENDANT", "THIRD_PARTY", "COUNTERCLAIM_DEFENDANT", "APPELLEE", "RETRIAL_RESPONDENT",
  "EXECUTED_PERSON", "ARBITRATION_RESPONDENT", "ADMIN_DEFENDANT", "ADMIN_RECONSIDERATION_RESPONDENT", "CRIMINAL_DEFENDANT"
]);

const emptyParty = (role: PartyRole, ordinal: number): IntakeCreateInput["parties"][number] => ({
  role,
  standing: undefined,
  ordinal,
  partyType: "NATURAL_PERSON",
  name: "",
  idType: "ID_CARD",
  idNumber: "",
  enterpriseSocialCode: "",
  enterpriseName: "",
  phone: "",
  address: "",
  legalRep: "",
  contactName: "",
  notes: ""
});

// 工厂而非模块级常量：receivedAt 须在每次打开/重置时取「现在」，常驻挂载的向导跨天后仍会默认昨天
function freshDefaults(): IntakeCreateInput {
  return {
  title: "",
  category: "CIVIL_COMMERCIAL",
  causeId: "",
  causeFreeText: "",
  description: "",
  receivedAt: new Date(),
  firstProcedureType: undefined,
  firstAgency: "",
  jurisdiction: "",
  ourStanding: undefined,
  claimAmount: undefined,
  claimDescription: "",
  barFiling: undefined,
  counterclaim: false,
  clientId: "",
  clientName: "",
  clientType: "INDIVIDUAL",
  contactName: "",
  contactPhone: "",
  feeType: undefined,
  feeAmount: undefined,
  contingencyTerms: "",
  feeSchedule: "",
  feeNote: "",
  ownerUserId: "",
  coUserIds: [],
  parties: [emptyParty("CLIENT_PARTY", 1), emptyParty("OPPOSING_PARTY", 1)]
  };
}

export type ClientOption = { id: string; name: string; type: ClientType };
type Colleague = { id: string; name: string; role?: string; isTeammate?: boolean; active?: boolean };

function firstFormErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("message" in value && typeof (value as { message?: unknown }).message === "string") return (value as { message: string }).message;
  for (const child of Object.values(value)) {
    const message = firstFormErrorMessage(child);
    if (message) return message;
  }
  return undefined;
}

// 日期输入框取值一律按上海日历日：toISOString 走 UTC，上海 0-8 点会落成前一天
// Invalid Date 防御：清空日期等场景下 shDayKey 会让 Intl 抛 RangeError，这里兜底回空串
const dateInput = (v: unknown) => {
  if (!v) return "";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "" : shDayKey(d);
};

export function IntakeWizard({
  open,
  onOpenChange,
  clientOptions,
  colleagues,
  onSubmitted,
  initialClientId,
  editing
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientOptions: ClientOption[];
  colleagues: Colleague[];
  /** 提交成功回调（审批创建入口用于直接跳转审批详情） */
  onSubmitted?: (intakeId: string) => void;
  /** 从客户档案「为此客户新建收案」进入时预关联的客户 */
  initialClientId?: string;
  editing?: {id:string;revision:number;values:Partial<IntakeCreateInput>};
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [contracts, setContracts] = useState<File[]>([]);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [dupResult, setDupResult] = useState<Awaited<ReturnType<typeof checkClientDuplicate>> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pleadingRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ocrPending, setOcrPending] = useState(false);
  const [aiRecOpen, setAiRecOpen] = useState(false);
  const [aiRecLoading, setAiRecLoading] = useState(false);
  const [aiRecCandidates, setAiRecCandidates] = useState<CauseRecommendation[]>([]);
  const [aiRecError, setAiRecError] = useState<string | null>(null);
  const [aiRecSituation, setAiRecSituation] = useState<{ category: MatterCategory; text: string } | null>(null);
  const [aiManualOpen, setAiManualOpen] = useState(false);

  const methods = useForm<IntakeCreateInput>({
    resolver: zodResolver(intakeCreateSchema),
    defaultValues: { ...freshDefaults(), ownerUserId: session?.user?.id ?? "", ...editing?.values }
  });
  const { register, control, handleSubmit, getValues, setValue, reset, trigger, formState: { errors } } = methods;
  const { fields: parties, append: appendParty, remove: removeParty } = useFieldArray({ control, name: "parties" });

  const watchedValues = useWatch({ control });
  const watch = <T = any,>(path: string) => readFormPath<T>(watchedValues, path);

  const category = watch<MatterCategory>("category") ?? "CIVIL_COMMERCIAL";
  const firstProcedureType = watch<ProcedureType | undefined>("firstProcedureType");
  const clientId = watch("clientId") ?? "";
  const party0Name = watch("parties.0.name") ?? "";
  const party0IdNumber = watch("parties.0.partyType") !== "NATURAL_PERSON" ? (watch("parties.0.enterpriseSocialCode") ?? "") : (watch("parties.0.idNumber") ?? "");
  const feeType = watch<FeeType | undefined>("feeType");
  const ownerUserId = watch("ownerUserId");
  const coUserIds = watch<string[]>("coUserIds") ?? [];
  const receivedAt = watch("receivedAt");
  const jurisdiction = watch("jurisdiction") ?? "";
  const ourStanding = watch<LitigationStanding | undefined>("ourStanding");
  const agencyOpts = useMemo(() => agencyOptionsForProcedure(jurisdiction, firstProcedureType), [jurisdiction, firstProcedureType]);
  const kind: CategoryKind = matterCategoryKind(category);
  const nameLabel = kind === "counsel" ? "顾问事项名称" : kind === "project" ? "项目名称" : "案件名称";

  // 打开（非编辑）即重置：向导常驻挂载，defaultValues 只在首次渲染求值，跨天打开须取「现在」
  useEffect(() => {
    if (!open || editing) return;
    reset({ ...freshDefaults(), ownerUserId: session?.user?.id ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 客户档案入口：打开时预关联该客户（仅在尚未选择委托方时带入）
  useEffect(() => {
    if (!open || !initialClientId || getValues("clientId")) return;
    const c = clientOptions.find((o) => o.id === initialClientId);
    if (!c) return;
    setValue("clientId", c.id, { shouldDirty: true });
    setValue("parties.0.name", c.name, { shouldDirty: true, shouldValidate: true });
    if (c.type !== "INDIVIDUAL") setValue("parties.0.partyType", c.type === "COMPANY" ? "COMPANY" : "ORGANIZATION", { shouldDirty: true });
  }, [open, initialClientId, clientOptions, getValues, setValue]);

  // 委托方建档查重（P0-1）：按名称 + 证件号防抖，证件精确命中可一键关联
  useEffect(() => {
    if (clientId || dupDismissed) {
      setDupResult(null);
      return;
    }
    const name = party0Name.trim();
    const idNumber = party0IdNumber.trim();
    if (!name && !idNumber) {
      setDupResult(null);
      return;
    }
    // cancelled 守卫：慢响应晚于清理返回时不得回写——否则已关联客户/重新打开后查重横幅会再次弹出
    let cancelled = false;
    const timer = setTimeout(() => {
      // 回调内用 getValues 现取：watch 读到的是渲染快照，防抖窗口内的最新输入（如证件类型切换）会被旧值吞掉
      const partyType = getValues("parties.0.partyType");
      const latestName = (getValues("parties.0.name") ?? "").trim();
      const latestIdNumber = (
        (partyType !== "NATURAL_PERSON" ? getValues("parties.0.enterpriseSocialCode") : getValues("parties.0.idNumber")) ?? ""
      ).trim();
      if (!latestName && !latestIdNumber) {
        if (!cancelled) setDupResult(null);
        return;
      }
      const idType = partyType !== "NATURAL_PERSON" ? "USCC" : getValues("parties.0.idType") || "ID_CARD";
      checkClientDuplicate({ idType: latestIdNumber ? idType : null, idNumber: latestIdNumber || null, name: latestName || undefined })
        .then((r) => { if (!cancelled) setDupResult(r); })
        .catch(() => { if (!cancelled) setDupResult(null); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, party0Name, party0IdNumber, dupDismissed]);

  // 标题自动生成：委托方 与 对方 + 案由；用户手改后不再覆盖
  const [titleTouched, setTitleTouched] = useState(Boolean(editing));
  const [causeName, setCauseName] = useState("");
  const watchedParties = watch("parties");
  const watchedTitle = watch("title");
  const watchedCauseFree = watch("causeFreeText");
  useEffect(() => {
    if (titleTouched) return;
    const list = (watchedParties ?? []) as { role?: string; name?: string }[];
    const clientNm = list.find((p) => p.role === "CLIENT_PARTY")?.name?.trim();
    const oppNm = list.find((p) => p.role === "OPPOSING_PARTY")?.name?.trim();
    const causeNm = (causeName || watchedCauseFree || "").trim();
    if (!clientNm && !oppNm) return;
    const suggested = `${clientNm ?? ""}${oppNm ? `与${oppNm}` : ""}${causeNm}`.replace(/\s+/g, "");
    if (suggested && suggested !== (watchedTitle ?? "")) setValue("title", suggested, { shouldDirty: true });
  }, [watchedParties, causeName, watchedCauseFree, titleTouched, watchedTitle, setValue]);

  const procedureOptions: ProcedureType[] = useMemo(() => proceduresByCategory[category] ?? [], [category]);
  const ourStandingOptions: LitigationStanding[] = useMemo(() => procedureToStandingOptions(firstProcedureType, "ours"), [firstProcedureType]);
  const oppositeStandingOptions: LitigationStanding[] = useMemo(() => procedureToStandingOptions(firstProcedureType, "opposite"), [firstProcedureType]);

  useEffect(() => {
    if (firstProcedureType && !procedureOptions.includes(firstProcedureType)) {
      setValue("firstProcedureType", undefined);
      setValue("ourStanding", undefined);
    }
  }, [category, firstProcedureType, procedureOptions, setValue]);

  // 切类别同步当事人行：顾问/非诉专项默认只留委托方；诉讼仲裁至少一个相对方
  useEffect(() => {
    if(editing)return;
    const cur = (watch("parties") ?? []) as { role?: string }[];
    if (kind === "counsel" || kind === "project") {
      for (let i = cur.length - 1; i >= 1; i--) removeParty(i);
    } else if (!cur.some((x) => x.role === "OPPOSING_PARTY")) {
      appendParty(emptyParty("OPPOSING_PARTY", cur.length + 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    if (!ownerUserId && session?.user?.id) setValue("ownerUserId", session.user.id);
  }, [ownerUserId, session, setValue]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  function handleProcedureChange(p: ProcedureType) {
    setValue("firstProcedureType", p, { shouldDirty: true });
    setValue("ourStanding", undefined);
    let currentAgency = getValues("firstAgency");
    if (currentAgency && !isAgencyAllowedForProcedure(currentAgency, p)) {
      setValue("firstAgency", "", { shouldDirty: true });
      currentAgency = "";
    }
    if (!currentAgency) {
      const suggested = suggestHandlingAgency(p);
      if (agencyOptionsForProcedure(getValues("jurisdiction"), p).includes(suggested)) setValue("firstAgency", suggested);
    }
  }

  function handleJurisdictionChange(v: string) {
    setValue("jurisdiction", v, { shouldDirty: true });
    const cur = getValues("firstAgency");
    if (isNationalAgency(cur)) setValue("firstAgency", "", { shouldDirty: true });
    else if (cur && !agencyOptionsForProcedure(v, firstProcedureType).includes(cur)) setValue("firstAgency", "", { shouldDirty: true });
  }

  function handleFirstAgencyChange(v: string) {
    setValue("firstAgency", v, { shouldDirty: true });
    if (isNationalAgency(v)) setValue("jurisdiction", "", { shouldDirty: true });
  }

  function resetAll() {
    reset({ ...freshDefaults(), ownerUserId: session?.user?.id ?? "", ...editing?.values });
    setTitleTouched(false);
    setCauseName("");
    setContracts([]);
    setDupDismissed(false);
    setStep(0);
  }

  async function performSubmit(values: IntakeCreateInput) {
    let savedId=editing?.id;
    try {
      const res = editing ? await saveIntakeRevision(editing.id,editing.revision,values) : await createIntake(values);
      savedId=res.id;
      if (contracts.length > 0 && res.id) {
        for (const file of contracts) {
          const fd = new FormData();
          fd.set("intakeId", res.id);
          fd.set("name", file.name);
          fd.set("category", "CONTRACT");
          fd.set("encrypted", "true");
          fd.set("file", file);
          await uploadDocument(fd);
        }
      }
      // 冲突预检：自动携带收案全部主体发起检索（结果挂在收案上，审批时直接复核）
      let conflictText = "";
      let conflictHits = 0;
      let conflictCheckRan = true;
      if (res.id && !editing) {
        const queries = buildIntakeConflictQueries({
          client: { name: values.clientName ?? "", idNumber: values.clientIdNumber || null },
          parties: (values.parties ?? []).map((p) => ({ role: p.role, name: p.name ?? "", idNumber: p.idNumber || null, enterpriseSocialCode: p.enterpriseSocialCode || null }))
        });
        if (queries.length > 0) {
          try {
            const check = await runCheckAndSave({ intakeId: res.id, queries });
            conflictHits = check.hits.length;
            conflictText = check.hits.length ? ` · 冲突预检命中 ${check.hits.length} 条，请在收案详情作出结论` : " · 冲突预检未命中";
          } catch {
            conflictText = " · 冲突预检未能自动发起，请在收案详情手动检索";
            conflictCheckRan = false;
          }
        }
      }
      // P2-5（2026-09-20 C 批）：冲突预检有命中时不自动送审——结论只能在意向可编辑状态给出，
      // 直接送审会形成「结论恒 PENDING、无法转案」的无效轮次，每个命中收案被迫撤回-补结论-重提空转一轮。
      // 2026-09-20 P3 修复：命中判定不再解析 toast 文案（结构化计数）；预检发起失败同样停草稿，
      // 由律师手动检索后再送审（此前仍尝试自动送审，只靠服务端报错兜底）。
      const conflictHit = conflictHits > 0;
      if(res.workflowEnabled&&!editing&&conflictCheckRan&&!conflictHit) await resubmitIntake(res.id);
      toast.success(editing
        ? "补正已保存，请在详情复核检索后重新提交"
        : conflictHit
          ? `收案已保存为草稿${contracts.length > 0 ? `，上传 ${contracts.length} 份合同` : ""}${conflictText}。请先在收案详情作出冲突结论，再提交送审。`
          : conflictCheckRan
            ? `收案已提交审批${contracts.length > 0 ? `，上传 ${contracts.length} 份合同` : ""}${conflictText}`
            : `收案已保存为草稿${conflictText}。请先在收案详情手动完成冲突检索，再提交送审。`);
      resetAll();
      onOpenChange(false);
      if (res.id) {
        if (onSubmitted) onSubmitted(res.id);
        else router.push(`/intakes/${res.id}`);
      }
      router.refresh();
    } catch (err) {
      toast.error(editing?"补正未完成":"收案未送审", { description: err instanceof Error ? err.message : "" });
      if(savedId){onOpenChange(false);router.push(`/intakes/${savedId}`);router.refresh();}
    }
  }

  function onSubmit(values: IntakeCreateInput) {
    // 委托方恒为 parties[0]（role=CLIENT_PARTY）：拆回顶层 client* 字段，其余进 parties
    const all = values.parties ?? [];
    const client = all.find((p) => p.role === "CLIENT_PARTY");
    if (!client || !client.name?.trim()) {
      setStep(1);
      toast.warning("请填写委托方", { description: "委托方名称为必填" });
      return;
    }
    // 主体类型 → 客户类型：此前只把 ORGANIZATION 视为机构，选「公司 / 合伙企业」等会被建成自然人客户、丢失信用代码
    const isOrg = client.partyType !== "NATURAL_PERSON";
    const clientType = !isOrg ? "INDIVIDUAL" : ["COMPANY", "PARTNERSHIP", "INDIVIDUAL_BUSINESS"].includes(client.partyType ?? "") ? "COMPANY" : "ORGANIZATION";
    const payload: IntakeCreateInput = {
      ...values,
      clientName: client.name.trim(),
      clientType,
      clientIdType: isOrg ? "USCC" : client.idType || "ID_CARD",
      clientIdNumber: (isOrg ? client.enterpriseSocialCode : client.idNumber) ?? "",
      clientAddress: client.address ?? "",
      clientLegalRep: client.legalRep ?? "",
      contactName: client.contactName ?? "",
      contactPhone: client.phone ?? "",
      parties: all.filter((p) => p.role !== "CLIENT_PARTY")
    };
    startTransition(() => performSubmit(payload));
  }

  function onInvalid(formErrors: FieldErrors<IntakeCreateInput>) {
    const keys = Object.keys(formErrors);
    const stepOf = (k: string) => (k === "parties" || k === "ourStanding" || k.startsWith("client") || k.startsWith("contact") ? 1 : k.startsWith("fee") || k === "contingencyTerms" || k.includes("UserId") || k === "coUserIds" ? 2 : 0);
    if (keys.length) setStep(Math.min(...keys.map(stepOf)));
    toast.warning("请补全必填项", { description: firstFormErrorMessage(formErrors) ?? "请检查表单中的红色提示" });
  }

  const STEP_FIELDS: FieldPath<IntakeCreateInput>[][] = [
    ["title", "category", "firstProcedureType", "causeId", "firstAgency", "jurisdiction", "claimAmount", "claimDescription", "serviceStart", "serviceEnd"],
    ["parties", "ourStanding"],
    ["feeType", "feeAmount", "contingencyTerms", "feeSchedule", "ownerUserId", "coUserIds"]
  ];

  async function next() {
    if (step === 1) {
      const client = (getValues("parties") ?? [])[0];
      if (!client?.name?.trim()) {
        toast.warning("请填写委托方名称");
        return;
      }
    }
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true });
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    else toast.warning("本步还有必填项未完成", { description: firstFormErrorMessage(methods.formState.errors) ?? "请按红色提示补全" });
  }

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).filter((f) => f.size <= 20 * 1024 * 1024);
    if (arr.length < list.length) toast.warning("跳过了超过 20MB 的文件");
    setContracts((prev) => [...prev, ...arr]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handlePleadingFile(file: File) {
    setOcrPending(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await parsePleading(fd);
      const guess = (p: { legalRep?: string | null; idNumber?: string | null }): "NATURAL_PERSON" | "ORGANIZATION" =>
        (p.legalRep && p.legalRep.trim()) || (p.idNumber && p.idNumber.length === 18 && /[A-Z]/.test(p.idNumber)) ? "ORGANIZATION" : "NATURAL_PERSON";
      const add = (role: PartyRole, list: typeof res.plaintiffs) => {
        list.forEach((p, i) => {
          const t = guess(p);
          appendParty({
            ...emptyParty(role, parties.filter((x) => x.role === role).length + 1 + i),
            partyType: t,
            name: p.name ?? "",
            idNumber: t === "NATURAL_PERSON" ? p.idNumber ?? "" : "",
            enterpriseSocialCode: t === "ORGANIZATION" ? p.idNumber ?? "" : "",
            enterpriseName: t === "ORGANIZATION" ? p.name ?? "" : "",
            phone: p.phone ?? "",
            address: p.address ?? "",
            legalRep: p.legalRep ?? ""
          });
        });
      };
      add("OPPOSING_PARTY", res.plaintiffs);
      add("THIRD_PARTY", res.thirdParties);
      if (res.cause && !watch("causeFreeText")) setValue("causeFreeText", res.cause, { shouldDirty: true });
      if (typeof res.claimAmount === "number" && !watch("claimAmount")) setValue("claimAmount", res.claimAmount, { shouldDirty: true });
      if (res.claimDescription && !watch("claimDescription")) setValue("claimDescription", res.claimDescription, { shouldDirty: true });
      if (res.court && !watch("firstAgency")) setValue("firstAgency", res.court, { shouldDirty: true });
      toast.success(`已识别 ${res.plaintiffs.length} 个起诉方 / ${res.thirdParties.length} 个第三人`, { description: "请人工核对字段是否准确" });

      const situationParts: string[] = [];
      if (res.cause) situationParts.push(`OCR 识别案由：${res.cause}`);
      if (res.claimDescription) situationParts.push(`诉讼请求：${res.claimDescription}`);
      const oppPartyNames = res.plaintiffs.map((p) => p.name).filter(Boolean).join("、");
      if (oppPartyNames) situationParts.push(`对方当事人：${oppPartyNames}`);
      if (res.court) situationParts.push(`管辖：${res.court}`);
      const situationText = situationParts.join("\n");
      if (situationText && !watch("causeId")) triggerCauseRecommendation(category, situationText, firstProcedureType);
    } catch (err) {
      toast.error("识别失败", { description: err instanceof Error ? err.message : "" });
    } finally {
      setOcrPending(false);
      if (pleadingRef.current) pleadingRef.current.value = "";
    }
  }

  async function triggerCauseRecommendation(cat: MatterCategory, situation: string, procType?: ProcedureType | null) {
    setAiRecSituation({ category: cat, text: situation });
    setAiRecOpen(true);
    setAiRecLoading(true);
    setAiRecError(null);
    setAiRecCandidates([]);
    try {
      setAiRecCandidates(await recommendCause({ category: cat, procedureType: procType, situation }));
    } catch (err) {
      setAiRecError(err instanceof Error ? err.message : "AI 推荐失败");
    } finally {
      setAiRecLoading(false);
    }
  }

  function handleAiRecSelect(causeId: string, causeNm: string) {
    setValue("causeId", causeId, { shouldDirty: true });
    setCauseName(causeNm);
    setAiRecOpen(false);
    toast.success("已选用 AI 推荐案由", { description: causeNm });
  }

  async function handlePickYuandian(candidate: EnterpriseSearchItem) {
    setValue("clientId", "", { shouldDirty: true });
    setValue("parties.0.partyType", "ORGANIZATION", { shouldDirty: true });
    setValue("parties.0.name", candidate.name, { shouldDirty: true });
    setValue("parties.0.enterpriseName", candidate.name, { shouldDirty: true });
    setValue("parties.0.enterpriseSocialCode", candidate.creditCode, { shouldDirty: true, shouldValidate: true });
    const tid = toast.loading("正在获取企业详细信息…", { duration: 10_000 });
    try {
      const res = await getEnterpriseDetail(candidate.id);
      if (res.info) {
        setValue("parties.0.address", res.info.address, { shouldDirty: true });
        setValue("parties.0.legalRep", res.info.legalRep, { shouldDirty: true });
        if (res.info.legalRep && !watch("parties.0.contactName")) setValue("parties.0.contactName", res.info.legalRep, { shouldDirty: true });
        toast.success(res.info.legalRep ? `已填充：法定代表人 ${res.info.legalRep}` : "已填充企业信息", { id: tid });
      } else {
        toast.info("未查到详细信息，已填充基础信息", { id: tid });
      }
    } catch {
      toast.error("获取企业详情失败，请手动补充", { id: tid });
    }
  }

  const clientIndex = 0;
  const otherParties = parties.map((p, idx) => ({ p, idx })).filter(({ idx }) => idx !== clientIndex);
  const errCount = Object.keys(errors).length;
  const pendingNotes = [
    !party0Name.trim() ? "委托方" : null,
    kind === "litigation" && !ourStanding ? "我方诉讼地位" : null,
    !feeType ? "收费方式" : null,
    !ownerUserId ? "主办律师" : null
  ].filter(Boolean) as string[];

  const standingSelect = (value: string | undefined, options: LitigationStanding[], onChange: (v: LitigationStanding) => void) => (
    <ChoiceField
      ariaLabel="诉讼地位"
      placeholder="选择诉讼地位"
      threshold={0}
      options={(options.length ? options : (Object.keys(litigationStandingLabel) as LitigationStanding[])).map((s) => ({ value: s, label: litigationStandingLabel[s] }))}
      value={value as LitigationStanding | undefined}
      onChange={onChange}
    />
  );

  const clientLabel = kind === "counsel" ? "顾问单位" : kind === "project" ? "委托方" : "委托方";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!isPending) onOpenChange(o); }}>
      <SheetContent side="right" className="mo-intake flex w-full flex-col gap-0 p-0 sm:max-w-[780px] [&>button]:hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="id-head">
              <div className="id-top">
                <SheetTitle asChild>
                  <span className="id-title">{editing?"补正收案资料":"新建收案"}</span>
                </SheetTitle>
                <span className="badge b-white">{editing?"保存后复核并重新提交":"提交后进入收案审批"}</span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon id-close" onClick={() => onOpenChange(false)} aria-label="关闭" disabled={isPending}>
                  <X />
                </button>
              </div>
              <SheetDescription className="sr-only">四步完成收案登记：收案信息、当事人与冲突、收费与团队、确认提交</SheetDescription>
              <div className="id-steps">
                {STEPS.map((label, i) => (
                  <div key={label} className="contents">
                    {i > 0 ? <div className="id-conn" style={i <= step ? { background: "var(--teal)" } : undefined} /> : null}
                    <button type="button" onClick={() => i < step && setStep(i)} className={cn("id-step border-0 bg-transparent p-0 font-[inherit]", i === step && "active", i < step && "done")} aria-current={i === step ? "step" : undefined}>
                      <span className="n">{i < step ? "✓" : i + 1}</span>
                      <span className="lbl">{label}</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="id-progress"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%`, transition: "width .24s var(--ease-out)" }} /></div>
              <div className="id-hint"><span>连续表单，可随时返回上一步；必填项标 *</span><span>Esc 关闭</span></div>
            </div>

            <div ref={bodyRef} className="id-body">
              {errCount > 0 ? (
                <div role="alert" className="match-banner" style={{ background: "var(--red-bg)", borderColor: "var(--red-line)" }}>
                  <AlertTriangle style={{ color: "var(--red)" }} />
                  <div className="match-body">
                    <div className="match-title" style={{ color: "var(--red)" }}>尚有必填信息未完成</div>
                    <div className="match-desc" style={{ color: "var(--red)" }}>{firstFormErrorMessage(errors) ?? "请检查表单中的红色提示"}</div>
                  </div>
                </div>
              ) : null}

              {/* ───── 第 1 步：收案信息 ───── */}
              <div hidden={step !== 0}>
                <div className="fsec">
                  <div className="fsec-head"><span className="t">基本信息</span><span className="req">带 * 为必填</span></div>
                  <div className="fsec-body">
                    <div className="frow">
                      <div className="fitem">
                        <label className="flabel">{nameLabel}</label>
                        {(() => {
                          const titleReg = register("title");
                          return (
                            <div className="relative">
                              <input className="finput pr-28" placeholder="留空时按「委托方与对方 + 案由」自动生成" {...titleReg} onChange={(e) => { titleReg.onChange(e); setTitleTouched(true); }} />
                              {!titleTouched ? <span className="t-xs t-faint pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">按当事人与案由生成</span> : null}
                            </div>
                          );
                        })()}
                        {errors.title?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.title.message}</div> : null}
                      </div>
                    </div>
                    <div className="frow">
                      <div className="fitem">
                        <label className="flabel">案件类别<span className="star">*</span></label>
                        <ChoiceField ariaLabel="案件类别" options={CATEGORIES.map((c) => ({ value: c, label: matterCategoryLabel[c] }))} value={category} onChange={(c) => setValue("category", c)} />
                      </div>
                      {kind === "litigation" ? (
                        <div className="fitem">
                            <label className="flabel">代理程序<span className="star">*</span></label>
                            <ChoiceField ariaLabel="代理程序" placeholder="选择代理程序" invalid={Boolean(errors.firstProcedureType)} options={procedureOptions.map((p) => ({ value: p, label: procedureTypeLabel[p] }))} value={firstProcedureType} onChange={handleProcedureChange} />
                            {errors.firstProcedureType?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.firstProcedureType.message}</div> : null}
                          </div>
                      ) : null}
                    </div>

                    {kind === "litigation" ? (
                      <>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">案由<span className="star">*</span></label>
                            <div className="flex gap-2">
                              <div className="min-w-0 flex-1">
                                <CauseCombobox category={category} procedureType={firstProcedureType} value={watch("causeId") || ""} disabled={!firstProcedureType} placeholder={firstProcedureType ? "点击选择案由" : "请先选择代理程序"} onChange={(id, name) => { setValue("causeId", id, { shouldDirty: true }); setCauseName(name); }} />
                              </div>
                              <button type="button" className="btn btn-secondary shrink-0" onClick={() => setAiManualOpen(true)} disabled={!firstProcedureType} title="描述案情，由 AI 推荐规范案由">
                                <Sparkles />
                                AI 推荐
                              </button>
                            </div>
                            {causeName ? <div className="t-xs t-mute" style={{ marginTop: 5 }}>已选：{causeName}</div> : watchedCauseFree ? <div className="t-xs t-mute" style={{ marginTop: 5 }}>识别案由：{watchedCauseFree}（请选择规范案由）</div> : null}
                          </div>
                          <div className="fitem" style={{ maxWidth: 180 }}>
                            <label className="flabel">收案日期<span className="star">*</span></label>
                            <input type="date" className="finput font-mono" value={dateInput(receivedAt)} onChange={(e) => setValue("receivedAt", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                        </div>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">管辖地</label>
                            <JurisdictionSelect value={jurisdiction} onChange={handleJurisdictionChange} triggerClassName="h-9" />
                          </div>
                          <div className="fitem">
                            <label className="flabel">争议解决机构</label>
                            <Select value={watch("firstAgency") || ""} onValueChange={handleFirstAgencyChange} disabled={agencyOpts.length === 0}>
                              <SelectTrigger className="h-9"><SelectValue placeholder={agencyOpts.length ? "选择机构" : "请先选择程序与管辖地"} /></SelectTrigger>
                              <SelectContent>
                                {agencyOpts.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="frow">
                          <div className="fitem" style={{ maxWidth: 200 }}>
                            <label className="flabel">标的额（元）</label>
                            <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" className="finput font-mono" {...register("claimAmount", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
                            {errors.claimAmount?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.claimAmount.message}</div> : null}
                          </div>
                          <div className="fitem">
                            <label className="flabel">标的描述（非金钱标的或其他诉求）</label>
                            <input className="finput" placeholder="如：请求确认合同有效 / 请求停止侵害" {...register("claimDescription")} />
                          </div>
                        </div>
                        <div className="frow" style={{ marginBottom: 0 }}>
                          <div className="fitem">
                            <label className="flabel">是否需向律协备案</label>
                            <Select value={watch("barFiling") ?? ""} onValueChange={(v) => setValue("barFiling", v as BarFilingType, { shouldDirty: true })}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="选择" /></SelectTrigger>
                              <SelectContent>{BAR_FILING_OPTIONS.map((b) => <SelectItem key={b} value={b}>{barFilingLabel[b]}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="fitem">
                            <label className="flabel">是否反诉</label>
                            <div className="chip-set">
                              {[false, true].map((v) => (
                                <button key={String(v)} type="button" onClick={() => setValue("counterclaim", v, { shouldDirty: true })} className={cn("chip", Boolean(watch("counterclaim")) === v && "active")}>
                                  {Boolean(watch("counterclaim")) === v ? <span className="cd" /> : null}
                                  {v ? "是" : "否"}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}

                    {kind === "project" ? (
                      <>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">业务类型</label>
                            <Select value={watch("businessType") || ""} onValueChange={(v) => setValue("businessType", v, { shouldDirty: true })}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="选择业务类型" /></SelectTrigger>
                              <SelectContent>{PROJECT_BUSINESS_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="fitem">
                            <label className="flabel">项目金额（元）</label>
                            <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" className="finput font-mono" {...register("claimAmount", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
                          </div>
                          <div className="fitem" style={{ maxWidth: 160 }}>
                            <label className="flabel">收案日期<span className="star">*</span></label>
                            <input type="date" className="finput font-mono" value={dateInput(receivedAt)} onChange={(e) => setValue("receivedAt", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                        </div>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">起始时间</label>
                            <input type="date" className="finput font-mono" value={dateInput(watch("serviceStart"))} onChange={(e) => setValue("serviceStart", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                          <div className="fitem">
                            <label className="flabel">结束时间</label>
                            <input type="date" className="finput font-mono" value={dateInput(watch("serviceEnd"))} onChange={(e) => setValue("serviceEnd", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                        </div>
                        <div className="frow" style={{ marginBottom: 0 }}>
                          <div className="fitem" style={{ flex: 2 }}>
                            <label className="flabel">服务范围 / 内容</label>
                            <input className="finput" placeholder="如：尽职调查范围、合同审查清单、交易结构设计…" {...register("serviceScope")} />
                          </div>
                          <div className="fitem">
                            <label className="flabel">交付成果</label>
                            <input className="finput" placeholder="如：法律意见书 / 尽调报告" {...register("deliverables")} />
                          </div>
                        </div>
                      </>
                    ) : null}

                    {kind === "counsel" ? (
                      <>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">顾问类型</label>
                            <ChoiceField ariaLabel="顾问类型" placeholder="选择顾问类型" options={COUNSEL_TYPES.map((t) => ({ value: t, label: t }))} value={watch<string | undefined>("counselType")} onChange={(t) => setValue("counselType", t, { shouldDirty: true })} />
                          </div>
                          <div className="fitem" style={{ maxWidth: 160 }}>
                            <label className="flabel">收案日期<span className="star">*</span></label>
                            <input type="date" className="finput font-mono" value={dateInput(receivedAt)} onChange={(e) => setValue("receivedAt", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                        </div>
                        <div className="frow">
                          <div className="fitem">
                            <label className="flabel">顾问期限 · 起</label>
                            <input type="date" className="finput font-mono" value={dateInput(watch("serviceStart"))} onChange={(e) => setValue("serviceStart", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                          <div className="fitem">
                            <label className="flabel">顾问期限 · 止</label>
                            <input type="date" className="finput font-mono" value={dateInput(watch("serviceEnd"))} onChange={(e) => setValue("serviceEnd", e.target.value ? new Date(e.target.value) : undefined, { shouldDirty: true })} />
                          </div>
                          <div className="fitem">
                            <label className="flabel">对接电话</label>
                            <input className="finput font-mono" placeholder="对接人电话" {...register("contactPhone")} />
                          </div>
                        </div>
                        <div className="frow" style={{ marginBottom: 0 }}>
                          <div className="fitem">
                            <label className="flabel">服务范围 / 内容</label>
                            <input className="finput" placeholder="如：日常法律咨询、合同审查、专项法律意见…" {...register("serviceScope")} />
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* ───── 第 2 步：当事人与冲突 ───── */}
              <div hidden={step !== 1}>
                <div className="fsec">
                  <div className="fsec-head">
                    <span className="t">{clientLabel}</span>
                    <span className="req">建档时自动查重：名称 + 证件号码两级匹配</span>
                    {clientId ? (
                      <span className="aside">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setValue("clientId", "", { shouldDirty: true }); setValue("parties.0.name", "", { shouldDirty: true }); setDupDismissed(false); }}>
                          换一个客户
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <div className="fsec-body">
                    {dupResult && (dupResult.idNumberDuplicate || dupResult.nameDuplicates.length > 0) ? (
                      <div className="match-banner">
                        <AlertTriangle />
                        <div className="match-body">
                          {dupResult.idNumberDuplicate ? (
                            <>
                              <div className="match-title">查重命中：已存在同一主体的客户档案{dupResult.idNumberDuplicate.deletedAt ? "（停用档案）" : ""}</div>
                              <div className="match-desc">证件号码已登记于「{dupResult.idNumberDuplicate.name}」。身份持续唯一：建议关联已有档案，避免重复建档；若为重复建档，请到客户档案中合并处理。</div>
                            </>
                          ) : (
                            <>
                              <div className="match-title">疑似重复：已有同名客户</div>
                              <div className="match-desc">{dupResult.nameDuplicates.map((d) => d.name).join("、")}。名称相同只作提示，请核对证件后决定关联或新建。</div>
                            </>
                          )}
                          <div className="match-acts">
                            {dupResult.idNumberDuplicate && !dupResult.idNumberDuplicate.deletedAt ? (
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => { const d = dupResult.idNumberDuplicate!; setValue("clientId", d.id, { shouldDirty: true }); setValue("parties.0.name", d.name, { shouldDirty: true, shouldValidate: true }); }}>
                                关联已有客户
                              </button>
                            ) : null}
                            {dupResult.idNumberDuplicate ? (
                              <a className="btn btn-secondary btn-sm" href={`/clients/${dupResult.idNumberDuplicate.id}`} target="_blank" rel="noreferrer">查看档案</a>
                            ) : null}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDupDismissed(true)}>仍要新建</button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mb-2.5">
                      <label className="flabel">选择已有客户或输入新客户<span className="star">*</span></label>
                      <ClientCombobox
                        clientId={clientId}
                        clientName={party0Name}
                        clientType={watch("parties.0.partyType") === "ORGANIZATION" ? "COMPANY" : "INDIVIDUAL"}
                        options={clientOptions}
                        onPickExisting={(id, name) => { setValue("clientId", id, { shouldDirty: true }); setValue("parties.0.name", name, { shouldDirty: true, shouldValidate: true }); }}
                        onTypeNew={(name) => { setValue("clientId", "", { shouldDirty: true }); setValue("parties.0.name", name, { shouldDirty: true, shouldValidate: true }); }}
                        onPickYuandian={handlePickYuandian}
                        onClear={() => {
                          setValue("clientId", "", { shouldDirty: true });
                          (["name", "idNumber", "enterpriseSocialCode", "enterpriseName", "address", "legalRep"] as const).forEach((f) => setValue(`parties.0.${f}`, "", { shouldDirty: true }));
                        }}
                      />
                    </div>
                    {parties[clientIndex] ? (
                      <PartyCard
                        key={parties[clientIndex].id}
                        index={clientIndex}
                        fieldPrefix="parties"
                        showStanding={kind === "litigation"}
                        removable={false}
                        onRemove={() => undefined}
                        errors={errors as never}
                        logoTone="teal"
                        defaultExpanded={!clientId}
                        roleSlot={<span className="badge b-teal" style={{ fontSize: 10 }}>{clientLabel}</span>}
                        badge={clientId ? <span className="badge b-teal" style={{ fontSize: 10 }}>已关联档案</span> : null}
                        standingLabel={ourStanding ? litigationStandingLabel[ourStanding] : null}
                        standingSlot={standingSelect(ourStanding, ourStandingOptions, (v) => setValue("ourStanding", v, { shouldDirty: true, shouldValidate: true }))}
                        nameSlot={<input className="finput" value={party0Name} readOnly aria-readonly title="请在上方客户选择框中修改" />}
                      />
                    ) : null}
                    {errors.ourStanding?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.ourStanding.message}</div> : null}
                  </div>
                </div>

                {kind !== "counsel" ? (
                  <div className="fsec">
                    <div className="fsec-head">
                      <span className="t">{kind === "litigation" ? "诉讼对方与第三人" : "相对方与关联方"}</span>
                      <span className="req">可多个 · 将自动带入冲突检索</span>
                    </div>
                    <div className="fsec-body">
                      {kind === "litigation" && ourStanding && RECEIVING_STANDINGS.has(ourStanding) ? (
                        <div className="match-banner" style={{ background: "var(--violet-bg)", borderColor: "var(--violet-line)" }}>
                          <ScanLine style={{ color: "var(--violet)" }} />
                          <div className="match-body">
                            <div className="match-title" style={{ color: "var(--violet)" }}>识别起诉状 / 申请书</div>
                            <div className="match-desc" style={{ color: "var(--t-secondary)" }}>我方为被动方，可上传对方起诉状或申请书（JPG / PNG / WebP / PDF，≤ 20MB），AI 抽取对方主体、诉求与法院，识别结果须人工核对。</div>
                            <div className="match-acts">
                              <input ref={pleadingRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePleadingFile(f); }} />
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => pleadingRef.current?.click()} disabled={ocrPending}>
                                {ocrPending ? <Loader2 className="animate-spin" /> : <ScanLine />}
                                上传识别
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {otherParties.map(({ p, idx }) => {
                        const role = (watch(`parties.${idx}.role`) as PartyRole) ?? "OPPOSING_PARTY";
                        const standing = watch<LitigationStanding | undefined>(`parties.${idx}.standing`);
                        return (
                          <PartyCard
                            key={p.id}
                            index={idx}
                            fieldPrefix="parties"
                            showStanding={kind === "litigation"}
                            removable
                            onRemove={() => removeParty(idx)}
                            errors={errors as never}
                            logoTone={role === "OPPOSING_PARTY" ? "navy" : "slate"}
                            roleSlot={
                              <Select value={role} onValueChange={(v) => setValue(`parties.${idx}.role`, v as PartyRole, { shouldDirty: true })}>
                                <SelectTrigger className="h-[22px] w-auto gap-1 rounded-full px-2 text-[10.5px] font-[550]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="OPPOSING_PARTY">相对方</SelectItem>
                                  <SelectItem value="THIRD_PARTY">第三人</SelectItem>
                                  <SelectItem value="OTHER">关联方</SelectItem>
                                </SelectContent>
                              </Select>
                            }
                            standingLabel={standing ? litigationStandingLabel[standing] : null}
                            standingSlot={standingSelect(standing, oppositeStandingOptions, (v) => setValue(`parties.${idx}.standing`, v, { shouldDirty: true, shouldValidate: true }))}
                          />
                        );
                      })}
                      <button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", border: "1px dashed var(--bd-default)", borderRadius: 10, height: 38 }} onClick={() => appendParty(emptyParty("OPPOSING_PARTY", parties.length + 1))}>
                        <Plus />
                        {kind === "litigation" ? "添加诉讼对方 / 第三人" : "添加相对方"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* ───── 第 3 步：收费与团队 ───── */}
              <div hidden={step !== 2}>
                <div className="fsec">
                  <div className="fsec-head"><span className="t">{kind === "counsel" ? "顾问费" : "律师费"}</span></div>
                  <div className="fsec-body">
                    <div className="frow">
                      <div className="fitem">
                        <label className="flabel">收费方式</label>
                        <div className="chip-set">
                          {FEE_TYPES.filter((t) => kind !== "counsel" || t !== "CONTINGENCY").map((t) => (
                            <button key={t} type="button" onClick={() => setValue("feeType", t, { shouldDirty: true })} className={cn("chip", feeType === t && "active")}>
                              {feeType === t ? <span className="cd" /> : null}
                              {feeTypeLabel[t]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {feeType ? (
                      <div className="frow">
                        <div className="fitem" style={{ maxWidth: 220 }}>
                          <label className="flabel">{feeType === "TIMED" ? "小时费率（元/时）" : feeType === "CONTINGENCY" ? "基础办案费（元）" : "总金额（元）"}<span className="star">*</span></label>
                          <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" className="finput font-mono" {...register("feeAmount", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })} />
                          {errors.feeAmount?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.feeAmount.message}</div> : null}
                        </div>
                        <div className="fitem">
                          <label className="flabel">{feeType === "TIMED" ? "计费说明 / 结算周期" : "付款节点 / 分期约定"}</label>
                          <input className="finput" placeholder={feeType === "TIMED" ? "如：按月结算，合伙人 2000 元/时" : feeType === "CONTINGENCY" ? "如：基础费签约付清；风险费到账后 7 日内支付" : "如：签约 40%，开庭前 30%，判决 30%"} {...register("feeSchedule")} />
                        </div>
                      </div>
                    ) : null}
                    {feeType === "CONTINGENCY" ? (
                      <div className="frow">
                        <div className="fitem">
                          <label className="flabel">风险代理收费方式<span className="star">*</span></label>
                          <textarea rows={3} className="finput !h-auto py-2.5 leading-[1.7]" placeholder="详细描述风险代理收费方式 / 触发条件 / 计提比例" {...register("contingencyTerms")} />
                          {errors.contingencyTerms?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.contingencyTerms.message}</div> : null}
                        </div>
                      </div>
                    ) : null}
                    {feeType ? (
                      <div className="frow" style={{ marginBottom: 0 }}>
                        <div className="fitem">
                          <label className="flabel">费用备注（可选）</label>
                          <input className="finput" placeholder="如：含差旅 / 含诉讼费垫付" {...register("feeNote")} />
                        </div>
                      </div>
                    ) : (
                      <div className="t-xs t-mute">未选择收费方式时可在转为正式案件后补登收费约定。</div>
                    )}
                  </div>
                </div>

                <div className="fsec">
                  <div className="fsec-head"><span className="t">承办团队</span><span className="req">主办默认本人，协办可多选</span></div>
                  <div className="fsec-body">
                    <div className="frow" style={{ marginBottom: 0 }}>
                      <div className="fitem">
                        <label className="flabel">主办律师<span className="star">*</span></label>
                        <Select value={ownerUserId ?? ""} onValueChange={(v) => setValue("ownerUserId", v, { shouldDirty: true })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="选择主办律师" /></SelectTrigger>
                          <SelectContent>{colleagues.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                        </Select>
                        {errors.ownerUserId?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{errors.ownerUserId.message}</div> : null}
                      </div>
                      <div className="fitem">
                        <label className="flabel">协办人员（可多选）</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="finput justify-between text-left">
                              <span className="truncate">{coUserIds.length === 0 ? <span className="t-faint">选择协办人员</span> : colleagues.filter((u) => coUserIds.includes(u.id)).map((u) => u.name).join("、")}</span>
                              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" portalled={false} className="w-[--radix-popover-trigger-width] p-1.5">
                            <ColleaguePicker people={colleagues.filter((u) => u.id !== ownerUserId) as TeamColleague[]} selected={coUserIds} onChange={(ids) => setValue("coUserIds", ids, { shouldDirty: true })} />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ───── 第 4 步：确认提交 ───── */}
              <div hidden={step !== 3}>
                <div className="fsec">
                  <div className="fsec-head">
                    <span className="t">委托合同 / 相关附件</span>
                    <span className="req">加密存储，单文件 ≤ 20MB</span>
                    <span className="aside">
                      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                        <Paperclip />
                        添加附件
                      </button>
                    </span>
                  </div>
                  <div className="fsec-body">
                    {contracts.length === 0 ? (
                      <div className="t-xs t-mute rounded-[10px] border border-dashed border-[var(--bd-default)] py-4 text-center">上传委托代理合同、授权委托书等</div>
                    ) : (
                      contracts.map((f, i) => (
                        <div key={i} className="entity-card">
                          <FileText className="h-4 w-4 text-[var(--teal)]" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-[550]">{f.name}</span>
                          <span className="num-sm t-mute">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setContracts((c) => c.filter((_, j) => j !== i))} aria-label={`移除 ${f.name}`}>
                            <X />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="fsec">
                  <div className="fsec-head"><span className="t">补充说明</span></div>
                  <div className="fsec-body">
                    <textarea rows={4} className="finput !h-auto py-2.5 leading-[1.7]" placeholder="客户来源、核心诉求、注意事项…" {...register("description")} />
                  </div>
                </div>

                <div className="fsec">
                  <div className="fsec-head"><span className="t">确认信息</span><span className="req">{editing?"保存补正后须复核冲突再送审":"提交后完成正式冲突检索并进入审批"}</span></div>
                  <div className="fsec-body">
                    <dl className="grid grid-cols-2 gap-x-6">
                      {[
                        [nameLabel, watchedTitle || "（自动生成）"],
                        ["案件类别", matterCategoryLabel[category]],
                        ...(kind === "litigation" ? [["代理程序", firstProcedureType ? procedureTypeLabel[firstProcedureType] : "未选择"], ["我方地位", ourStanding ? litigationStandingLabel[ourStanding] : "未选择"]] : []),
                        [clientLabel, party0Name || "未填写"],
                        ["其他当事人", `${otherParties.length} 个`],
                        ["收费", feeType ? `${feeTypeLabel[feeType]}${watch("feeAmount") ? ` · ¥${Number(watch("feeAmount")).toLocaleString("zh-CN")}` : ""}` : "未选择"],
                        ["主办律师", colleagues.find((u) => u.id === ownerUserId)?.name ?? "未选择"],
                        ["附件", `${contracts.length} 份`]
                      ].map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-3 border-b border-[var(--bd-hair)] py-2">
                          <dt className="w-[72px] shrink-0 text-[12px] text-[var(--t-muted)]">{k}</dt>
                          <dd className="min-w-0 truncate text-[12.75px] font-[550]">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="id-foot">
              <span className="t-xs t-mute">
                第 {step + 1} / {STEPS.length} 步{pendingNotes.length ? ` · ${pendingNotes.length} 项待完成：${pendingNotes.join("、")}` : ""}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <span className="ai-note hidden whitespace-nowrap lg:flex">
                  <Sparkles className="h-3.5 w-3.5" />
                  {editing?"保存后复核冲突并重新送审":"提交时自动进行正式冲突检索"}
                </span>
                <button type="button" className="btn btn-ghost" disabled={step === 0 || isPending} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                  上一步
                </button>
                {step < STEPS.length - 1 ? (
                  <button key="next-step" type="button" className="btn btn-primary" onClick={next}>
                    下一步 · {STEPS[step + 1]}
                    <ChevronRight />
                  </button>
                ) : (
                  <button key="submit-intake" type="submit" className="btn btn-primary" disabled={isPending}>
                    {isPending ? <Loader2 className="animate-spin" /> : null}
                    {editing?"保存补正":"提交审批"}
                    <ChevronRight />
                  </button>
                )}
              </div>
            </div>
          </form>
        </FormProvider>
        <CauseRecommendationDialog open={aiRecOpen} loading={aiRecLoading} candidates={aiRecCandidates} errorMessage={aiRecError} onSelect={handleAiRecSelect} onOpenChange={setAiRecOpen} onRetry={() => aiRecSituation && triggerCauseRecommendation(aiRecSituation.category, aiRecSituation.text, firstProcedureType)} />
        <CauseAiManualDialog
          open={aiManualOpen}
          onOpenChange={setAiManualOpen}
          category={category}
          procedureType={firstProcedureType}
          contextHints={[watchedCauseFree ? `OCR 识别案由：${watchedCauseFree}` : "", watch("claimDescription") ? `诉讼请求：${watch("claimDescription")}` : "", otherParties.map(({ idx }) => watch(`parties.${idx}.name`)).filter(Boolean).length ? `对方当事人：${otherParties.map(({ idx }) => watch(`parties.${idx}.name`)).filter(Boolean).join("、")}` : ""].filter(Boolean).join("\n")}
          onSelect={handleAiRecSelect}
        />
      </SheetContent>
    </Sheet>
  );
}
