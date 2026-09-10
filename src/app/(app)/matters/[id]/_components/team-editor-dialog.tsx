"use client";

/**
 * v0.27: 由"编辑团队"扩展为"编辑案件"。
 *
 * - 基本信息：title / 案由 / 标的额 / 我方地位（收案日期 readonly）
 * - 团队：主办 / 协办 / 助理（沿用 v0.22 实现）
 *
 * 保存时按需触发两个 server action（基本信息 + 团队）。
 */
import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import type {
  LitigationStanding,
  MatterCategory,
  PartyRole,
  PartyType,
  ProcedureType
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  userRoleLabel,
  litigationStandingLabel,
  matterCategoryLabel,
  partyTypeLabel,
  procedureToStandingOptions,
  procedureTypeLabel
} from "@/lib/enums";
import {
  standingsByCategory
} from "@/lib/procedures-by-category";
import {
  updateMatterTeam,
  updateMatterBasicInfo,
  updateProcedureInfo
} from "@/server/matters/actions";
import { CauseCombobox } from "@/app/(app)/matters/_components/cause-combobox";
import { cn, formatDate } from "@/lib/utils";
import { JurisdictionSelect } from "@/app/(app)/intakes/_components/jurisdiction-select";
import {
  agencyOptionsForProcedure,
  isAgencyAllowedForProcedure,
  isNationalAgency
} from "@/lib/china-regions";

type UserOption = { id: string; name: string; role: string };

type MatterMeta = {
  intakeDate: Date | null;
  category: MatterCategory;
  title: string;
  causeId: string | null;
  causeFreeText: string | null;
  claimAmount: number | null;
  ourStanding: LitigationStanding | null;
};

type ProcedureMeta = {
  id: string;
  type: ProcedureType;
  customLabel: string | null;
  jurisdiction: string | null;
  handlingAgency: string | null;
  caseNumber: string | null;
  presidingJudge: string | null;
  presidingJudgeContact: string | null;
  judgeAssistant: string | null;
  judgeAssistantContact: string | null;
  ourStanding: LitigationStanding | null;
  acceptedAt: Date | null;
  concludedAt: Date | null;
  procedureParties: ProcedurePartyRow[];
};

type PartyLite = {
  id: string;
  role: PartyRole;
  standing: LitigationStanding | null;
  ordinal: number;
  name: string;
  partyType: PartyType;
  idNumber: string | null;
  phone: string | null;
  address: string | null;
  legalRep: string | null;
  contactName: string | null;
  enterpriseSocialCode: string | null;
};

type ProcedurePartyRow = {
  id: string;
  partyId: string;
  standing: LitigationStanding;
  ordinal: number;
  party: PartyLite;
};

type PartyEditDraft = {
  partyId: string;
  name: string;
  role: PartyRole;
  partyType: PartyType;
  idNumber: string;
  enterpriseSocialCode: string;
  legalRep: string;
  contactName: string;
  phone: string;
  address: string;
};

type NewProcedurePartyDraft = {
  tempId: string;
  existingPartyId: string | null;
  name: string;
  role: PartyRole;
  partyType: PartyType;
  idNumber: string;
  enterpriseSocialCode: string;
  standings: LitigationStanding[];
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  matterMeta: MatterMeta;
  currentProcedure?: ProcedureMeta | null;
  parties: PartyLite[];
  currentOwnerId: string;
  currentMembers: { userId: string; role: "LEAD" | "CO_LEAD" | "ASSISTANT"; name: string }[];
  userOptions: UserOption[];
  canEditMatterInfo: boolean;
  canManageTeam: boolean;
  canManageProcedure?: boolean;
};

const formControlClass =
  "ll-form-control h-9 border-[#D3DAE6] bg-white text-[13px]";

const formSectionClass =
  "space-y-3 rounded-md border border-[#D9E0EA] bg-[#F4F7FB] p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const nestedPanelClass = "rounded-md border border-[#D9E0EA] bg-white";
const formLabelClass = "text-[12px] font-medium text-muted-foreground";

const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  CLIENT_PARTY: "客户",
  OPPOSING_PARTY: "相对方",
  THIRD_PARTY: "第三人",
  CO_LITIGANT: "共同诉讼人",
  AGENT: "代理人",
  WITNESS: "证人",
  OTHER: "其他"
};

const PARTY_ROLE_OPTIONS: PartyRole[] = [
  "CLIENT_PARTY",
  "OPPOSING_PARTY",
  "THIRD_PARTY"
];

const PARTY_TYPE_OPTIONS: PartyType[] = [
  "NATURAL_PERSON",
  "COMPANY",
  "PARTNERSHIP",
  "INDIVIDUAL_BUSINESS",
  "INSTITUTION",
  "SOCIAL_ORG",
  "GOVERNMENT",
  "OTHER_ORG"
];

const REQUIRED_STANDINGS_BY_PROCEDURE: Partial<Record<ProcedureType, LitigationStanding[]>> = {
  FIRST_INSTANCE: ["PLAINTIFF", "DEFENDANT"],
  REMAND_FIRST: ["PLAINTIFF", "DEFENDANT"],
  SECOND_INSTANCE: ["APPELLANT", "APPELLEE"],
  REMAND_SECOND: ["APPELLANT", "APPELLEE"],
  RETRIAL_REVIEW: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  RETRIAL: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  PROSECUTORIAL_SUPERVISION: ["RETRIAL_APPLICANT", "RETRIAL_RESPONDENT"],
  COMMERCIAL_ARBITRATION: ["ARBITRATION_CLAIMANT", "ARBITRATION_RESPONDENT"],
  LABOR_ARBITRATION: ["ARBITRATION_CLAIMANT", "ARBITRATION_RESPONDENT"],
  ENFORCEMENT: ["ENFORCEMENT_APPLICANT", "EXECUTED_PERSON"],
  ENFORCEMENT_OBJECTION: ["ENFORCEMENT_APPLICANT", "EXECUTED_PERSON"],
  ADMIN_RECONSIDERATION: [
    "ADMIN_RECONSIDERATION_APPLICANT",
    "ADMIN_RECONSIDERATION_RESPONDENT"
  ],
  NON_LITIGATION_PHASE: ["NON_LITIGATION_PARTY"],
  CUSTOM: ["NON_LITIGATION_PARTY"]
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
      <span className="h-3 w-[3px] rounded-full bg-primary" aria-hidden="true" />
      {children}
    </h3>
  );
}

const ARBITRATION_TYPES: ProcedureType[] = [
  "COMMERCIAL_ARBITRATION",
  "LABOR_ARBITRATION",
  "ARBITRATION_SET_ASIDE",
  "ARBITRATION_ENFORCEMENT_REVIEW"
];

const EXECUTION_TYPES: ProcedureType[] = [
  "ENFORCEMENT",
  "ENFORCEMENT_OBJECTION",
  "ADMIN_NON_LITIGATION_ENFORCEMENT",
  "CRIMINAL_ENFORCEMENT"
];

function toInputDate(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().split("T")[0] : "";
}

function procedureJudgeLabel(type: ProcedureType) {
  if (ARBITRATION_TYPES.includes(type)) return "首席仲裁员";
  if (EXECUTION_TYPES.includes(type)) return "执行法官";
  return "主审法官";
}

function normalizePartyTypeForForm(partyType: PartyType): PartyType {
  return partyType === "ORGANIZATION" ? "OTHER_ORG" : partyType;
}

function normalizePartyRoleForForm(role: PartyRole): PartyRole {
  return PARTY_ROLE_OPTIONS.includes(role) ? role : "OPPOSING_PARTY";
}

function normalizeStandingForUi(standing: LitigationStanding): LitigationStanding {
  if (standing === "JOINT_PLAINTIFF") return "PLAINTIFF";
  if (standing === "JOINT_DEFENDANT") return "DEFENDANT";
  return standing;
}

function standingOrder(type: ProcedureType, rows: ProcedurePartyRow[]) {
  const base = procedureToStandingOptions(type, "ours");
  const required = REQUIRED_STANDINGS_BY_PROCEDURE[type] ?? [];
  const assigned = rows.map((row) => normalizeStandingForUi(row.standing));
  return [...new Set([...required, ...base, ...assigned])];
}

function defaultStandingForParty(
  procedure: ProcedureMeta,
  party: PartyLite,
  partyStandingOptions: LitigationStanding[]
) {
  const required = REQUIRED_STANDINGS_BY_PROCEDURE[procedure.type] ?? [];
  const firstRequired = required[0] ?? partyStandingOptions[0] ?? null;
  const clientStanding =
    procedure.ourStanding && partyStandingOptions.includes(normalizeStandingForUi(procedure.ourStanding))
      ? normalizeStandingForUi(procedure.ourStanding)
      : firstRequired;

  if (party.role === "CLIENT_PARTY") return clientStanding;
  if (party.role === "OPPOSING_PARTY") {
    return (
      required.find((standing) => standing !== clientStanding) ??
      partyStandingOptions.find((standing) => standing !== clientStanding) ??
      null
    );
  }
  if (party.role === "THIRD_PARTY" && partyStandingOptions.includes("THIRD_PARTY")) {
    return "THIRD_PARTY";
  }
  return null;
}

function buildInitialProcedureParties(
  procedure: ProcedureMeta,
  parties: PartyLite[],
  partyStandingOptions: LitigationStanding[]
) {
  const rows = procedure.procedureParties.map((row) => ({
    partyId: row.partyId,
    standing: normalizeStandingForUi(row.standing)
  }));
  const assignedPartyIds = new Set(rows.map((row) => row.partyId));

  for (const party of parties) {
    if (assignedPartyIds.has(party.id)) continue;
    const standing = defaultStandingForParty(procedure, party, partyStandingOptions);
    if (standing) {
      rows.push({ partyId: party.id, standing });
      assignedPartyIds.add(party.id);
    }
  }

  return rows;
}

function partyToEditDraft(party: PartyLite): PartyEditDraft {
  return {
    partyId: party.id,
    name: party.name ?? "",
    role: normalizePartyRoleForForm(party.role),
    partyType: normalizePartyTypeForForm(party.partyType),
    idNumber: party.idNumber ?? "",
    enterpriseSocialCode: party.enterpriseSocialCode ?? "",
    legalRep: party.legalRep ?? "",
    contactName: party.contactName ?? "",
    phone: party.phone ?? "",
    address: party.address ?? ""
  };
}

function initialNewPartyForm(partyStandingOptions: LitigationStanding[]) {
  return {
    existingPartyId: null as string | null,
    name: "",
    role: "OPPOSING_PARTY" as PartyRole,
    partyType: "NATURAL_PERSON" as PartyType,
    idNumber: "",
    enterpriseSocialCode: "",
    standings: partyStandingOptions.slice(0, 1)
  };
}

function toProcedureForm(procedure: ProcedureMeta | null | undefined) {
  return {
    jurisdiction: procedure?.jurisdiction ?? "",
    handlingAgency: procedure?.handlingAgency ?? "",
    caseNumber: procedure?.caseNumber ?? "",
    presidingJudge: procedure?.presidingJudge ?? "",
    presidingJudgeContact: procedure?.presidingJudgeContact ?? "",
    judgeAssistant: procedure?.judgeAssistant ?? "",
    judgeAssistantContact: procedure?.judgeAssistantContact ?? "",
    ourStanding: (procedure?.ourStanding ?? "") as LitigationStanding | "",
    acceptedAt: toInputDate(procedure?.acceptedAt),
    concludedAt: toInputDate(procedure?.concludedAt)
  };
}

export function TeamEditorDialog({
  open,
  onOpenChange,
  matterId,
  matterMeta,
  currentProcedure,
  parties,
  currentOwnerId,
  currentMembers,
  userOptions,
  canEditMatterInfo,
  canManageTeam,
  canManageProcedure = false
}: Props) {
  const router = useRouter();
  const procedureStandingOptions = currentProcedure
    ? procedureToStandingOptions(currentProcedure.type, "ours")
    : [];
  const partyStandingOptions = currentProcedure
    ? standingOrder(currentProcedure.type, currentProcedure.procedureParties)
    : [];
  // 基本信息字段
  const [title, setTitle] = useState(matterMeta.title);
  const [causeId, setCauseId] = useState<string>(matterMeta.causeId ?? "");
  const [causeFreeText, setCauseFreeText] = useState(matterMeta.causeFreeText ?? "");
  const [claimAmount, setClaimAmount] = useState<string>(
    matterMeta.claimAmount === null ? "" : String(matterMeta.claimAmount)
  );
  const [ourStanding, setOurStanding] = useState<LitigationStanding | "">(
    matterMeta.ourStanding ?? ""
  );

  // 团队字段
  const [ownerId, setOwnerId] = useState(currentOwnerId);
  const [coLeads, setCoLeads] = useState<string[]>(
    currentMembers.filter((m) => m.role === "CO_LEAD").map((m) => m.userId)
  );
  const [assistants, setAssistants] = useState<string[]>(
    currentMembers.filter((m) => m.role === "ASSISTANT").map((m) => m.userId)
  );
  const [procedureForm, setProcedureForm] = useState(() => toProcedureForm(currentProcedure));
  const [procedureParties, setProcedureParties] = useState(() =>
    currentProcedure
      ? buildInitialProcedureParties(currentProcedure, parties, partyStandingOptions)
      : []
  );
  const [partyEdits, setPartyEdits] = useState<Record<string, PartyEditDraft>>(() =>
    Object.fromEntries(parties.map((party) => [party.id, partyToEditDraft(party)]))
  );
  const [newPartyForm, setNewPartyForm] = useState(() => initialNewPartyForm(partyStandingOptions));
  const [newProcedureParties, setNewProcedureParties] = useState<NewProcedurePartyDraft[]>([]);
  const [showNewPartyForm, setShowNewPartyForm] = useState(false);

  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      const nextPartyStandingOptions = currentProcedure
        ? standingOrder(currentProcedure.type, currentProcedure.procedureParties)
        : [];
      setTitle(matterMeta.title);
      setCauseId(matterMeta.causeId ?? "");
      setCauseFreeText(matterMeta.causeFreeText ?? "");
      setClaimAmount(matterMeta.claimAmount === null ? "" : String(matterMeta.claimAmount));
      setOurStanding(matterMeta.ourStanding ?? "");
      setOwnerId(currentOwnerId);
      setCoLeads(currentMembers.filter((m) => m.role === "CO_LEAD").map((m) => m.userId));
      setAssistants(currentMembers.filter((m) => m.role === "ASSISTANT").map((m) => m.userId));
      setProcedureForm(toProcedureForm(currentProcedure));
      setProcedureParties(
        currentProcedure
          ? buildInitialProcedureParties(currentProcedure, parties, nextPartyStandingOptions)
          : []
      );
      setPartyEdits(Object.fromEntries(parties.map((party) => [party.id, partyToEditDraft(party)])));
      setNewPartyForm(initialNewPartyForm(nextPartyStandingOptions));
      setNewProcedureParties([]);
      setShowNewPartyForm(false);
    }
  }, [open, matterMeta, currentOwnerId, currentMembers, currentProcedure, parties]);

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const availableStandings = standingsByCategory[matterMeta.category];
  const procedureLabel = currentProcedure
    ? currentProcedure.customLabel ?? procedureTypeLabel[currentProcedure.type]
    : "";
  const judgeLabel = currentProcedure ? procedureJudgeLabel(currentProcedure.type) : "主审法官";
  const procedureAgencyOptions = useMemo(
    () => agencyOptionsForProcedure(procedureForm.jurisdiction, currentProcedure?.type),
    [procedureForm.jurisdiction, currentProcedure?.type]
  );

  function setProcedureField<K extends keyof typeof procedureForm>(
    key: K,
    value: (typeof procedureForm)[K]
  ) {
    setProcedureForm((cur) => ({ ...cur, [key]: value }));
  }

  function handleJurisdictionChange(value: string) {
    setProcedureForm((cur) => ({
      ...cur,
      jurisdiction: value,
      handlingAgency:
        isNationalAgency(cur.handlingAgency) ||
        !isAgencyAllowedForProcedure(cur.handlingAgency, currentProcedure?.type)
          ? ""
          : cur.handlingAgency
    }));
  }

  function handleHandlingAgencyChange(value: string) {
    setProcedureForm((cur) => ({
      ...cur,
      handlingAgency: value,
      jurisdiction: isNationalAgency(value) ? "" : cur.jurisdiction
    }));
  }

  function toggleProcedureParty(partyId: string, standing: LitigationStanding, checked: boolean) {
    setProcedureParties((rows) => {
      const next = rows.filter((row) => !(row.partyId === partyId && row.standing === standing));
      return checked ? [...next, { partyId, standing }] : next;
    });
  }

  function hasProcedureStanding(partyId: string, standing: LitigationStanding) {
    return procedureParties.some((row) => row.partyId === partyId && row.standing === standing);
  }

  function setPartyEditValue<K extends keyof PartyEditDraft>(
    partyId: string,
    key: K,
    value: PartyEditDraft[K]
  ) {
    setPartyEdits((cur) => ({
      ...cur,
      [partyId]: {
        ...cur[partyId],
        [key]: value
      }
    }));
  }

  function setNewPartyFormValue<K extends keyof typeof newPartyForm>(
    key: K,
    value: (typeof newPartyForm)[K]
  ) {
    setNewPartyForm((cur) => ({ ...cur, [key]: value }));
  }

  function toggleNewPartyFormStanding(standing: LitigationStanding, checked: boolean) {
    setNewPartyForm((cur) => ({
      ...cur,
      standings: checked
        ? [...new Set([...cur.standings, standing])]
        : cur.standings.filter((s) => s !== standing)
    }));
  }

  function toggleNewDraftStanding(tempId: string, standing: LitigationStanding, checked: boolean) {
    setNewProcedureParties((rows) =>
      rows.map((row) =>
        row.tempId === tempId
          ? {
              ...row,
              standings: checked
                ? [...new Set([...row.standings, standing])]
                : row.standings.filter((s) => s !== standing)
            }
          : row
      )
    );
  }

  function handleNewPartyNameChange(name: string) {
    const matchedParty = parties.find((party) => party.name.trim() === name.trim());
    setNewPartyForm((cur) => {
      if (!matchedParty) return { ...cur, existingPartyId: null, name };
      return {
        ...cur,
        existingPartyId: matchedParty.id,
        name,
        role: normalizePartyRoleForForm(matchedParty.role),
        partyType: normalizePartyTypeForForm(matchedParty.partyType),
        idNumber: matchedParty.idNumber ?? "",
        enterpriseSocialCode: matchedParty.enterpriseSocialCode ?? ""
      };
    });
  }

  function addNewProcedureParty() {
    const name = newPartyForm.name.trim();
    if (!name) {
      toast.error("请填写当事人名称");
      return;
    }
    if (newPartyForm.standings.length === 0) {
      toast.error("请选择程序地位");
      return;
    }
    if (newPartyForm.partyType === "NATURAL_PERSON" && !newPartyForm.idNumber.trim()) {
      toast.error("请填写证件号");
      return;
    }
    if (newPartyForm.partyType !== "NATURAL_PERSON" && !newPartyForm.enterpriseSocialCode.trim()) {
      toast.error("请填写统一社会信用代码");
      return;
    }
    setNewProcedureParties((rows) => [
      ...rows,
      {
        tempId: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        existingPartyId: newPartyForm.existingPartyId,
        name,
        role: newPartyForm.role,
        partyType: newPartyForm.partyType,
        idNumber: newPartyForm.idNumber.trim(),
        enterpriseSocialCode: newPartyForm.enterpriseSocialCode.trim(),
        standings: newPartyForm.standings
      }
    ]);
    setNewPartyForm((cur) => ({
      ...cur,
      existingPartyId: null,
      name: "",
      idNumber: "",
      enterpriseSocialCode: ""
    }));
    setShowNewPartyForm(false);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        if (canEditMatterInfo) {
          if (!title.trim()) {
            toast.error("案件名称不能为空");
            return;
          }
          const parsedAmount = claimAmount.trim() === "" ? null : Number(claimAmount);
          if (parsedAmount !== null && (isNaN(parsedAmount) || parsedAmount < 0)) {
            toast.error("标的额格式有误");
            return;
          }

          await updateMatterBasicInfo({
            id: matterId,
            title,
            causeId: causeId || "",
            causeFreeText: causeFreeText || "",
            claimAmount: parsedAmount,
            ourStanding: ourStanding || null
          });
        }

        if (canManageTeam) {
          await updateMatterTeam({
            matterId,
            ownerId,
            coLeadIds: coLeads,
            assistantIds: assistants
          });
        }

        if (currentProcedure && canManageProcedure) {
          if (newProcedureParties.some((party) => party.standings.length === 0)) {
            toast.error("新增当事人需至少选择一个程序地位");
            return;
          }
          if (!isAgencyAllowedForProcedure(procedureForm.handlingAgency, currentProcedure.type)) {
            toast.error("商事仲裁程序不能选择法院作为管辖机构", {
              description: "撤裁、强制执行、不予执行审查等后续程序仍可选择法院。"
            });
            return;
          }
          await updateProcedureInfo({
            procedureId: currentProcedure.id,
            jurisdiction: procedureForm.jurisdiction,
            handlingAgency: procedureForm.handlingAgency,
            caseNumber: procedureForm.caseNumber,
            presidingJudge: procedureForm.presidingJudge,
            presidingJudgeContact: procedureForm.presidingJudgeContact,
            judgeAssistant: procedureForm.judgeAssistant,
            judgeAssistantContact: procedureForm.judgeAssistantContact,
            ourStanding: procedureForm.ourStanding || null,
            acceptedAt: procedureForm.acceptedAt || null,
            concludedAt: procedureForm.concludedAt || null,
            procedureParties,
            updatedParties: Object.values(partyEdits)
              .filter((party) => !party.partyId.startsWith("client:"))
              .map((party) => ({
                partyId: party.partyId,
                name: party.name,
                role: party.role,
                partyType: party.partyType,
                idNumber: party.idNumber,
                enterpriseSocialCode: party.enterpriseSocialCode,
                legalRep: party.legalRep,
                contactName: party.contactName,
                phone: party.phone,
                address: party.address
              })),
            newProcedureParties: newProcedureParties.map(
              ({ existingPartyId, name, role, partyType, idNumber, enterpriseSocialCode, standings }) => ({
                existingPartyId,
                name,
                role,
                partyType,
                idNumber,
                enterpriseSocialCode,
                standings
              })
            )
          });
        }

        toast.success("案件信息已更新");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("更新失败", {
          description: err instanceof Error ? err.message : ""
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[92vw] max-w-[720px] flex-col gap-0 overflow-hidden bg-[#EEF2F6] p-0">
        <DialogHeader className="border-b border-border bg-card px-5 py-4">
          <DialogTitle>编辑案件信息</DialogTitle>
          <DialogDescription className="text-xs">
            收案日期、类别不可修改；案件基础信息和当前程序信息在同一处维护。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(86vh-128px)] space-y-4 overflow-y-auto bg-[#EEF2F6] px-5 py-4">
          {/* readonly 行 */}
          <section className="grid grid-cols-2 gap-2 rounded-md border border-border bg-[#F4F7FB] px-3 py-2 text-xs shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)]">
            <div>
              <div className="text-[10px] text-muted-foreground">收案日</div>
              <div>{matterMeta.intakeDate ? formatDate(matterMeta.intakeDate) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">类别</div>
              <div>{matterCategoryLabel[matterMeta.category]}</div>
            </div>
          </section>

          {canEditMatterInfo && (
            <section className={formSectionClass}>
              <SectionTitle>案件基础信息</SectionTitle>

              <div className="space-y-1.5">
                <Label className={formLabelClass}>案件名称</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="案件名称（保存时自动去除空格）"
                  className={formControlClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>案由</Label>
                  <CauseCombobox
                    category={matterMeta.category}
                    procedureType={currentProcedure?.type}
                    value={causeId}
                    onChange={(id) => setCauseId(id)}
                    triggerClassName={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>自由文本案由（不在标准库时填）</Label>
                  <Input
                    value={causeFreeText}
                    onChange={(e) => setCauseFreeText(e.target.value)}
                    className={formControlClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>标的额（元）</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    placeholder="非金钱标的留空"
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>我方诉讼地位</Label>
                  <Select
                    value={ourStanding || ""}
                    onValueChange={(v) => setOurStanding(v as LitigationStanding | "")}
                  >
                    <SelectTrigger className={formControlClass}>
                      <SelectValue placeholder="选择地位" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStandings.map((s) => (
                        <SelectItem key={s} value={s}>
                          {litigationStandingLabel[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
          )}

          {currentProcedure && canManageProcedure && (
            <section className={formSectionClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>当前程序信息</SectionTitle>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {procedureLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>管辖地（省/市/区县）</Label>
                  <JurisdictionSelect
                    value={procedureForm.jurisdiction}
                    onChange={handleJurisdictionChange}
                    triggerClassName={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>管辖机构</Label>
                  <Input
                    list={`matter-info-agency-${currentProcedure.id}`}
                    value={procedureForm.handlingAgency}
                    onChange={(e) => handleHandlingAgencyChange(e.target.value)}
                    placeholder="如：最高人民法院 / 广州市天河区人民法院"
                    className={formControlClass}
                  />
                  <datalist id={`matter-info-agency-${currentProcedure.id}`}>
                    {procedureAgencyOptions.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>案号</Label>
                  <Input
                    value={procedureForm.caseNumber}
                    onChange={(e) => setProcedureField("caseNumber", e.target.value)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>我方程序地位</Label>
                  <Select
                    value={procedureForm.ourStanding || ""}
                    onValueChange={(v) => setProcedureField("ourStanding", v as LitigationStanding | "")}
                  >
                    <SelectTrigger className={formControlClass}>
                      <SelectValue placeholder="选择地位" />
                    </SelectTrigger>
                    <SelectContent>
                      {procedureStandingOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {litigationStandingLabel[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>{judgeLabel}</Label>
                  <Input
                    value={procedureForm.presidingJudge}
                    onChange={(e) => setProcedureField("presidingJudge", e.target.value)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>{judgeLabel}联系方式</Label>
                  <Input
                    value={procedureForm.presidingJudgeContact}
                    onChange={(e) => setProcedureField("presidingJudgeContact", e.target.value)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>书记员</Label>
                  <Input
                    value={procedureForm.judgeAssistant}
                    onChange={(e) => setProcedureField("judgeAssistant", e.target.value)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>书记员联系方式</Label>
                  <Input
                    value={procedureForm.judgeAssistantContact}
                    onChange={(e) => setProcedureField("judgeAssistantContact", e.target.value)}
                    className={cn(formControlClass, "font-mono")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>立案时间</Label>
                  <Input
                    type="date"
                    value={procedureForm.acceptedAt}
                    onChange={(e) => setProcedureField("acceptedAt", e.target.value)}
                    className={formControlClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={formLabelClass}>裁决 / 结案时间</Label>
                  <Input
                    type="date"
                    value={procedureForm.concludedAt}
                    onChange={(e) => setProcedureField("concludedAt", e.target.value)}
                    className={formControlClass}
                  />
                </div>
              </div>
            </section>
          )}

          {currentProcedure && canManageProcedure && (
            <section className={formSectionClass}>
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>当前程序当事人</SectionTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewPartyForm((visible) => !visible)}
                  className="h-7 gap-1.5 px-2 text-xs"
                >
                  {showNewPartyForm ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {showNewPartyForm ? "收起" : "添加"}
                </Button>
              </div>

              {parties.length === 0 ? (
                <div className={cn(nestedPanelClass, "px-3 py-2 text-xs text-muted-foreground")}>
                  暂无案件当事人
                </div>
              ) : (
                <div className={cn(nestedPanelClass, "max-h-[440px] overflow-y-auto")}>
                  {parties.map((party) => {
                    const draft = partyEdits[party.id] ?? partyToEditDraft(party);
                    const isOrg = draft.partyType !== "NATURAL_PERSON";
                    return (
                      <div key={party.id} className="space-y-2 border-t border-[#E2E7EF] p-2.5 first:border-t-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-xs font-medium" title={draft.name}>
                            {draft.name || "—"}
                          </span>
                          {party.standing && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {litigationStandingLabel[normalizeStandingForUi(party.standing)]}
                            </span>
                          )}
                          {party.role === "CLIENT_PARTY" && (
                            <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1 py-0 text-[10px] font-medium leading-4 text-primary">
                              客户
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-2">
                          {partyStandingOptions.map((standing) => (
                            <label
                              key={`${party.id}-${standing}`}
                              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                            >
                              <Checkbox
                                checked={hasProcedureStanding(party.id, standing)}
                                onCheckedChange={(checked) =>
                                  toggleProcedureParty(party.id, standing, checked === true)
                                }
                              />
                              <span>{litigationStandingLabel[standing]}</span>
                            </label>
                          ))}
                        </div>
                        <div className="rounded-md border border-[#E2E7EF] bg-[#F6F8FB] p-2">
                          <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                            主体基础信息
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>名称</Label>
                              <Input
                                value={draft.name}
                                onChange={(e) => setPartyEditValue(party.id, "name", e.target.value)}
                                className={formControlClass}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>当事人角色</Label>
                              <Select
                                value={draft.role}
                                onValueChange={(v) => setPartyEditValue(party.id, "role", v as PartyRole)}
                              >
                                <SelectTrigger className={formControlClass}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PARTY_ROLE_OPTIONS.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {PARTY_ROLE_LABEL[role]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>主体类型</Label>
                              <Select
                                value={draft.partyType}
                                onValueChange={(v) => setPartyEditValue(party.id, "partyType", v as PartyType)}
                              >
                                <SelectTrigger className={formControlClass}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PARTY_TYPE_OPTIONS.map((partyType) => (
                                    <SelectItem key={partyType} value={partyType}>
                                      {partyTypeLabel[partyType]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>
                                {isOrg ? "统一社会信用代码" : "证件号码"}
                              </Label>
                              <Input
                                className={cn(formControlClass, "font-mono")}
                                value={isOrg ? draft.enterpriseSocialCode : draft.idNumber}
                                onChange={(e) =>
                                  setPartyEditValue(
                                    party.id,
                                    isOrg ? "enterpriseSocialCode" : "idNumber",
                                    e.target.value
                                  )
                                }
                              />
                            </div>
                            {isOrg && (
                              <div className="space-y-1.5">
                                <Label className={formLabelClass}>法定代表人</Label>
                                <Input
                                  value={draft.legalRep}
                                  onChange={(e) => setPartyEditValue(party.id, "legalRep", e.target.value)}
                                  className={formControlClass}
                                />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>联系人</Label>
                              <Input
                                value={draft.contactName}
                                onChange={(e) => setPartyEditValue(party.id, "contactName", e.target.value)}
                                className={formControlClass}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className={formLabelClass}>联系方式</Label>
                              <Input
                                className={cn(formControlClass, "font-mono")}
                                value={draft.phone}
                                onChange={(e) => setPartyEditValue(party.id, "phone", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label className={formLabelClass}>地址</Label>
                              <Input
                                value={draft.address}
                                onChange={(e) => setPartyEditValue(party.id, "address", e.target.value)}
                                className={formControlClass}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {newProcedureParties.length > 0 && (
                <div className={nestedPanelClass}>
                  {newProcedureParties.map((party) => (
                    <div key={party.tempId} className="border-t border-[#E2E7EF] p-2 first:border-t-0">
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-xs font-medium" title={party.name}>
                          {party.name}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {PARTY_ROLE_LABEL[party.role]} · {partyTypeLabel[party.partyType]}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {party.partyType === "NATURAL_PERSON"
                            ? party.idNumber
                            : party.enterpriseSocialCode}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewProcedureParties((rows) =>
                              rows.filter((row) => row.tempId !== party.tempId)
                            )
                          }
                          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
                          title="移除"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {partyStandingOptions.map((standing) => (
                          <label
                            key={`${party.tempId}-${standing}`}
                            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                          >
                            <Checkbox
                              checked={party.standings.includes(standing)}
                              onCheckedChange={(checked) =>
                                toggleNewDraftStanding(party.tempId, standing, checked === true)
                              }
                            />
                            <span>{litigationStandingLabel[standing]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showNewPartyForm && (
                <div className="rounded-md border border-dashed border-[#B8C5D6] bg-[#F6F8FB] p-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_120px_120px_minmax(0,1fr)_auto]">
                    <Input
                      list={`matter-editor-new-party-${currentProcedure.id}`}
                      value={newPartyForm.name}
                      onChange={(e) => handleNewPartyNameChange(e.target.value)}
                      placeholder="新增当事人名称"
                      className={cn(formControlClass, "h-8 text-xs")}
                    />
                    <datalist id={`matter-editor-new-party-${currentProcedure.id}`}>
                      {parties.map((party) => (
                        <option key={party.id} value={party.name} />
                      ))}
                    </datalist>
                    <Select
                      value={newPartyForm.role}
                      onValueChange={(v) => setNewPartyFormValue("role", v as PartyRole)}
                    >
                      <SelectTrigger className={cn(formControlClass, "h-8 text-xs")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTY_ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role} value={role}>
                            {PARTY_ROLE_LABEL[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={newPartyForm.partyType}
                      onValueChange={(v) => setNewPartyFormValue("partyType", v as PartyType)}
                    >
                      <SelectTrigger className={cn(formControlClass, "h-8 text-xs")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTY_TYPE_OPTIONS.map((partyType) => (
                          <SelectItem key={partyType} value={partyType}>
                            {partyTypeLabel[partyType]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={
                        newPartyForm.partyType === "NATURAL_PERSON"
                          ? newPartyForm.idNumber
                          : newPartyForm.enterpriseSocialCode
                      }
                      onChange={(e) =>
                        newPartyForm.partyType === "NATURAL_PERSON"
                          ? setNewPartyFormValue("idNumber", e.target.value)
                          : setNewPartyFormValue("enterpriseSocialCode", e.target.value)
                      }
                      placeholder={
                        newPartyForm.partyType === "NATURAL_PERSON"
                          ? "证件号"
                          : "统一社会信用代码"
                      }
                      className={cn(formControlClass, "h-8 text-xs")}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addNewProcedureParty}
                      className="h-8 px-2 text-xs"
                    >
                      确认添加
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                    {partyStandingOptions.map((standing) => (
                      <label
                        key={`new-form-${standing}`}
                        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <Checkbox
                          checked={newPartyForm.standings.includes(standing)}
                          onCheckedChange={(checked) =>
                            toggleNewPartyFormStanding(standing, checked === true)
                          }
                        />
                        <span>{litigationStandingLabel[standing]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 团队 */}
          {canManageTeam && (
            <section className={formSectionClass}>
              <SectionTitle>承办团队</SectionTitle>

              <div className="space-y-1.5">
                <Label className={formLabelClass}>主办律师</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger className={formControlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {userOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} · {userRoleLabel[u.role as keyof typeof userRoleLabel] ?? u.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className={formLabelClass}>协办律师（可多选）</Label>
                <div className="grid grid-cols-1 gap-2 rounded-md border border-[#D9E0EA] bg-white p-2.5 sm:grid-cols-2">
                  {userOptions
                    .filter((u) => u.id !== ownerId)
                    .map((u) => (
                      <label
                        key={u.id}
                        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Checkbox
                          checked={coLeads.includes(u.id)}
                          onCheckedChange={() => toggle(coLeads, setCoLeads, u.id)}
                        />
                        <span>{u.name}</span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={formLabelClass}>助理（可多选）</Label>
                <div className="grid grid-cols-1 gap-2 rounded-md border border-[#D9E0EA] bg-white p-2.5 sm:grid-cols-2">
                  {userOptions
                    .filter((u) => u.id !== ownerId && !coLeads.includes(u.id))
                    .map((u) => (
                      <label
                        key={u.id}
                        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Checkbox
                          checked={assistants.includes(u.id)}
                          onCheckedChange={() => toggle(assistants, setAssistants, u.id)}
                        />
                        <span>{u.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-card px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
