"use client";

/**
 * 收案当事人卡（墨案 05 效果图 entity-card）。
 * 折叠态：主体标识 + 名称 + 角色/地位徽章 + 证件摘要，「补全身份」展开编辑；
 * 新建或有校验错误的行默认展开。字段与联动沿用原收案表单：
 * 主体类型切换清空对侧证件、单位名称自动匹配元典企业并回填信用代码/法代/地址。
 * 校验落在 zod superRefine（partyInputSchema）；本组件只负责 UI + 字段联动。
 */
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useFormContext, type FieldErrors } from "react-hook-form";
import { Loader2, Search, X } from "lucide-react";
import type { PartyType } from "@prisma/client";
import { toast } from "sonner";
import { partyTypeLabel, PARTY_TYPE_OPTIONS } from "@/lib/enums";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERSON_ID_TYPES, clientIdTypeLabel, personIdError, sanitizePersonIdInput, type PersonIdType } from "@/lib/clients/person-id";
import { ChoiceField } from "@/components/patterns/choice-field";
import { searchEnterpriseCandidates, getEnterpriseDetail, type EnterpriseSearchItem } from "@/server/yuandian/enterprise";
import { actionErrorMessage } from "@/lib/action-error";

type Props = {
  index: number;
  fieldPrefix: string; // e.g. "parties"
  onRemove: () => void;
  errors?: FieldErrors<Record<string, unknown>>;
  /** 角色徽章或角色选择 */
  roleSlot: ReactNode;
  /** 诉讼地位选择（showStanding 为 false 时忽略） */
  standingSlot?: ReactNode;
  standingLabel?: string | null;
  showStanding?: boolean;
  removable?: boolean;
  /** 提供时替换内置"姓名/名称"输入框（如委托方行注入客户选择器）。 */
  nameSlot?: ReactNode;
  /** 右上角额外标记（如「已关联」） */
  badge?: ReactNode;
  defaultExpanded?: boolean;
  logoTone?: "navy" | "teal" | "slate";
};

const LOGO_BG = { navy: "var(--bg-navy)", teal: "var(--teal-deep)", slate: "var(--slate)" } as const;

export function PartyCard({
  index,
  fieldPrefix,
  onRemove,
  errors,
  roleSlot,
  standingSlot,
  standingLabel,
  showStanding = true,
  removable = true,
  nameSlot,
  badge,
  defaultExpanded,
  logoTone = "navy"
}: Props) {
  const { register, watch, setValue } = useFormContext();
  const p = `${fieldPrefix}.${index}`;
  const partyType = (watch(`${p}.partyType`) as PartyType) ?? "NATURAL_PERSON";
  const isOrg = partyType !== "NATURAL_PERSON";
  const name = (watch(`${p}.name`) as string) ?? "";
  const idValue = ((isOrg ? watch(`${p}.enterpriseSocialCode`) : watch(`${p}.idNumber`)) as string) ?? "";
  const idType = ((watch(`${p}.idType`) as string) || "ID_CARD") as PersonIdType;
  // 即时校验（与服务端 zod 同一规则）：身份证只允许数字与末位 X、必须 18 位
  const liveIdError = !isOrg && idValue ? personIdError(idType, idValue) : null;
  const legalRep = (watch(`${p}.legalRep`) as string) ?? "";

  const fieldErr = (errors as Record<string, Record<number, Record<string, { message?: string }>>> | undefined)?.[fieldPrefix]?.[index] ?? {};
  const nameErr = fieldErr.name;
  const idErr = partyType === "NATURAL_PERSON" ? fieldErr.idNumber : fieldErr.enterpriseSocialCode;
  const standingErr = fieldErr.standing;
  const hasErr = Boolean(nameErr || idErr || standingErr);

  const [expanded, setExpanded] = useState(defaultExpanded ?? !name);
  const [candidates, setCandidates] = useState<EnterpriseSearchItem[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [filling, startFill] = useTransition();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = expanded || hasErr;

  function changeType(next: PartyType) {
    setValue(`${p}.partyType`, next, { shouldDirty: true, shouldValidate: true });
    if (next === "NATURAL_PERSON") {
      setValue(`${p}.enterpriseSocialCode`, "");
      setValue(`${p}.enterpriseName`, "");
      setValue(`${p}.legalRep`, "");
      if (!watch(`${p}.idType`)) setValue(`${p}.idType`, "ID_CARD");
    } else {
      setValue(`${p}.idNumber`, "");
      setValue(`${p}.idType`, "");
    }
  }

  // 输入单位名称时自动匹配元典企业（防抖）；未配置元典时静默
  function scheduleSearch(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (q.length < 2) {
      setCandidates(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      startSearch(async () => {
        try {
          const r = await searchEnterpriseCandidates(q);
          setCandidates(r.configured && r.items.length > 0 ? r.items : null);
        } catch {
          setCandidates(null);
        }
      });
    }, 400);
  }

  function handlePickCandidate(item: EnterpriseSearchItem) {
    startFill(async () => {
      setValue(`${p}.enterpriseSocialCode`, item.creditCode, { shouldDirty: true, shouldValidate: true });
      setValue(`${p}.enterpriseName`, item.name, { shouldDirty: true });
      setValue(`${p}.name`, item.name, { shouldDirty: true });
      setCandidates(null);
      try {
        const r = await getEnterpriseDetail(item.id);
        if (r.configured && r.info) {
          if (r.info.legalRep) setValue(`${p}.legalRep`, r.info.legalRep, { shouldDirty: true });
          if (r.info.address) setValue(`${p}.address`, r.info.address, { shouldDirty: true });
          toast.success(`已回填：${item.name}`);
        }
      } catch (err) {
        toast.warning("法代 / 地址自动填充失败，可手动补充", { description: actionErrorMessage(err) });
      }
    });
  }

  const nameReg = register(`${p}.name`);
  const meta = [idValue ? `${isOrg ? "" : `${clientIdTypeLabel[idType]} `}${idValue}` : `${isOrg ? "统一社会信用代码" : "证件号码"} 待补充`, isOrg && legalRep ? `法定代表人 ${legalRep}` : null].filter(Boolean).join(" · ");

  return (
    <div className={cn("entity-card flex-col !items-stretch", hasErr && "!border-[var(--red-line)]")} style={{ marginBottom: 10 }}>
      <div className="flex items-center gap-[11px]">
        <div className="entity-logo" style={{ background: LOGO_BG[logoTone] }}>{name.trim().charAt(0) || "?"}</div>
        <div className="min-w-0 flex-1">
          <div className="entity-name flex flex-wrap items-center gap-1.5">
            <span className="truncate">{name || <span className="t-faint font-normal">待填写主体</span>}</span>
            {roleSlot}
            {showStanding && standingLabel ? <span className="badge b-white" style={{ fontSize: 10 }}>{standingLabel}</span> : null}
            {badge}
          </div>
          <div className={cn("entity-meta truncate", !idValue && "!font-sans")}>{meta}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)} aria-expanded={open}>
          {open ? "收起" : idValue ? "编辑" : "补全身份"}
        </button>
        {removable ? (
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onRemove} aria-label="移除当事人">
            <X />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t border-[var(--bd-hair)] pt-3">
          <div className="frow">
            <div className="fitem">
              <label className="flabel">主体类型</label>
              <ChoiceField ariaLabel="主体类型" options={PARTY_TYPE_OPTIONS.map((t) => ({ value: t, label: partyTypeLabel[t] }))} value={partyType} onChange={changeType} />
            </div>
            {showStanding && standingSlot ? (
              <div className="fitem">
                <label className="flabel">
                  诉讼地位<span className="star">*</span>
                </label>
                {standingSlot}
                {standingErr?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{standingErr.message}</div> : null}
              </div>
            ) : (
              <div className="fitem" />
            )}
          </div>
          <div className="frow">
            <div className="fitem">
              <label className="flabel">
                {isOrg ? "单位 / 组织名称" : "姓名"}
                <span className="star">*</span>
              </label>
              {nameSlot ??
                (!isOrg ? (
                  <input className={cn("finput", nameErr && "!border-[var(--red)]")} placeholder="姓名" {...nameReg} />
                ) : (
                  <Popover open={!!candidates && candidates.length > 0} onOpenChange={(o) => { if (!o) setCandidates(null); }}>
                    <PopoverTrigger asChild>
                      <div className="relative">
                        <input
                          className={cn("finput pr-8", nameErr && "!border-[var(--red)]")}
                          placeholder="单位名称（输入自动匹配企业信息）"
                          {...nameReg}
                          onChange={(e) => {
                            nameReg.onChange(e);
                            scheduleSearch(e.target.value);
                          }}
                        />
                        {searching ? <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[var(--t-muted)]" /> : null}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent align="start" portalled={false} className="w-80 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
                      <div className="mb-1 flex items-center gap-1 px-1 text-[10.5px] text-[var(--t-muted)]">
                        <Search className="h-3 w-3" />
                        企业信息匹配，点击回填名称 + 信用代码
                      </div>
                      <ul className="max-h-64 space-y-1 overflow-y-auto">
                        {candidates?.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => handlePickCandidate(c)} disabled={filling} className="w-full rounded-[7px] border border-[var(--bd-hair)] px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)] disabled:opacity-50">
                              <div className="font-medium">{c.name}</div>
                              <div className="font-mono text-[10px] text-[var(--t-muted)]">{c.creditCode}</div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                ))}
              {nameErr?.message ? <div className="mt-1 text-[11px] text-[var(--red)]">{nameErr.message}</div> : null}
            </div>
            {!isOrg ? (
              <div className="fitem" style={{ maxWidth: 210 }}>
                <label className="flabel">证件类型</label>
                <Select value={idType} onValueChange={(v) => { setValue(`${p}.idType`, v, { shouldDirty: true }); setValue(`${p}.idNumber`, sanitizePersonIdInput(v, idValue), { shouldDirty: true, shouldValidate: Boolean(idErr) }); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERSON_ID_TYPES.map((t) => <SelectItem key={t} value={t}>{clientIdTypeLabel[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="fitem">
              <label className="flabel">
                {isOrg ? "统一社会信用代码" : idType === "ID_CARD" ? "身份证号" : "证件号码"}
                <span className="star">*</span>
              </label>
              {isOrg ? (
                <input className={cn("finput font-mono", idErr && "!border-[var(--red)]")} placeholder="18 位信用代码" {...register(`${p}.enterpriseSocialCode`)} />
              ) : (
                <input
                  className={cn("finput font-mono", (idErr || liveIdError) && "!border-[var(--red)]")}
                  placeholder={idType === "ID_CARD" ? "18 位，仅数字或末位 X" : "证件号码"}
                  inputMode={idType === "ID_CARD" ? "text" : undefined}
                  maxLength={idType === "ID_CARD" ? 18 : 30}
                  value={idValue}
                  onChange={(e) => setValue(`${p}.idNumber`, sanitizePersonIdInput(idType, e.target.value), { shouldDirty: true, shouldValidate: Boolean(idErr) })}
                />
              )}
              {idErr?.message ? (
                <div className="mt-1 text-[11px] text-[var(--red)]">{idErr.message}</div>
              ) : liveIdError ? (
                <div className="mt-1 text-[11px] text-[var(--amber)]">{liveIdError}</div>
              ) : !isOrg && idType === "ID_CARD" ? (
                <div className="mt-1 text-[11px] text-[var(--t-faint)]">只能输入数字或 X，共 18 位（{idValue.length}/18）</div>
              ) : null}
            </div>
          </div>
          <div className="frow">
            {isOrg ? (
              <div className="fitem">
                <label className="flabel">法定代表人 / 负责人</label>
                <input className="finput" {...register(`${p}.legalRep`)} />
              </div>
            ) : null}
            <div className="fitem">
              <label className="flabel">联系人</label>
              <input className="finput" {...register(`${p}.contactName`)} />
            </div>
            <div className="fitem">
              <label className="flabel">联系电话</label>
              <input className="finput font-mono" {...register(`${p}.phone`)} />
            </div>
          </div>
          <div className="frow" style={{ marginBottom: 0 }}>
            <div className="fitem">
              <label className="flabel">{isOrg ? "注册地址" : "住址"}</label>
              <input className="finput" {...register(`${p}.address`)} />
            </div>
            <div className="fitem">
              <label className="flabel">备注</label>
              <input className="finput" {...register(`${p}.notes`)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
