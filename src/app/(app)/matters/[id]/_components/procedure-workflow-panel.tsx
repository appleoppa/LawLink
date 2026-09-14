"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  BookOpen,
  CalendarClock,
  Check,
  CircleDollarSign,
  FileCheck2,
  FileText,
  FolderOpen,
  Gavel,
  Landmark,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  Scale,
  ScrollText,
  Shield,
  Sparkles,
  Upload
} from "lucide-react";
import type {
  DeadlineCategory,
  DocumentCategory,
  DocumentSourceOrigin,
  GuaranteeType,
  LitigationStanding,
  PreservationStatus,
  PreservationType,
  ProcedureType
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadDocument } from "@/server/documents/actions";
import { createTask, toggleTaskCompleted } from "@/server/tasks/actions";
import { createProcedureStage, ensureProcedureStage, removeProcedureStage } from "@/server/procedures/actions";
import { AddDeadlineDialog } from "./procedure-forms";
import { liftProperty } from "@/server/preservations/actions-v2";
import { cn, daysUntil, formatCurrency, formatDate } from "@/lib/utils";
import { litigationStandingLabel, procedureTypeLabel } from "@/lib/enums";
import {
  defaultStageNamesForProcedure,
  normalizeProcedureStageName,
  procedureStagePresetsForProcedure,
  stagePresetForName,
  type StagePresetKind
} from "@/lib/procedure-stage-defaults";
import { canPreview, officePreviewKind } from "@/lib/storage/mime-ext";
import {
  PreservationCaseDialog,
  AddTargetDialog,
  AddPropertyDialog,
  RenewPropertyDialog
} from "@/app/(app)/preservation/_components/preservation-dialog";
import {
  GUARANTEE_TYPE_CN,
  PRES_STATUS_CN,
  PRES_STATUS_COLOR,
  PRES_TYPE_CN,
  PROPERTY_TYPE_CN,
  classifyExpiry,
  type MatterOption,
  type UserOption
} from "@/app/(app)/preservation/_components/preservation-types";
import { TemplatePickerDialog } from "./template-picker-dialog";
import { DocIcon, EmptyState, ProcedureChain, SourceChip, type ChainNode } from "@/components/patterns/moan";
import { documentSourceChip } from "@/lib/ui/moan-tones";
import type { FolderPayload, TemplateSummary } from "./folder-types";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useDocActions } from "./doc-actions-context";

type WorkflowTask = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  completed: boolean;
  completedAt: Date | null;
  priority: number;
  stageId: string | null;
  assigneeId: string | null;
};

type WorkflowStageSource = {
  id: string;
  name: string;
  description: string | null;
  order: number;
  status: "ACTIVE" | "HIDDEN";
  startedAt: Date | null;
  completedAt: Date | null;
  tasks: WorkflowTask[];
};

type WorkflowDeadline = {
  id: string;
  title: string;
  category: DeadlineCategory;
  dueAt: Date;
  basis: string | null;
  remindDays: number;
  completed: boolean;
  confirmStatus?: "PENDING" | "CONFIRMED" | "ADJUSTED";
};

type WorkflowHearing = {
  id: string;
  title: string;
  room: string | null;
  address: string | null;
  startsAt: Date;
};

type WorkflowProcedure = {
  id: string;
  type: ProcedureType;
  customLabel: string | null;
  caseNumber: string | null;
  acceptedAt: Date | null;
  concludedAt: Date | null;
  status: "PENDING" | "IN_PROGRESS" | "CONCLUDED";
  stages: WorkflowStageSource[];
  deadlines: WorkflowDeadline[];
  hearings: WorkflowHearing[];
  procedureParties: {
    id: string;
    standing: LitigationStanding;
    ordinal: number;
    party: { id: string; name: string };
  }[];
};

type WorkflowDocument = {
  id: string;
  name: string;
  category: DocumentCategory;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
  sourceParty: string | null;
  path: string;
  tags: string[];
  stageId: string | null;
  sourceOrigin: DocumentSourceOrigin | null;
  ocrStatus: "PENDING" | "READY" | "FAILED" | "SKIP" | null;
  textSource: "DOCX" | "PDF_TEXT" | "OCR" | "MANUAL" | null;
  pageCount: number | null;
  sha256: string | null;
  templateId: string | null;
  version: number | null;
};

type WorkflowMatter = {
  id: string;
  internalCode: string;
  title: string;
  category: string;
};

export type WorkflowPreservationCase = {
  id: string;
  matterId: string | null;
  type: PreservationType;
  status: PreservationStatus;
  court: string | null;
  rulingNumber: string | null;
  guaranteeType: GuaranteeType | null;
  appliedAt: Date | null;
  note: string | null;
  ownerId: string | null;
  remindDays: number[];
  createdAt: Date;
  updatedAt: Date;
  matter: { id: string; internalCode: string; title: string } | null;
  owner: { id: string; name: string } | null;
  targets: {
    id: string;
    caseId: string;
    name: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    properties: {
      id: string;
      targetId: string;
      propertyType: keyof typeof PROPERTY_TYPE_CN;
      propertyDetail: string | null;
      amount: number | null;
      startDate: Date;
      duration: number;
      expiryDate: Date;
      status: PreservationStatus;
      createdAt: Date;
      updatedAt: Date;
      renewals: {
        id: string;
        propertyId: string;
        renewedAt: Date;
        oldExpiryDate: Date;
        newExpiryDate: Date;
        renewalDuration: number;
        note: string | null;
        performedById: string;
        createdAt: Date;
      }[];
    }[];
  }[];
};

type WorkflowStageStatus = "done" | "active" | "risk" | "todo" | "not_applicable";

type WorkflowStage = {
  key: string;
  id: string | null;
  name: string;
  kind: "normal" | "preservation";
  presetKind: StagePresetKind | "custom";
  removable: boolean;
  status: WorkflowStageStatus;
  tasks: WorkflowTask[];
  /** v1.1 UI（方案 E）：导航徽标——任务数 / 临期倒计时 / 开庭日期 */
  badge: { text: string; hot: boolean } | null;
};

type MatterInfoWorkflowItem = {
  key: "matter-info";
  id: null;
  name: "信息总览";
  kind: "matter_info";
  status: "active";
  tasks: [];
};

type WorkflowItem = MatterInfoWorkflowItem | WorkflowStage;

type StageGuide = {
  summary: string;
  checklistTitle: string;
  checklist: string[];
  actions: string[];
  deadlineCategories: DeadlineCategory[];
  includeHearings?: boolean;
  materialCategories: DocumentCategory[];
  materialPattern: RegExp;
  defaultCategory: DocumentCategory;
};

const MATTER_INFO_ITEM: MatterInfoWorkflowItem = {
  key: "matter-info",
  id: null,
  name: "信息总览",
  kind: "matter_info",
  status: "active",
  tasks: []
};

const PRESERVATION_ACTIONS = [
  "财产保全申请书",
  "财产线索清单",
  "担保书/保函",
  "网络查控申请书",
  "保全费缴费凭证",
  "续封申请书",
  "解除保全申请书",
  "保全复议申请书"
];

const DEFAULT_STAGE_GUIDE: StageGuide = {
  summary: "记录本阶段的任务、文件和沟通结果，作为当前程序的工作留痕。",
  checklistTitle: "本环节事项",
  checklist: ["明确阶段目标和交付物", "记录当事人或法院沟通要点", "归集本阶段形成的材料"],
  actions: ["阶段工作底稿", "补充说明"],
  deadlineCategories: [],
  materialCategories: [],
  materialPattern: /阶段|说明|记录|底稿|工作/,
  defaultCategory: "PROCEDURE"
};

const STAGE_GUIDES: { keys: string[]; guide: StageGuide }[] = [
  {
    keys: ["代理授权", "委托手续"],
    guide: {
      summary: "办理代理合同、授权文件、律所手续、风险告知、费用到账和材料交接留痕。",
      checklistTitle: "委托手续",
      checklist: [
        "核对委托人身份和签章主体",
        "签署委托代理合同、授权委托书、所函",
        "完成风险告知、工作联系函和材料交接留痕",
        "确认律师费到账、发票和原件移交记录"
      ],
      actions: ["委托代理合同", "授权委托书", "律所函", "风险告知书", "工作联系函", "证据原件交接单"],
      deadlineCategories: [],
      materialCategories: ["CONTRACT"],
      materialPattern: /授权|委托|所函|律所函|风险告知|联系函|发票|签收|交接/,
      defaultCategory: "CONTRACT"
    }
  },
  {
    keys: ["财产保全"],
    guide: {
      summary: "围绕保全申请、担保、缴费、裁定、续封和解除组织材料。",
      checklistTitle: "保全事项",
      checklist: [
        "确认保全范围、财产线索和担保方式",
        "提交保全申请、担保书/保函和财产线索",
        "跟进缴费、裁定、查封冻结结果和首封情况",
        "记录保全期限并提前安排续保或解除"
      ],
      actions: PRESERVATION_ACTIONS,
      deadlineCategories: ["PRESERVATION"],
      materialCategories: [],
      materialPattern: /保全|财产线索|担保|保函|查封|冻结|续封|续保|解除|裁定|协助执行/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["案情研判", "材料消化", "诉讼方案", "二审阅卷研判"],
    guide: {
      summary: "消化基础材料，形成事实摘要、证据缺口、法律检索和诉讼代理方案。",
      checklistTitle: "研判事项",
      checklist: [
        "梳理案件事实、法律关系、争议焦点",
        "核对证据原件或扫描件，列出缺漏清单",
        "完成法律法规、案例和司法观点检索",
        "向当事人确认关键事实和诉讼方案"
      ],
      actions: ["案件事实摘要", "法律关系图", "证据缺口清单", "法律检索报告", "诉讼代理方案"],
      deadlineCategories: [],
      materialCategories: [],
      materialPattern: /摘要|法律关系|检索|方案|证据缺口|材料清单|事实梳理/,
      defaultCategory: "OTHER"
    }
  },
  {
    keys: ["执行立案"],
    guide: {
      summary: "准备强制执行申请材料，确认生效、履行期限和执行法院立案要求。",
      checklistTitle: "执行立案事项",
      checklist: [
        "确认裁判文书已生效且履行期限届满",
        "准备强制执行申请书、生效文书和身份材料",
        "补齐申请人账户确认书、送达地址确认书和委托手续",
        "立案后一周内跟进承办法官联系方式"
      ],
      actions: ["强制执行申请书", "生效证明", "申请人账号确认书", "送达地址确认书", "执行立案材料清单"],
      deadlineCategories: ["PERFORMANCE", "ENFORCEMENT"],
      materialCategories: [],
      materialPattern: /执行申请|强制执行|生效|履行|账号确认|送达地址/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["起诉立案", "仲裁立案"],
    guide: {
      summary: "完成起诉或仲裁申请材料、主体身份、管辖依据、证据目录、缴费和诉调跟进。",
      checklistTitle: "立案事项",
      checklist: [
        "确认请求标的、管辖法院或仲裁机构",
        "整理起诉状/仲裁申请、身份材料、授权手续和证据目录",
        "核对被告身份、送达信息、管辖材料和保全材料",
        "跟进立案审查、诉调转立案和诉讼费/仲裁费缴纳"
      ],
      actions: ["民事起诉状", "仲裁申请书", "证据目录", "送达地址确认书", "诉讼费缴费凭证", "立案材料清单"],
      deadlineCategories: ["LIMITATION"],
      materialCategories: [],
      materialPattern: /起诉|仲裁申请|立案|证据目录|送达地址|诉讼费|仲裁费|管辖材料/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["管辖异议", "管辖权异议"],
    guide: {
      summary: "处理对方管辖异议、答辩、裁定签收和异议上诉/答辩衔接。",
      checklistTitle: "管辖事项",
      checklist: [
        "签收并研判对方管辖权异议理由",
        "提交管辖权异议答辩意见及证据",
        "跟进裁定结果并告知当事人",
        "在上诉期内处理异议上诉或二审答辩"
      ],
      actions: ["管辖权异议答辩意见", "管辖权异议申请书", "管辖异议上诉状", "管辖异议裁定签收记录"],
      deadlineCategories: ["APPEAL", "RESPONSE"],
      materialCategories: [],
      materialPattern: /管辖|异议|移送|裁定|上诉/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["举证质证"],
    guide: {
      summary: "围绕举证期限、补充证据、调查令、鉴定、证人出庭和对方证据质证组织工作。",
      checklistTitle: "举证事项",
      checklist: [
        "记录举证通知签收日并计算举证期限",
        "复核全案材料，确认补充证据和反驳证据",
        "评估调查令、法院调查取证、鉴定和证人出庭申请",
        "收到对方证据后与当事人核实真实性并形成质证意见"
      ],
      actions: ["证据目录", "补充证据清单", "质证意见", "调查取证申请书", "证人出庭申请书"],
      deadlineCategories: ["EVIDENCE"],
      materialCategories: ["EVIDENCE"],
      materialPattern: /证据|举证|质证|调查令|调查取证|证人|反驳证据/,
      defaultCategory: "EVIDENCE"
    }
  },
  {
    keys: ["鉴定申请", "司法鉴定"],
    guide: {
      summary: "判断是否申请鉴定、提出鉴定事项、异议、补充材料和专家辅助人安排。",
      checklistTitle: "鉴定事项",
      checklist: [
        "确认鉴定必要性、鉴定事项和证明目的",
        "准备鉴定申请、样本材料和费用沟通",
        "处理鉴定机构、鉴定材料和鉴定意见异议",
        "需要时安排专家辅助人出庭"
      ],
      actions: ["鉴定申请书", "鉴定材料清单", "鉴定异议书", "专家辅助人出庭申请书"],
      deadlineCategories: ["EVIDENCE"],
      materialCategories: [],
      materialPattern: /鉴定|专家|辅助人|样本|检材/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["庭前会议"],
    guide: {
      summary: "处理庭前会议通知、争点归纳、证据交换、程序事项和庭审安排。",
      checklistTitle: "庭前会议事项",
      checklist: [
        "确认庭前会议时间、地点、参加人员和会议目的",
        "准备争议焦点、证据交换意见和程序性申请",
        "记录法院或仲裁庭确认的审理范围和举证安排",
        "根据会议结果修订庭审提纲和证据组织方案"
      ],
      actions: ["庭前会议提纲", "争议焦点清单", "证据交换意见", "程序事项申请书", "庭前会议记录"],
      deadlineCategories: ["EVIDENCE", "CUSTOM"],
      includeHearings: true,
      materialCategories: [],
      materialPattern: /庭前会议|争议焦点|证据交换|程序事项|会议记录/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["模拟法庭"],
    guide: {
      summary: "围绕庭审争点、发问路径、攻防预案和客户出庭表现做正式开庭前演练。",
      checklistTitle: "模拟事项",
      checklist: [
        "形成争点清单和证明责任分配表",
        "准备我方发问、反问和对方可能追问清单",
        "演练法庭调查、法庭辩论和最后陈述",
        "记录演练暴露的问题并修订庭审提纲"
      ],
      actions: ["模拟法庭脚本", "争点攻防清单", "发问提纲", "客户庭前沟通记录", "庭审风险提示"],
      deadlineCategories: [],
      materialCategories: [],
      materialPattern: /模拟法庭|攻防|发问|反问|演练|庭审风险|庭前沟通/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["开庭准备", "开庭/询问", "开庭审理"],
    guide: {
      summary: "围绕开庭通知、证据原件、庭审提纲、质证意见、发问提纲和客户庭前沟通做准备。",
      checklistTitle: "庭前事项",
      checklist: [
        "确认开庭时间、地点、法庭和书记员联系方式",
        "核对证据原件、对方证据和是否变更诉请",
        "准备庭审提纲、发问提纲、质证意见和代理词提纲",
        "向当事人交代出庭材料、庭审流程和注意事项"
      ],
      actions: ["庭审提纲", "发问提纲", "质证意见", "代理词提纲", "庭前沟通记录"],
      deadlineCategories: [],
      includeHearings: true,
      materialCategories: [],
      materialPattern: /开庭|庭审|传票|发问|提纲|质证|原件|代理词/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["庭后工作", "庭后代理词", "庭后补充"],
    guide: {
      summary: "庭后复盘并提交代理意见、补充材料，向客户汇报并持续跟进裁判进度。",
      checklistTitle: "庭后事项",
      checklist: [
        "庭后向当事人汇报庭审情况并留痕",
        "提交代理词、质证意见、法律检索报告或补充意见",
        "按庭审要求核实事实、补交材料或移交证据原件",
        "联系法官或书记员跟进裁判进度"
      ],
      actions: ["开庭报告", "代理词", "庭后补充意见", "书面质证意见", "法律检索报告"],
      deadlineCategories: ["EVIDENCE", "CUSTOM"],
      materialCategories: [],
      materialPattern: /代理词|庭后|补充意见|开庭报告|质证意见|检索报告|笔录/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["裁判/上诉", "裁判签收", "二审裁判", "仲裁裁决", "执行结案"],
    guide: {
      summary: "签收裁判或裁决文书，计算上诉期/履行期，处理生效、退费、履行和后续程序提示。",
      checklistTitle: "裁判事项",
      checklist: [
        "记录裁判文书签收日并计算上诉期或撤裁期限",
        "向当事人汇报裁判结果并确认是否上诉、撤裁或履行",
        "处理文书更正、生效证明、诉讼费退费和保全解除",
        "跟进对方履行并提示需要另行新建执行程序的情形"
      ],
      actions: ["裁判结果报告", "上诉期告知函", "结案报告", "生效证明申请", "履行衔接清单"],
      deadlineCategories: ["APPEAL", "PERFORMANCE", "ARBITRATION_SET_ASIDE", "ENFORCEMENT"],
      materialCategories: ["JUDGMENT"],
      materialPattern: /判决|裁定|裁决|调解书|上诉|生效|履行|退费|结案|后续程序/,
      defaultCategory: "JUDGMENT"
    }
  },
  {
    keys: ["案件归档"],
    guide: {
      summary: "完成结案报告、材料完整性核对、原件退还、费用结清和归档申请。",
      checklistTitle: "归档事项",
      checklist: [
        "确认裁判、裁决、调解或执行结果已形成最终留痕",
        "核对委托手续、程序材料、证据材料和往来记录是否完整",
        "完成结案报告、客户交接、原件退还和费用结清",
        "提交归档申请并处理补正意见"
      ],
      actions: ["结案报告", "归档材料清单", "原件退还确认书", "客户结案告知函", "归档申请"],
      deadlineCategories: [],
      materialCategories: ["PROCEDURE", "JUDGMENT"],
      materialPattern: /归档|结案报告|原件退还|材料清单|结案告知|费用结清/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["上诉/应诉"],
    guide: {
      summary: "围绕上诉、二审应诉、补充证据、上诉费和二审庭询安排组织材料。",
      checklistTitle: "二审事项",
      checklist: [
        "签订二审委托手续并确认上诉期限",
        "递交上诉状或二审答辩意见、证据材料",
        "提醒并核对上诉费缴纳",
        "梳理一审裁判争点和二审代理思路"
      ],
      actions: ["上诉状", "二审答辩状", "二审证据目录", "上诉费缴费凭证", "二审代理方案"],
      deadlineCategories: ["APPEAL", "RESPONSE", "EVIDENCE"],
      materialCategories: [],
      materialPattern: /上诉|二审|答辩|一审判决|裁定|上诉费|代理方案/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["财产查控"],
    guide: {
      summary: "梳理并提交被执行人财产线索，跟进网络查控、处置方案和续保。",
      checklistTitle: "查控事项",
      checklist: [
        "梳理房产、车辆、银行账户、股权等财产线索",
        "向执行法官提交财产线索和查控申请",
        "跟进查封、冻结、扣押和评估拍卖进度",
        "执行周期较长时同步检查已保全财产续保"
      ],
      actions: ["财产线索清单", "网络查控申请书", "追加被执行人申请书", "续封申请书"],
      deadlineCategories: ["ENFORCEMENT", "PRESERVATION"],
      materialCategories: [],
      materialPattern: /查控|财产线索|冻结|查封|扣押|拍卖|追加被执行人|续封/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["异议/复议"],
    guide: {
      summary: "处理执行异议、复议、不予执行或案外人异议相关材料和期限。",
      checklistTitle: "异议事项",
      checklist: [
        "确认异议主体、异议对象和法定期限",
        "准备执行异议申请或复议申请及证据",
        "跟进听证、裁定和后续异议之诉衔接",
        "向当事人汇报风险和下一步策略"
      ],
      actions: ["执行异议申请书", "复议申请书", "不予执行申请书", "听证提纲"],
      deadlineCategories: ["ENFORCEMENT", "CUSTOM"],
      materialCategories: [],
      materialPattern: /执行异议|复议|不予执行|案外人|听证|异议之诉/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["执行和解"],
    guide: {
      summary: "推动执行和解方案、客户确认、协议签署、履行监督和恢复执行预案。",
      checklistTitle: "和解事项",
      checklist: [
        "核实对方履行能力和和解条件",
        "形成和解方案并取得客户书面确认",
        "签署执行和解协议并提交法院备案",
        "跟进分期履行、违约处理和恢复执行"
      ],
      actions: ["执行和解方案", "调解/和解方案确认函", "执行和解协议", "恢复执行申请书"],
      deadlineCategories: ["PERFORMANCE", "ENFORCEMENT"],
      materialCategories: [],
      materialPattern: /和解|调解|履行计划|恢复执行|确认函/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["会见", "取保候审", "阅卷线索", "辩护意见"],
    guide: {
      summary: "刑事程序内按会见、取保、阅卷、线索核实和辩护意见组织工作。",
      checklistTitle: "刑事事项",
      checklist: [
        "核对委托手续、会见手续和办案机关要求",
        "记录会见情况、阅卷要点和补充线索",
        "评估取保候审、羁押必要性和证据风险",
        "形成书面辩护意见或法律意见"
      ],
      actions: ["会见笔录", "取保候审申请书", "阅卷笔录", "辩护意见", "法律意见书"],
      deadlineCategories: ["CUSTOM"],
      materialCategories: [],
      materialPattern: /会见|取保|阅卷|辩护|羁押|法律意见/,
      defaultCategory: "PROCEDURE"
    }
  }
];

const DOCUMENT_CATEGORY_OPTIONS: DocumentCategory[] = [
  "CONTRACT",
  "PLEADING",
  "EVIDENCE",
  "PROCEDURE",
  "JUDGMENT",
  "OTHER"
];
const SOURCE_MATERIAL_CATEGORIES: DocumentCategory[] = ["PLEADING", "EVIDENCE"];
const COURT_PROCEDURE_SOURCE = "法院程序文件";

export type WorkflowNote = {
  id: string;
  channel: string;
  withWhom: string | null;
  occurredAt: Date;
  content: string;
  tags: string[];
  author: { id: string; name: string };
};

export type WorkflowTimelineEvent = {
  id: string;
  eventType: string;
  title: string;
  content: string | null;
  occurredAt: Date;
};

/** 研判笔记标记（Note.tags）：人工判断内容，与事务记录分开陈列 */
export const JUDGMENT_NOTE_TAG = "研判笔记";
export const stageNoteTag = (stageName: string) => `环节:${stageName}`;

export type WorkflowApi = {
  /** 从外部（页头「上传材料」）打开当前环节的上传 */
  openUpload: () => void;
  /** 从「登记进展」打开当前环节的添加任务 */
  openAddTask: () => void;
  /** 当前可归档环节名（研判笔记归档用） */
  stageNames: string[];
  currentStageName: string | null;
};

export function ProcedureWorkflowPanel({
  matter,
  procedure,
  documents,
  preservationCases,
  folders,
  templates,
  users,
  canManage,
  matterInfoNode,
  railSlot,
  chainHeader,
  notes,
  timelineEvents,
  onWriteNote,
  apiRef
}: {
  matter: WorkflowMatter;
  procedure: WorkflowProcedure | null;
  documents: WorkflowDocument[];
  preservationCases: WorkflowPreservationCase[];
  folders: FolderPayload[];
  templates: TemplateSummary[];
  users: UserOption[];
  canManage: boolean;
  matterInfoNode?: React.ReactNode;
  /** 墨案 04：页面级三栏（环节导航 | 环节工作区 | 辅助栏）的右栏内容，由案件页注入 */
  railSlot?: React.ReactNode;
  /** 程序链卡头右侧（程序切换 chips + 新增程序） */
  chainHeader?: React.ReactNode;
  notes: WorkflowNote[];
  timelineEvents: WorkflowTimelineEvent[];
  onWriteNote: (opts: { judgment: boolean; stageName?: string }) => void;
  apiRef?: React.MutableRefObject<WorkflowApi | null>;
}) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [taskStage, setTaskStage] = useState<WorkflowStage | null>(null);
  const [stageCreateOpen, setStageCreateOpen] = useState(false);
  const [uploadSignal, setUploadSignal] = useState(0);
  const [, startStageRemovalTransition] = useTransition();

  const stages = useMemo(
    () => buildWorkflowStages(procedure, preservationCases),
    [procedure, preservationCases]
  );
  const workflowItems: WorkflowItem[] = matterInfoNode ? [MATTER_INFO_ITEM, ...stages] : stages;
  // 默认进入当前环节（第一个未完成的环节），没有程序环节时进入信息总览
  const defaultStage = stages.find((s) => s.status === "active" || s.status === "risk") ?? stages.find((s) => s.status === "todo") ?? null;
  const defaultKey = defaultStage?.key ?? workflowItems[0]?.key ?? null;
  const selectedItem =
    workflowItems.find((item) => item.key === selectedKey) ??
    workflowItems.find((item) => item.key === defaultKey) ??
    null;
  const selectedStage = selectedItem && selectedItem.kind !== "matter_info" ? selectedItem : null;

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      openUpload: () => {
        if (!selectedStage && defaultStage) setSelectedKey(defaultStage.key);
        setUploadSignal((n) => n + 1);
      },
      openAddTask: () => {
        const target = selectedStage ?? defaultStage ?? stages[0] ?? null;
        if (target) setTaskStage(target);
        else toast.info("请先新增程序后再添加任务");
      },
      stageNames: stages.map((st) => st.name),
      currentStageName: (selectedStage ?? defaultStage)?.name ?? null
    };
  }, [apiRef, selectedStage, defaultStage, stages]);

  async function handleRemoveStage(stage: WorkflowStage) {
    const stageId = stage.id;
    if (!stageId) {
      toast.info("该环节尚未写入流程，无需移除");
      return;
    }
    if (!stage.removable) {
      toast.warning("必备环节不能移除");
      return;
    }
    if (!(await confirmDialog({ title: `移除环节「${stage.name}」？`, description: "已有任务或材料的环节将被隐藏（数据保留，重新添加同名环节可恢复）。", confirmText: "移除", danger: true }))) return;
    startStageRemovalTransition(async () => {
      try {
        const res = await removeProcedureStage({ id: stageId });
        toast.success(res.hidden ? "环节已隐藏，数据保留（重新添加同名环节可恢复）" : "环节已移除");
        setSelectedKey(null);
        router.refresh();
      } catch (err) {
        toast.error("移除失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  // 程序链：与环节导航同源（含尚未物化的预设环节），点击节点切换环节
  const chainNodes: ChainNode[] = stages.map((stage) => ({
    key: stage.key,
    label: stage.name,
    date: stageChainDate(stage, procedure),
    state:
      stage.status === "done"
        ? "done"
        : stage.status === "risk"
          ? "risk"
          : stage.key === (defaultStage?.key ?? "")
            ? "current"
            : "todo",
    onClick: () => setSelectedKey(stage.key)
  }));

  const chainCard = (
    <div className="card chain-card">
      <div className="chain-top">
        <span className="t">程序链</span>
        <span className="t-xs t-mute hidden sm:inline">程序间独立推进，材料互不共用</span>
        <div className="prog-switch">{chainHeader}</div>
      </div>
      {procedure && chainNodes.length > 1 ? (
        <div className="overflow-x-auto pb-1">
          <ProcedureChain nodes={chainNodes} className="min-w-fit" />
        </div>
      ) : (
        <p className="t-xs t-mute py-1">
          {procedure ? "当前程序仅一个环节：期限、任务与材料直接在下方工作区处理。" : "暂无在办程序；点击右上「新增程序」开始办案流程。"}
        </p>
      )}
    </div>
  );

  const recordsCard = (
    <MatterRecordsCard notes={notes} events={timelineEvents} canManage={canManage} onWriteNote={() => onWriteNote({ judgment: true })} />
  );

  if (!procedure) {
    return (
      <>
        {chainCard}
        <div className="ws-grid">
          <div className="stage-nav">
            <div className="card" style={{ padding: 8 }}>
              <button type="button" className="sn-item active w-full">
                <FileText className="h-[15px] w-[15px]" strokeWidth={1.8} />
                信息总览
              </button>
            </div>
          </div>
          <div className="ws">
            <div className="card">
              <div className="panel-body">{matterInfoNode}</div>
            </div>
            {recordsCard}
          </div>
          {railSlot ? <aside className="rail">{railSlot}</aside> : null}
        </div>
      </>
    );
  }

  return (
    <>
      {chainCard}
      <div className="ws-grid">
        {/* 环节导航 */}
        <div className="stage-nav">
          <nav className="card" style={{ padding: 8 }} aria-label="办案环节导航">
            {workflowItems.map((item) => {
              const active = selectedItem?.key === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedKey(item.key)}
                  className={cn("sn-item w-full text-left", active && "active")}
                  aria-current={active ? "true" : undefined}
                >
                  {item.kind === "matter_info" ? (
                    <FileText className="h-[15px] w-[15px] shrink-0" strokeWidth={1.8} />
                  ) : (
                    <StageGlyph name={item.name} kind={item.kind} className="h-[15px] w-[15px] shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.kind !== "matter_info" ? <StageNavStatus stage={item} /> : null}
                </button>
              );
            })}
          </nav>
          {canManage ? (
            <button type="button" onClick={() => setStageCreateOpen(true)} className="btn btn-secondary btn-sm" style={{ width: "100%", marginTop: 10 }}>
              <Plus strokeWidth={2.2} />
              添加环节
            </button>
          ) : null}
        </div>

        {/* 环节工作区 */}
        <div className="ws">
          {selectedItem?.kind === "matter_info" ? (
            matterInfoNode
          ) : selectedItem?.kind === "preservation" ? (
            <PreservationWorkflowContent
              matter={matter}
              procedure={procedure}
              stage={selectedItem}
              cases={preservationCases}
              documents={documents}
              users={users}
              canManage={canManage}
              onOpenTemplate={() => setTemplateOpen(true)}
              onAddTask={() => setTaskStage(selectedItem)}
              onRemoveStage={canManage && selectedItem.removable ? () => handleRemoveStage(selectedItem) : undefined}
              uploadSignal={uploadSignal}
              recordsSlot={recordsCard}
            />
          ) : selectedItem ? (
            <NormalStageContent
              matterId={matter.id}
              stage={selectedItem}
              procedure={procedure}
              documents={documents}
              notes={notes}
              users={users}
              onOpenTemplate={() => setTemplateOpen(true)}
              onAddTask={() => setTaskStage(selectedItem)}
              onRemoveStage={canManage && selectedItem.removable ? () => handleRemoveStage(selectedItem) : undefined}
              onWriteStageNote={() => onWriteNote({ judgment: true, stageName: selectedItem.name })}
              canManage={canManage}
              uploadSignal={uploadSignal}
              recordsSlot={recordsCard}
            />
          ) : (
            <div className="card">
              <EmptyState compact title="暂无工作环节" />
            </div>
          )}
        </div>

        {/* 辅助栏 */}
        {railSlot ? <aside className="rail">{railSlot}</aside> : null}
      </div>

      <TemplatePickerDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        matterId={matter.id}
        matterCategory={matter.category}
        folders={folders}
        templates={templates}
      />
      {taskStage && (
        <TaskQuickDialog
          open={!!taskStage}
          onOpenChange={(open) => !open && setTaskStage(null)}
          matterId={matter.id}
          procedureId={procedure.id}
          stage={taskStage}
          users={users}
          onStageReady={(stageId) => setSelectedKey(`stage-${stageId}`)}
        />
      )}
      <StageCreateDialog
        open={stageCreateOpen}
        onOpenChange={setStageCreateOpen}
        procedureId={procedure.id}
        procedureType={procedure.type}
        stages={stages}
        selectedItem={selectedItem}
        onCreated={(stageId) => setSelectedKey(`stage-${stageId}`)}
      />
    </>
  );
}

function stageChainDate(stage: WorkflowStage, procedure: WorkflowProcedure | null): string | null {
  const src = procedure?.stages.find((s) => s.id === stage.id);
  if (src?.completedAt) return shortDay(src.completedAt);
  const due = stage.tasks.filter((t) => !t.completed && t.dueAt).map((t) => new Date(t.dueAt!).getTime()).sort((a, b) => a - b)[0];
  if (due) return shortDay(new Date(due));
  if (src?.startedAt) return shortDay(src.startedAt);
  return null;
}

function StageNavStatus({ stage }: { stage: WorkflowStage }) {
  if (stage.kind === "preservation" && stage.badge) {
    return <span className="sn-badge">{stage.badge.hot ? `临期 ${stage.badge.text}` : `在保 ${stage.badge.text.replace(" 项", "")}`}</span>;
  }
  if (stage.status === "done") return <span className="st st-done" aria-label="已完成">✓</span>;
  if (stage.status === "risk") return <span className="st st-risk" aria-label="临期风险">!</span>;
  if (stage.status === "active") return <span className="st st-cur" aria-label="进行中">●</span>;
  if (stage.badge) return <span className="st t-faint">{stage.badge.text}</span>;
  return null;
}

function StageGlyph({ name, kind, className }: { name: string; kind: WorkflowStage["kind"]; className?: string }) {
  const p = { className, strokeWidth: 1.8 };
  if (kind === "preservation" || name.includes("保全")) return <Shield {...p} />;
  if (name.includes("授权") || name.includes("委托")) return <FileCheck2 {...p} />;
  if (name.includes("研判") || name.includes("分析")) return <Lightbulb {...p} />;
  if (name.includes("证据") || name.includes("举证") || name.includes("质证")) return <BookOpen {...p} />;
  if (name.includes("开庭") || name.includes("庭审") || name.includes("庭")) return <Landmark {...p} />;
  if (name.includes("判决") || name.includes("裁") || name.includes("送达")) return <ScrollText {...p} />;
  if (name.includes("归档") || name.includes("结案")) return <Archive {...p} />;
  if (name.includes("立案") || name.includes("材料") || name.includes("起诉")) return <FolderOpen {...p} />;
  if (name.includes("执行")) return <Gavel {...p} />;
  return <ListChecks {...p} />;
}

const TASK_PRIORITY: Record<number, { label: string; tone: "red" | "amber" | "slate" }> = {
  2: { label: "紧急", tone: "red" },
  1: { label: "高", tone: "amber" },
  0: { label: "普通", tone: "slate" }
};

type StageTab = "items" | "records" | "docs" | "materials";

function NormalStageContent({
  matterId,
  stage,
  procedure,
  documents,
  notes,
  users,
  onOpenTemplate,
  onAddTask,
  onRemoveStage,
  onWriteStageNote,
  canManage,
  uploadSignal,
  recordsSlot
}: {
  matterId: string;
  stage: WorkflowStage;
  procedure: WorkflowProcedure;
  documents: WorkflowDocument[];
  notes: WorkflowNote[];
  users: UserOption[];
  onOpenTemplate: () => void;
  onAddTask: () => void;
  onRemoveStage?: () => void;
  onWriteStageNote: () => void;
  canManage: boolean;
  uploadSignal: number;
  recordsSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<StageTab>("items");
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [, startToggle] = useTransition();
  const guide = stageGuideFor(stage.name);
  const relevantDeadlines = guide.deadlineCategories.length > 0
    ? procedure.deadlines.filter((d) => guide.deadlineCategories.includes(d.category)).slice(0, 6)
    : [];
  const relevantDocs = documents.filter((d) => documentMatchesStage(d, stage));
  const writtenDocs = relevantDocs.filter((d) => d.templateId || d.category === "PLEADING" || d.category === "JUDGMENT");
  const stageHearings = guide.includeHearings ? procedure.hearings.slice(0, 3) : [];
  const stageNotes = notes.filter((n) => n.tags.includes(stageNoteTag(stage.name)));
  const itemCount = stage.tasks.length + relevantDeadlines.length + stageHearings.length;
  const src = procedure.stages.find((s) => s.id === stage.id);
  const nameOf = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.name : undefined);

  const statusText: Record<WorkflowStageStatus, string> = {
    done: "已完成",
    active: "进行中",
    risk: "临期风险",
    todo: "待处理",
    not_applicable: "不适用"
  };

  function toggle(taskId: string) {
    startToggle(async () => {
      try {
        await toggleTaskCompleted(taskId);
        router.refresh();
      } catch (err) {
        toast.error("更新失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  useEffect(() => {
    if (uploadSignal > 0) setTab("materials");
  }, [uploadSignal]);

  return (
    <>
      <div className="card">
        <div className="panel-head" style={{ borderBottom: "none", paddingBottom: 8 }}>
          <div className="ws-head min-w-0 flex-1">
            <div className="ic-wrap" style={stage.status === "risk" ? { background: "var(--amber-bg)", color: "var(--amber)" } : undefined}>
              <StageGlyph name={stage.name} kind={stage.kind} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate">{stage.name}</h2>
              <div className="desc truncate">
                {statusText[stage.status]}
                {src?.startedAt ? ` · 开始于 ${shortDay(src.startedAt)}` : ""}
                {src?.completedAt ? ` · 完成于 ${shortDay(src.completedAt)}` : ""}
                {` · ${guide.summary}`}
              </div>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
                环节说明
              </button>
              {onRemoveStage ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onRemoveStage}>
                  移除环节
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {guideOpen ? <StageGuideBody guide={guide} /> : null}
        <div className="tabs" style={{ padding: "0 16px" }} role="tablist">
          {(
            [
              ["items", "本环节事项", itemCount],
              ["records", "办案记录", stageNotes.length || null],
              ["docs", "文书材料", writtenDocs.length],
              ["materials", "阶段材料", relevantDocs.length]
            ] as [StageTab, string, number | null][]
          ).map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("tab", tab === key && "active")}>
              {label}
              {count ? <span className="num-sm t-mute" style={{ marginLeft: 5 }}>{count}</span> : null}
            </button>
          ))}
        </div>

        {tab === "items" ? (
          <>
            {itemCount === 0 ? (
              <EmptyState compact title="本环节还没有任务或期限" description="任务、法定期限与开庭都会汇集在这里；逾期任务会自动进入工作台「今日行动」。" />
            ) : (
              <>
                {relevantDeadlines.map((deadline) => {
                  const days = daysUntil(deadline.dueAt);
                  const tone = deadline.completed ? "slate" : days < 0 || days <= 3 ? "red" : days <= 7 ? "amber" : "slate";
                  return (
                    <div key={deadline.id} className="task">
                      <span className={cn("task-box flex items-center justify-center", deadline.completed && "done")} aria-hidden>
                        {deadline.completed ? <Check /> : <CalendarClock className="h-2.5 w-2.5 text-[var(--t-faint)]" />}
                      </span>
                      <div className="min-w-0">
                        <div className={cn("task-title", deadline.completed && "done-t")}>{deadline.title}</div>
                        <div className="task-meta">
                          <span>期限</span>
                          <span className="sep" />
                          <span className={cn(!deadline.completed && days <= 3 && "t-red font-semibold")}>
                            {formatDate(deadline.dueAt)} 截止{!deadline.completed ? ` · ${days < 0 ? `逾期 ${-days} 天` : days === 0 ? "今天到期" : `剩 ${days} 天`}` : ""}
                          </span>
                          {deadline.basis ? (
                            <>
                              <span className="sep" />
                              <span className="truncate">{deadline.basis}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="task-right">
                        {deadline.confirmStatus === "PENDING" ? <span className="badge b-amber">待确认</span> : null}
                        <span className={cn("badge", `b-${tone}`)}>
                          {tone === "red" ? <span className="bdot" /> : null}
                          {deadline.completed ? "已完成" : "法定期限"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {stage.tasks.map((task) => {
                  const pr = TASK_PRIORITY[task.priority] ?? TASK_PRIORITY[0];
                  const days = task.dueAt ? daysUntil(task.dueAt) : null;
                  const assignee = nameOf(task.assigneeId);
                  return (
                    <div key={task.id} className="task">
                      <button
                        type="button"
                        onClick={() => canManage && toggle(task.id)}
                        disabled={!canManage}
                        className={cn("task-box flex items-center justify-center p-0", task.completed && "done")}
                        aria-label={task.completed ? "标记为未完成" : "标记为完成"}
                      >
                        {task.completed ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden>
                            <path d="M4 12.5l5 5L20 7" />
                          </svg>
                        ) : null}
                      </button>
                      <div className="min-w-0">
                        <div className={cn("task-title", task.completed && "done-t")}>{task.title}</div>
                        <div className="task-meta">
                          {assignee ? <span>指派 {assignee}</span> : <span>未指派</span>}
                          {task.completed && task.completedAt ? (
                            <>
                              <span className="sep" />
                              <span>{shortDay(task.completedAt)} 完成</span>
                            </>
                          ) : task.dueAt ? (
                            <>
                              <span className="sep" />
                              <span className={cn(days !== null && days < 0 && "t-red font-semibold")}>
                                {formatDate(task.dueAt)} 截止{days !== null && days < 0 ? ` · 已逾期 ${-days} 天` : ""}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {!task.completed ? (
                        <div className="task-right">
                          <span className={cn("badge", `b-${pr.tone}`)}>
                            {pr.tone === "red" ? <span className="bdot" /> : null}
                            {pr.label}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {stageHearings.map((hearing) => (
                  <div key={hearing.id} className="task">
                    <span className="task-box flex items-center justify-center" aria-hidden>
                      <Landmark className="h-2.5 w-2.5 text-[var(--blue)]" />
                    </span>
                    <div className="min-w-0">
                      <div className="task-title">{hearing.title}</div>
                      <div className="task-meta">
                        <span>开庭</span>
                        <span className="sep" />
                        <span className="code">{formatDate(hearing.startsAt)} {new Date(hearing.startsAt).toTimeString().slice(0, 5)}</span>
                        {hearing.room ? (
                          <>
                            <span className="sep" />
                            <span>{hearing.room}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="task-right">
                      <span className="badge b-blue">开庭</span>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
              <span className="t-xs t-mute">逾期任务会自动进入工作台「今日行动」</span>
              {canManage ? (
                <div className="flex gap-[7px]">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeadlineOpen(true)}>
                    <Scale />
                    法定期限
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onAddTask}>
                    <Plus />
                    添加任务
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {tab === "records" ? (
          <>
            {stageNotes.length === 0 ? (
              <EmptyState compact title="本环节暂无归档的研判笔记" description="在本环节写下的研判笔记会按环节归档在这里，同时出现在下方办案记录中。" />
            ) : (
              stageNotes.map((note) => <JudgmentNoteRow key={note.id} note={note} />)
            )}
            {canManage ? (
              <div className="panel-foot flex justify-end">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onWriteStageNote}>
                  <PenLine />
                  写研判笔记
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "docs" ? (
          <>
            {writtenDocs.length === 0 ? (
              <EmptyState compact title="本环节暂无文书" description="从模板生成的文书与诉辩、裁判文书会出现在这里。" />
            ) : (
              writtenDocs.map((doc) => <DocRow key={doc.id} doc={doc} />)
            )}
            {canManage ? (
              <div className="panel-foot flex justify-end">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenTemplate}>
                  <Sparkles />
                  从模板生成
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "materials" ? (
          relevantDocs.length === 0 ? (
            <EmptyState compact title="暂无该环节材料" />
          ) : (
            relevantDocs.slice(0, 6).map((doc) => <DocRow key={doc.id} doc={doc} compact />)
          )
        ) : null}
      </div>

      {recordsSlot}

      <StageMaterialsPanel
        matterId={matterId}
        procedure={procedure}
        stage={stage}
        documents={relevantDocs}
        canManage={canManage}
        onOpenTemplate={onOpenTemplate}
        uploadSignal={uploadSignal}
      />

      {deadlineOpen && (
        <AddDeadlineDialog
          open={deadlineOpen}
          onOpenChange={setDeadlineOpen}
          procedures={[
            {
              id: procedure.id,
              label: procedure.customLabel ?? procedureTypeLabel[procedure.type]
            }
          ]}
          defaultProcedureId={procedure.id}
        />
      )}
    </>
  );
}

function StageGuideBody({ guide }: { guide: StageGuide }) {
  return (
    <div className="mx-4 mb-3 rounded-[8px] bg-[var(--bg-sunken)] px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-[var(--t-secondary)]">{guide.checklistTitle}</div>
      <ul className="mt-1.5 space-y-1">
        {guide.checklist.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[12px] leading-5 text-[var(--t-secondary)]">
            <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--teal)]" />
            {item}
          </li>
        ))}
      </ul>
      {guide.actions.length > 0 ? (
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--t-muted)]">常用文书：{guide.actions.join("、")}（在「从模板生成」中选用）</p>
      ) : null}
    </div>
  );
}

function JudgmentNoteRow({ note }: { note: WorkflowNote }) {
  return (
    <div className="rec">
      <div className="rec-ic" style={{ background: "var(--violet-bg)", color: "var(--violet)" }}>
        <PenLine strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rec-title">
          {noteHeadline(note)}
          <span className="badge b-violet" style={{ fontSize: 9.5, padding: "0 6px", marginLeft: 6 }}>人工判断</span>
        </div>
        <div className="rec-note whitespace-pre-wrap">{note.content}</div>
        <div className="rec-meta">
          {note.author.name} · {formatDateTimeShort(note.occurredAt)}
        </div>
      </div>
    </div>
  );
}

function noteHeadline(note: WorkflowNote) {
  const firstLine = note.content.split("\n")[0].trim();
  return firstLine.length > 36 ? `${firstLine.slice(0, 36)}…` : firstLine;
}

function formatDateTimeShort(date: Date) {
  const d = new Date(date);
  return `${shortDay(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const NOTE_CHANNEL_LABEL: Record<string, string> = {
  PHONE: "电话沟通",
  WECHAT: "微信沟通",
  EMAIL: "邮件往来",
  MEETING: "面谈",
  COURT: "法院沟通",
  OTHER: "办案记录"
};

const EVENT_TONE: Record<string, { bg: string; fg: string; icon: typeof FileText }> = {
  FEE_RECEIVED: { bg: "var(--green-bg)", fg: "var(--green)", icon: CircleDollarSign },
  DOCUMENT_UPLOADED: { bg: "var(--blue-bg)", fg: "var(--blue)", icon: FileText },
  HEARING_SCHEDULED: { bg: "var(--blue-bg)", fg: "var(--blue)", icon: Landmark },
  DEADLINE_ADDED: { bg: "var(--amber-bg)", fg: "var(--amber)", icon: CalendarClock },
  MATTER_ARCHIVED: { bg: "var(--bronze-bg)", fg: "var(--bronze)", icon: Archive },
  MATTER_ARCHIVE_REQUESTED: { bg: "var(--bronze-bg)", fg: "var(--bronze)", icon: Archive },
  MATTER_CLOSED: { bg: "var(--green-bg)", fg: "var(--green)", icon: Check }
};

/** 办案记录：事务记录（系统/登记产生）与研判笔记（人工判断）分组陈列，不混排 */
function MatterRecordsCard({
  notes,
  events,
  canManage,
  onWriteNote
}: {
  notes: WorkflowNote[];
  events: WorkflowTimelineEvent[];
  canManage: boolean;
  onWriteNote: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const judgments = notes.filter((n) => n.tags.includes(JUDGMENT_NOTE_TAG));
  const transactions = [
    ...events.map((e) => ({ kind: "event" as const, id: e.id, at: new Date(e.occurredAt), event: e })),
    ...notes.filter((n) => !n.tags.includes(JUDGMENT_NOTE_TAG)).map((n) => ({ kind: "note" as const, id: n.id, at: new Date(n.occurredAt), note: n }))
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const total = transactions.length + judgments.length;
  const txShown = expanded ? transactions : transactions.slice(0, 3);
  const jdShown = expanded ? judgments : judgments.slice(0, 2);

  return (
    <div className="card">
      <div className="panel-head">
        <div className="panel-title">
          <BookOpen className="ic" strokeWidth={1.8} />
          办案记录
        </div>
        {total > txShown.length + jdShown.length || expanded ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : `查看全部 ${total} 条`}
          </button>
        ) : null}
      </div>

      <div className="rec-group-label">
        <ListChecks className="h-3 w-3" strokeWidth={2} />
        事务记录 <span className="sub">· 系统与登记产生，自动带时间与操作人</span>
      </div>
      {txShown.length === 0 ? (
        <div className="rec t-xs t-mute">暂无事务记录</div>
      ) : (
        txShown.map((item) => {
          if (item.kind === "event") {
            const tone = EVENT_TONE[item.event.eventType] ?? { bg: "var(--slate-bg)", fg: "var(--slate)", icon: ListChecks };
            const Icon = tone.icon;
            return (
              <div key={item.id} className="rec">
                <div className="rec-ic" style={{ background: tone.bg, color: tone.fg }}>
                  <Icon strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="rec-title">{item.event.title}</div>
                  <div className="rec-meta">
                    {formatDateTimeShort(item.at)}
                    {item.event.content ? ` · ${item.event.content}` : ""}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={item.id} className="rec">
              <div className="rec-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)" }}>
                <MessageSquare strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="rec-title">
                  {NOTE_CHANNEL_LABEL[item.note.channel] ?? "办案记录"}
                  {item.note.withWhom ? ` · ${item.note.withWhom}` : ""}：{noteHeadline(item.note)}
                </div>
                <div className="rec-meta">
                  {item.note.author.name} · {formatDateTimeShort(item.at)}
                </div>
              </div>
            </div>
          );
        })
      )}

      <div className="rec-group-label">
        <PenLine className="h-3 w-3" strokeWidth={2} />
        研判笔记 <span className="sub">· 人工判断内容，独立陈列，不与事务记录混排</span>
      </div>
      {jdShown.length === 0 ? (
        <div className="rec t-xs t-mute">暂无研判笔记</div>
      ) : (
        jdShown.map((note) => <JudgmentNoteRow key={note.id} note={note} />)
      )}

      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span className="t-xs t-mute">事务记录自动沉淀时间线；研判笔记支持按环节归档</span>
        {canManage ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onWriteNote}>
            <PenLine />
            写研判笔记
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DocRow({ doc, compact = false }: { doc: WorkflowDocument; compact?: boolean }) {
  const { onReview } = useDocActions();
  const pUrl = documentPreviewUrl(doc);
  const chip = doc.sourceOrigin ? documentSourceChip[doc.sourceOrigin] : null;
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
  const tone = ext === "pdf" ? "red" : ["doc", "docx"].includes(ext) ? "blue" : doc.textSource === "OCR" ? "violet" : "slate";
  const meta: string[] = [];
  if (doc.size) meta.push(formatBytes(doc.size));
  meta.push(`${shortDay(doc.createdAt)} ${doc.templateId ? "从模板生成" : "上传"}`);
  if (doc.ocrStatus === "READY" && doc.pageCount) meta.push(`已抽取文本 · ${doc.pageCount} 页`);
  if (!compact && doc.sha256) meta.push(`校验值 ${doc.sha256.slice(0, 4)}…${doc.sha256.slice(-4)}`);
  if (doc.version && doc.version > 1) meta.push(`版本 ${doc.version}`);
  return (
    <div className="doc-row">
      <DocIcon tone={tone} />
      <div className="min-w-0 flex-1">
        {pUrl ? (
          <a href={pUrl} target="_blank" rel="noreferrer" className="doc-name block truncate hover:text-[var(--teal-deep)]">
            {doc.name}
          </a>
        ) : (
          <div className="doc-name truncate">{doc.name}</div>
        )}
        <div className="doc-meta truncate">{meta.join(" · ")}</div>
      </div>
      {doc.ocrStatus === "FAILED" ? <span className="src-chip" style={{ color: "var(--red)", borderColor: "var(--red-line)", background: "var(--red-bg)" }}>识别失败</span> : null}
      {doc.textSource === "OCR" && doc.ocrStatus === "READY" ? <SourceChip kind="ai">AI 识别</SourceChip> : null}
      {chip ? <SourceChip kind={chip.kind}>{chip.label}</SourceChip> : doc.sourceParty ? <SourceChip kind="plain">{doc.sourceParty}</SourceChip> : null}
      {!compact ? (
        <>
          {pUrl ? (
            <a href={pUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              预览
            </a>
          ) : null}
          <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            下载
          </a>
          {onReview && doc.ocrStatus !== "FAILED" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReview(doc.id)} title="AI 审查缺失要素、法律风险与条款问题">
              AI 审查
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function PreservationWorkflowContent({
  matter,
  procedure,
  stage,
  cases,
  documents,
  users,
  canManage,
  onOpenTemplate,
  onAddTask,
  onRemoveStage,
  uploadSignal,
  recordsSlot
}: {
  matter: WorkflowMatter;
  procedure: WorkflowProcedure;
  stage: WorkflowStage;
  cases: WorkflowPreservationCase[];
  documents: WorkflowDocument[];
  users: UserOption[];
  canManage: boolean;
  onOpenTemplate: () => void;
  onAddTask: () => void;
  onRemoveStage?: () => void;
  uploadSignal: number;
  recordsSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [addTargetCaseId, setAddTargetCaseId] = useState<string | null>(null);
  const [addPropertyTargetId, setAddPropertyTargetId] = useState<string | null>(null);
  const [renewPropertyId, setRenewPropertyId] = useState<string | null>(null);

  const matterOption: MatterOption = {
    id: matter.id,
    internalCode: matter.internalCode,
    title: matter.title
  };
  const properties = cases.flatMap((c) => c.targets.flatMap((t) => t.properties));
  const activeProperties = properties.filter((p) => p.status === "ACTIVE" || p.status === "RENEWED");
  const expiringCount = activeProperties.filter((p) => daysUntil(p.expiryDate) <= 30).length;
  const renewableProperty = properties.find((p) => p.id === renewPropertyId) ?? null;
  const relevantDocs = documents.filter((d) => documentMatchesStage(d, stage));

  function handleLift(propertyId: string) {
    startTransition(async () => {
      try {
        await liftProperty(propertyId);
        toast.success("已解除保全");
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <>
    <div className="card">
      <div className="panel-head" style={{ borderBottom: "none", paddingBottom: 8 }}>
        <div className="ws-head min-w-0 flex-1">
          <div className="ic-wrap" style={expiringCount > 0 ? { background: "var(--amber-bg)", color: "var(--amber)" } : undefined}>
            <Shield strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2>财产保全</h2>
            <div className="desc truncate">
              {activeProperties.length > 0 ? `在保 ${activeProperties.length} 项` : "暂无在保财产"}
              {expiringCount > 0 ? ` · 30 天内到期 ${expiringCount} 项` : ""} · 申请、担保、裁定、续封和解除统一归到当前程序
            </div>
          </div>
          <div className="acts">
            {onRemoveStage ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemoveStage}>
                移除环节
              </button>
            ) : null}
            {canManage ? (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onAddTask}>
                  <Plus />
                  任务
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  新建保全
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="panel-body" style={{ paddingTop: 4 }}>
      {cases.length === 0 ? (
        <EmptyState compact icon={Shield} title="该程序尚无财产保全记录" description="新建保全后，被保全人、财产、续封与解除都在这里跟踪。" />
      ) : (
        <div className="space-y-3">
          {cases.map((item) => (
            <div key={item.id} className="rounded-[10px] border border-[var(--bd-hair)] bg-card">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--bd-hair)] px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{PRES_TYPE_CN[item.type]}</span>
                    {item.court && <span className="text-[11px] text-muted-foreground">{item.court}</span>}
                    {item.rulingNumber && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">{item.rulingNumber}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {item.guaranteeType ? GUARANTEE_TYPE_CN[item.guaranteeType] : "未填写担保方式"}
                    {item.owner?.name ? ` · ${item.owner.name}` : ""}
                  </div>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddTargetCaseId(item.id)}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    <Plus className="h-3 w-3" />
                    被保全人
                  </Button>
                )}
              </div>

              <div className="space-y-3 p-3">
                {item.targets.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">暂无被保全人</p>
                ) : (
                  item.targets.map((target) => (
                    <div key={target.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">{target.name}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setAddPropertyTargetId(target.id)}
                            className="ml-auto text-[11px] text-primary hover:underline"
                          >
                            + 添加财产
                          </button>
                        )}
                      </div>
                      {target.properties.length === 0 ? (
                        <p className="pl-6 text-[11px] text-muted-foreground">暂无财产</p>
                      ) : (
                        <div className="space-y-1.5 pl-6">
                          {target.properties.map((property) => (
                            <PreservationPropertyRow
                              key={property.id}
                              property={property}
                              onRenew={() => setRenewPropertyId(property.id)}
                              onLift={() => handleLift(property.id)}
                              canManage={canManage}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      </div>
    </div>

      {recordsSlot}

      <StageMaterialsPanel
        matterId={matter.id}
        procedure={procedure}
        stage={stage}
        documents={relevantDocs}
        canManage={canManage}
        onOpenTemplate={onOpenTemplate}
        uploadSignal={uploadSignal}
      />

      <PreservationCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        matters={[matterOption]}
        users={users}
        initialMatterId={matter.id}
      />
      {addTargetCaseId && (
        <AddTargetDialog
          open={!!addTargetCaseId}
          onOpenChange={(open) => !open && setAddTargetCaseId(null)}
          caseId={addTargetCaseId}
        />
      )}
      {addPropertyTargetId && (
        <AddPropertyDialog
          open={!!addPropertyTargetId}
          onOpenChange={(open) => !open && setAddPropertyTargetId(null)}
          targetId={addPropertyTargetId}
        />
      )}
      {renewableProperty && (
        <RenewPropertyDialog
          open={!!renewPropertyId}
          onOpenChange={(open) => !open && setRenewPropertyId(null)}
          property={renewableProperty}
        />
      )}
    </>
  );
}

function PreservationPropertyRow({
  property,
  onRenew,
  onLift,
  canManage
}: {
  property: WorkflowPreservationCase["targets"][number]["properties"][number];
  onRenew: () => void;
  onLift: () => void;
  canManage: boolean;
}) {
  const days = daysUntil(property.expiryDate);
  const expiry = classifyExpiry(days);
  const statusColor = PRES_STATUS_COLOR[property.status] ?? PRES_STATUS_COLOR.ACTIVE;
  const isActive = property.status === "ACTIVE" || property.status === "RENEWED";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--bd-hair)] bg-[var(--bg-hover)] px-2.5 py-2 text-[11.5px]">
      <span className="font-medium">{PROPERTY_TYPE_CN[property.propertyType]}</span>
      {property.amount && (
        <span className="font-mono text-muted-foreground tabular">
          {formatCurrency(Number(property.amount), { compact: true })}
        </span>
      )}
      {property.propertyDetail && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{property.propertyDetail}</span>
      )}
      <span
        className={cn(
          "ml-auto shrink-0 font-medium",
          expiry.tone === "danger" && "text-[var(--red)]",
          expiry.tone === "warn" && "text-[var(--amber)]",
          expiry.tone === "ok" && "text-[var(--green)]"
        )}
      >
        {expiry.label}
      </span>
      <span
        className="shrink-0 rounded border px-1.5 py-0 text-[9px]"
        style={{
          borderColor: statusColor.border,
          color: statusColor.text,
          backgroundColor: statusColor.bg
        }}
      >
        {PRES_STATUS_CN[property.status]}
      </span>
      {canManage && isActive && (
        <>
          <button type="button" onClick={onRenew} className="shrink-0 text-primary hover:underline">
            续保
          </button>
          <button type="button" onClick={onLift} className="shrink-0 text-muted-foreground hover:text-foreground">
            解除
          </button>
        </>
      )}
    </div>
  );
}

function StageMaterialsPanel({
  matterId,
  procedure,
  stage,
  documents,
  canManage,
  onOpenTemplate,
  uploadSignal = 0
}: {
  matterId: string;
  procedure: WorkflowProcedure;
  stage: WorkflowStage;
  documents: WorkflowDocument[];
  canManage: boolean;
  /** v1.1 UI（方案 D）：模板生成收口到材料区的单一入口 */
  onOpenTemplate?: () => void;
  /** 页头「上传材料」递增信号：打开本环节上传弹窗 */
  uploadSignal?: number;
}) {
  const router = useRouter();
  const stageName = stage.name;
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [customName, setCustomName] = useState("");
  const [sourceParty, setSourceParty] = useState("");
  const [sourceOrigin, setSourceOrigin] = useState<DocumentSourceOrigin | "">("");
  const [originFilter, setOriginFilter] = useState<DocumentSourceOrigin | "ALL">("ALL");
  const [category, setCategory] = useState<DocumentCategory>(defaultCategoryForStage(stageName));
  const [isPending, startTransition] = useTransition();
  const stageTag = stageMaterialTag(stageName);
  const sourceOptions = useMemo(() => buildSourceOptions(procedure), [procedure]);

  function openUploadDialog() {
    setCategory(defaultCategoryForStage(stageName));
    setSourceParty("");
    setSourceOrigin("");
    setPicked(null);
    setCustomName("");
    if (fileRef.current) fileRef.current.value = "";
    setOpen(true);
  }

  function submitUpload() {
    if (!picked) {
      toast.warning("请先选择文件");
      return;
    }
    startTransition(async () => {
      try {
        // v0.48: 材料按外键归属环节；虚拟环节先物化拿到真实 stageId
        let stageId = stage.id;
        if (!stageId) {
          const ensured = await ensureProcedureStage({
            procedureId: procedure.id,
            name: stageName,
            description: "",
            insertPosition: "END"
          });
          stageId = ensured.id;
        }
        const fd = new FormData();
        fd.set("matterId", matterId);
        fd.set("procedureId", procedure.id);
        fd.set("stageId", stageId);
        fd.set("file", picked);
        fd.set("category", category);
        fd.set("name", customName.trim() || picked.name);
        fd.set("tags", stageTag);
        if (SOURCE_MATERIAL_CATEGORIES.includes(category) && sourceParty) {
          fd.set("sourceParty", sourceParty);
        }
        if (sourceOrigin) fd.set("sourceOrigin", sourceOrigin);
        await uploadDocument(fd);
        toast.success("阶段材料已上传");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error("上传失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (uploadSignal > 0 && canManage) openUploadDialog(); }, [uploadSignal]);

  const originCounts = documents.reduce<Partial<Record<DocumentSourceOrigin, number>>>((acc, d) => {
    if (d.sourceOrigin) acc[d.sourceOrigin] = (acc[d.sourceOrigin] ?? 0) + 1;
    return acc;
  }, {});
  const shownDocs = originFilter === "ALL" ? documents : documents.filter((d) => d.sourceOrigin === originFilter);

  return (
    <div className="card">
      <div className="panel-head flex-wrap">
        <div className="panel-title">
          <FileText className="ic" strokeWidth={1.8} />
          阶段材料
          <span className="badge b-white" style={{ marginLeft: 2 }}>{documents.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          {(Object.keys(originCounts) as DocumentSourceOrigin[]).map((origin, i) => (
            <button
              key={origin}
              type="button"
              onClick={() => setOriginFilter((v) => (v === origin ? "ALL" : origin))}
              className={cn("src-chip cursor-pointer", originFilter === origin && documentSourceChip[origin].kind !== "team" && documentSourceChip[origin].kind)}
              aria-pressed={originFilter === origin}
            >
              {i === 0 ? "来源：" : ""}
              <b style={{ fontWeight: i === 0 ? 600 : 550 }}>{documentSourceChip[origin].label} {originCounts[origin]}</b>
            </button>
          ))}
          {canManage && onOpenTemplate ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTemplate}>
              <Sparkles />
              从模板生成
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={openUploadDialog}>
              <Upload />
              上传材料
            </button>
          ) : null}
        </div>
      </div>

      {shownDocs.length === 0 ? (
        <EmptyState compact icon={FileText} title="暂无该阶段材料" description={`上传后自动归入本环节（${stageTag}），并记录来源与校验值。`} />
      ) : (
        shownDocs.map((doc) => <DocRow key={doc.id} doc={doc} />)
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>上传阶段材料 · {stageName}</DialogTitle>
            <DialogDescription className="text-xs">
              文件将关联到当前程序，并自动归入 {stageTag}。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">材料类别 *</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}>
                <SelectTrigger className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORY_OPTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {documentCategoryLabel[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">材料来源</Label>
              <Select value={sourceOrigin || "__none__"} onValueChange={(value) => setSourceOrigin(value === "__none__" ? "" : (value as DocumentSourceOrigin))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择材料来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不标注</SelectItem>
                  {(Object.keys(documentSourceChip) as DocumentSourceOrigin[]).map((origin) => (
                    <SelectItem key={origin} value={origin}>
                      {documentSourceChip[origin].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {SOURCE_MATERIAL_CATEGORIES.includes(category) && sourceOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">归属/来源（可选）</Label>
                <Select
                  value={sourceParty || "__none__"}
                  onValueChange={(value) => setSourceParty(value === "__none__" ? "" : value)}
                >
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="选择归属/来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不标注</SelectItem>
                    {sourceOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">文件 *</Label>
              <Input
                ref={fileRef}
                type="file"
                onChange={(event) => setPicked(event.target.files?.[0] ?? null)}
              />
              {picked && (
                <p className="text-[10px] text-muted-foreground">
                  已选 {picked.name}（{(picked.size / 1024).toFixed(0)} KB）
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">显示名（可选）</Label>
              <Input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder={`${stageName}材料`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              取消
            </Button>
            <Button onClick={submitUpload} disabled={isPending || !picked} className="gap-1.5">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskQuickDialog({
  open,
  onOpenChange,
  matterId,
  procedureId,
  stage,
  users,
  onStageReady
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  procedureId: string;
  stage: WorkflowStage;
  users: UserOption[];
  onStageReady: (stageId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState(0);

  function submit() {
    if (!title.trim()) {
      toast.warning("请填写任务标题");
      return;
    }
    startTransition(async () => {
      try {
        let stageId = stage.id;
        if (!stageId) {
          const ensured = await ensureProcedureStage({
            procedureId,
            name: stage.name,
            description: "",
            insertPosition: "END"
          });
          stageId = ensured.id;
          onStageReady(stageId);
        }
        await createTask({
          matterId,
          title: title.trim(),
          description,
          dueAt: dueAt ? new Date(dueAt) : undefined,
          priority,
          assigneeId,
          stageId
        });
        toast.success("任务已添加");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("添加失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加任务 · {stage.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">任务标题 *</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="如：准备财产线索 / 提交续封申请"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">截止日期</Label>
              <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">优先级</Label>
              <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">普通</SelectItem>
                  <SelectItem value="1">高</SelectItem>
                  <SelectItem value="2">紧急</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">指派给</Label>
            <Select value={assigneeId || "__none__"} onValueChange={(v) => setAssigneeId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="暂不指派" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">暂不指派</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">说明</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={submit} disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StageCreateDialog({
  open,
  onOpenChange,
  procedureId,
  procedureType,
  stages,
  selectedItem,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procedureId: string;
  procedureType: ProcedureType;
  stages: WorkflowStage[];
  selectedItem: WorkflowItem | null;
  onCreated: (stageId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [presetName, setPresetName] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [description, setDescription] = useState("");
  const [insertTarget, setInsertTarget] = useState("END");
  const existingNameSet = useMemo(
    () => new Set(stages.map((item) => normalizeProcedureStageName(item.name))),
    [stages]
  );
  const availablePresets = useMemo(
    () =>
      procedureStagePresetsForProcedure(procedureType).filter(
        (preset) => !existingNameSet.has(normalizeProcedureStageName(preset.name))
      ),
    [existingNameSet, procedureType]
  );
  const selectedPreset = availablePresets.find((preset) => preset.name === presetName) ?? null;
  const stageName = customMode ? customName.trim() : selectedPreset?.name ?? "";
  const duplicate = stageName ? existingNameSet.has(normalizeProcedureStageName(stageName)) : false;

  useEffect(() => {
    if (open) {
      const firstPreset = availablePresets[0];
      setPresetName(firstPreset?.name ?? "");
      setCustomMode(!firstPreset);
      setCustomName("");
      setDescription("");
      setInsertTarget(defaultInsertTarget(selectedItem));
    }
  }, [availablePresets, open, selectedItem]);

  function submit() {
    if (!stageName) {
      toast.warning("请填写环节名称");
      return;
    }
    if (duplicate) {
      toast.warning("该环节已在列表中");
      return;
    }
    startTransition(async () => {
      try {
        const insert = parseInsertTarget(insertTarget, stages);
        const created = await createProcedureStage({
          procedureId,
          name: stageName,
          description: customMode ? description : description || selectedPreset?.description || "",
          insertPosition: insert.position,
          insertAfterStageId: insert.afterStageId,
          insertAfterStageName: insert.afterStageName
        });
        toast.success("环节已添加");
        onCreated(created.id);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("添加失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加环节</DialogTitle>
          <DialogDescription className="text-xs">
            优先选择预设环节；确实覆盖不到时再使用自定义。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!customMode ? (
            <div className="space-y-1.5">
              <Label className="text-xs">预设环节 *</Label>
              {availablePresets.length > 0 ? (
                <Select value={presetName} onValueChange={setPresetName}>
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="选择预设环节" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePresets.map((preset) => (
                      <SelectItem key={preset.name} value={preset.name}>
                        {preset.name} · {preset.kind === "required" ? "必备" : "可选"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  预设环节已全部加入当前程序。
                </p>
              )}
              {selectedPreset && (
                <p className="text-[10.5px] leading-5 text-muted-foreground">{selectedPreset.description}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">自定义环节名称 *</Label>
              <Input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="如：二次庭询 / 专家论证 / 履行谈判"
              />
              {duplicate && <p className="text-[10px] text-[var(--amber)]">该环节已在列表中</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">插入位置</Label>
            <Select value={insertTarget} onValueChange={setInsertTarget}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="START">放在最前</SelectItem>
                <SelectItem value="END">放在最后</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.key} value={stage.id ? `AFTER_ID:${stage.id}` : `AFTER_NAME:${stage.name}`}>
                    放在「{stage.name}」之后
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">说明（可选）</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={customMode ? "记录该环节的目标或注意事项" : selectedPreset?.description ?? ""}
            />
          </div>
          <button
            type="button"
            onClick={() => setCustomMode((value) => !value)}
            className="text-[11px] text-primary hover:underline"
          >
            {customMode ? "返回预设环节" : "预设没有覆盖，添加自定义环节"}
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || duplicate || !stageName}
            className="gap-1.5"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultInsertTarget(selectedItem: WorkflowItem | null) {
  if (!selectedItem || selectedItem.kind === "matter_info") return "START";
  return selectedItem.id ? `AFTER_ID:${selectedItem.id}` : `AFTER_NAME:${selectedItem.name}`;
}

function parseInsertTarget(target: string, stages: WorkflowStage[]) {
  if (target === "START") {
    return { position: "START" as const, afterStageId: "", afterStageName: "" };
  }
  if (target.startsWith("AFTER_ID:")) {
    return {
      position: "AFTER" as const,
      afterStageId: target.slice("AFTER_ID:".length),
      afterStageName: ""
    };
  }
  if (target.startsWith("AFTER_NAME:")) {
    const name = target.slice("AFTER_NAME:".length);
    return {
      position: "AFTER" as const,
      afterStageId: "",
      afterStageName: stages.find((stage) => stage.name === name)?.name ?? name
    };
  }
  return { position: "END" as const, afterStageId: "", afterStageName: "" };
}

function buildWorkflowStages(
  procedure: WorkflowProcedure | null,
  preservationCases: WorkflowPreservationCase[]
): WorkflowStage[] {
  if (!procedure) return [];
  // v0.48: HIDDEN 环节不进工作台（数据保留，可重新添加恢复）
  const visibleStages = procedure.stages.filter((stage) => stage.status !== "HIDDEN");
  const context = { procedure, preservationCases };
  const realStages: WorkflowStage[] = visibleStages.map((stage) => ({
    ...workflowStageFromName(
      procedure.type,
      stage.name,
      {
        key: `stage-${stage.id}`,
        id: stage.id,
        status: statusForStage(stage.name, stage, procedure, preservationCases),
        tasks: stage.tasks
      },
      context
    )
  }));

  const source = realStages.length > 0
    ? realStages
    : defaultStageNamesForProcedure(procedure.type).map((name, index) => ({
        ...workflowStageFromName(
          procedure.type,
          name,
          {
            key: `default-${index}-${name}`,
            id: null,
            status: statusForStage(name, null, procedure, preservationCases),
            tasks: []
          },
          context
        )
      }));

  // 已有保全记录时必须能在工作台看到"财产保全"环节——即使真实环节已物化且未包含它，
  // 否则物化必备环节后保全数据会从案件详情页消失
  if (
    preservationCases.length > 0 &&
    !source.some((stage) => stage.name.includes("保全"))
  ) {
    const insertAt = Math.min(2, source.length);
    const preservationStage = workflowStageFromName(
      procedure.type,
      "财产保全",
      {
        key: "default-preservation",
        id: null,
        status: statusForStage("财产保全", null, procedure, preservationCases),
        tasks: []
      },
      context
    );
    return [...source.slice(0, insertAt), preservationStage, ...source.slice(insertAt)];
  }
  return source;
}

function workflowStageFromName(
  procedureType: ProcedureType,
  name: string,
  meta: Pick<WorkflowStage, "key" | "id" | "status" | "tasks">,
  context?: { procedure: WorkflowProcedure; preservationCases: WorkflowPreservationCase[] }
): WorkflowStage {
  const preset = stagePresetForName(procedureType, name);
  const presetKind = preset?.kind ?? "custom";
  const kind: WorkflowStage["kind"] = name.includes("保全") ? "preservation" : "normal";
  return {
    ...meta,
    name,
    kind,
    presetKind,
    removable: presetKind !== "required",
    badge: context ? stageBadge(name, kind, meta.tasks, context) : null
  };
}

function shortDay(date: Date): string {
  const d = new Date(date);
  return `${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** 导航徽标：临期期限（含任务数）> 未完成任务数 > 开庭日期，无则不显示 */
function stageBadge(
  name: string,
  kind: WorkflowStage["kind"],
  tasks: WorkflowTask[],
  context: { procedure: WorkflowProcedure; preservationCases: WorkflowPreservationCase[] }
): WorkflowStage["badge"] {
  if (kind === "preservation") {
    const properties = context.preservationCases.flatMap((c) =>
      c.targets.flatMap((t) => t.properties)
    );
    const active = properties.filter((p) => p.status === "ACTIVE" || p.status === "RENEWED");
    if (active.length === 0) return null;
    const nearest = Math.min(...active.map((p) => daysUntil(p.expiryDate)));
    return nearest <= 30
      ? { text: `${active.length} · ${nearest}d`, hot: true }
      : { text: `${active.length} 项`, hot: false };
  }

  const openTasks = tasks.filter((t) => !t.completed).length;
  const guide = stageGuideFor(name);
  const relevantDue = context.procedure.deadlines
    .filter((d) => !d.completed && guide.deadlineCategories.includes(d.category))
    .map((d) => daysUntil(d.dueAt));
  const nearestDue = relevantDue.length > 0 ? Math.min(...relevantDue) : null;

  if (nearestDue !== null && nearestDue <= 30) {
    return {
      text: openTasks > 0 ? `${openTasks} · ${nearestDue}d` : `${nearestDue}d`,
      hot: true
    };
  }
  if (openTasks > 0) return { text: `${openTasks}`, hot: false };
  if (guide.includeHearings) {
    const nextHearing = context.procedure.hearings
      .filter((h) => daysUntil(h.startsAt) >= 0)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
    if (nextHearing) return { text: shortDay(nextHearing.startsAt), hot: false };
  }
  return null;
}

function statusForStage(
  name: string,
  stage: WorkflowStageSource | null,
  procedure: WorkflowProcedure,
  preservationCases: WorkflowPreservationCase[]
): WorkflowStageStatus {
  if (name.includes("保全")) {
    const properties = preservationCases.flatMap((item) => item.targets.flatMap((target) => target.properties));
    const active = properties.filter((property) => property.status === "ACTIVE" || property.status === "RENEWED");
    if (active.some((property) => daysUntil(property.expiryDate) <= 30)) return "risk";
    if (active.length > 0) return "active";
    if (properties.length > 0) return "done";
    return "todo";
  }
  if (stage?.completedAt) return "done";
  const tasks = stage?.tasks ?? [];
  if (tasks.some((task) => !task.completed && task.dueAt && daysUntil(task.dueAt) <= 3)) return "risk";
  if (tasks.length > 0 && tasks.every((task) => task.completed)) return "done";
  if (tasks.some((task) => !task.completed)) return "active";
  if ((name.includes("立案") || name.includes("起诉")) && procedure.acceptedAt) return "done";
  if (name.includes("开庭") && procedure.hearings.some((hearing) => daysUntil(hearing.startsAt) >= 0)) return "active";
  if (
    name.includes("举证") &&
    procedure.deadlines.some((deadline) => deadline.category === "EVIDENCE" && !deadline.completed && daysUntil(deadline.dueAt) <= 7)
  ) {
    return "risk";
  }
  if (
    procedure.status === "CONCLUDED" &&
    (name.includes("裁判") || name.includes("裁决") || name.includes("结案"))
  ) {
    return "done";
  }
  return "todo";
}





function stageGuideFor(stageName: string) {
  return STAGE_GUIDES.find((item) => item.keys.some((key) => stageName.includes(key)))?.guide ??
    DEFAULT_STAGE_GUIDE;
}

function stageMaterialTag(stageName: string) {
  return `阶段:${stageName}`;
}

function documentMatchesStage(
  document: WorkflowDocument,
  stage: { id: string | null; name: string }
) {
  // v0.48: 外键归属优先——已明确归属某环节的材料不再按模式匹配到其他环节
  if (document.stageId) return stage.id !== null && document.stageId === stage.id;
  if (document.tags?.includes(stageMaterialTag(stage.name))) return true;
  const guide = stageGuideFor(stage.name);
  return guide.materialCategories.includes(document.category) || guide.materialPattern.test(document.name);
}

function defaultCategoryForStage(stageName: string): DocumentCategory {
  return stageGuideFor(stageName).defaultCategory;
}

function buildSourceOptions(procedure: WorkflowProcedure) {
  const seen = new Set<string>([COURT_PROCEDURE_SOURCE]);
  const partyOptions = [...procedure.procedureParties]
    .sort((a, b) => a.ordinal - b.ordinal || a.party.name.localeCompare(b.party.name, "zh-Hans-CN"))
    .map((row) => {
      const name = row.party.name.trim();
      if (!name) return null;
      return `${litigationStandingLabel[row.standing] ?? row.standing}·${name}`;
    })
    .filter((label): label is string => {
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  return [COURT_PROCEDURE_SOURCE, ...partyOptions];
}

function documentPreviewUrl(document: Pick<WorkflowDocument, "id" | "mimeType" | "name">) {
  if (officePreviewKind(document.mimeType, document.name)) {
    return `/api/documents/${document.id}/preview`;
  }
  if (canPreview(document.mimeType, document.name)) {
    return `/api/documents/${document.id}/download?inline=1`;
  }
  return null;
}


const documentCategoryLabel: Record<DocumentCategory, string> = {
  EVIDENCE: "证据",
  PLEADING: "诉辩文件",
  PROCEDURE: "程序文件",
  JUDGMENT: "裁决",
  CONTRACT: "合同",
  OTHER: "其他"
};
