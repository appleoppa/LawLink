"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  Eye,
  FileText,
  Gavel,
  Landmark,
  ListChecks,
  Loader2,
  Minus,
  Plus,
  Scale,
  Shield,
  Sparkles,
  Upload
} from "lucide-react";
import type {
  DeadlineCategory,
  DocumentCategory,
  GuaranteeType,
  LitigationStanding,
  PreservationStatus,
  PreservationType,
  ProcedureType
} from "@prisma/client";
import { Badge } from "@/components/ui/badge";
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
import { createTask } from "@/server/tasks/actions";
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
import type { FolderPayload, TemplateSummary } from "./folder-types";

type WorkflowTask = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  completed: boolean;
  completedAt: Date | null;
  priority: number;
  stageId: string | null;
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

export function ProcedureWorkflowPanel({
  matter,
  procedure,
  documents,
  preservationCases,
  folders,
  templates,
  users,
  canManage,
  matterInfoNode
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
}) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [taskStage, setTaskStage] = useState<WorkflowStage | null>(null);
  const [stageCreateOpen, setStageCreateOpen] = useState(false);
  const [, startStageRemovalTransition] = useTransition();

  const stages = useMemo(
    () => buildWorkflowStages(procedure, preservationCases),
    [procedure, preservationCases]
  );
  const workflowItems: WorkflowItem[] = matterInfoNode ? [MATTER_INFO_ITEM, ...stages] : stages;
  const defaultKey = workflowItems[0]?.key ?? null;
  const selectedItem =
    workflowItems.find((item) => item.key === selectedKey) ??
    workflowItems.find((item) => item.key === defaultKey) ??
    null;
  const doneCount = stages.filter((s) => s.status === "done").length;

  function handleRemoveStage(stage: WorkflowStage) {
    const stageId = stage.id;
    if (!stageId) {
      toast.info("该环节尚未写入流程，无需移除");
      return;
    }
    if (!stage.removable) {
      toast.warning("必备环节不能移除");
      return;
    }
    if (!confirm(`确定从当前程序移除「${stage.name}」？已有任务或材料的环节将被隐藏（数据保留，可重新添加恢复）。`)) return;
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

  if (!procedure) {
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-low)]">
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <h2 className="text-[14px] font-medium">案件工作台</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            添加程序后可继续生成办案环节。
          </p>
        </header>
        <div className="space-y-3 p-4">
          {matterInfoNode}
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            暂无在办程序，添加程序后可生成程序工作台。
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-low)]">
      <div className="grid grid-cols-1 md:grid-cols-[168px_minmax(0,1fr)]">
        <nav className="border-b border-border bg-muted/35 p-1.5 md:border-b-0 md:border-r">
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1 text-[10.5px] text-muted-foreground">
            <span>环节进度</span>
            <span className="font-mono tabular">
              {doneCount}/{stages.length}
            </span>
          </div>
          <div className="space-y-1">
            {workflowItems.map((stage) => (
              <button
                key={stage.key}
                type="button"
                onClick={() => setSelectedKey(stage.key)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-[12.5px] transition-colors",
                  selectedItem?.key === stage.key
                    ? "bg-background text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                )}
              >
                {stage.kind === "matter_info" ? (
                  <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
                ) : (
                  <StageStatusIcon status={stage.status} />
                )}
                <span className="min-w-0 flex-1 truncate">{stage.name}</span>
                {stage.kind === "preservation" && (
                  <Shield className="h-3 w-3 shrink-0 text-primary" />
                )}
                {stage.kind !== "matter_info" && stage.badge && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 font-mono text-[10px] leading-[16px] tabular",
                      stage.badge.hot
                        ? "bg-amber-500/15 font-semibold text-amber-700"
                        : "bg-primary/10 text-muted-foreground"
                    )}
                  >
                    {stage.badge.text}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-1.5 border-t border-border/70 pt-1.5">
            <button
              type="button"
              onClick={() => setStageCreateOpen(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                <Plus className="h-2.5 w-2.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">添加环节</span>
            </button>
          </div>
        </nav>

        <div className="min-w-0 p-4">
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
              onRemoveStage={
                canManage && selectedItem.removable ? () => handleRemoveStage(selectedItem) : undefined
              }
            />
          ) : selectedItem ? (
            <NormalStageContent
              matterId={matter.id}
              stage={selectedItem}
              procedure={procedure}
              documents={documents}
              onOpenTemplate={() => setTemplateOpen(true)}
              onAddTask={() => setTaskStage(selectedItem)}
              onRemoveStage={
                canManage && selectedItem.removable ? () => handleRemoveStage(selectedItem) : undefined
              }
              canManage={canManage}
            />
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无工作环节</p>
          )}
        </div>
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
    </section>
  );
}

function NormalStageContent({
  matterId,
  stage,
  procedure,
  documents,
  onOpenTemplate,
  onAddTask,
  onRemoveStage,
  canManage
}: {
  matterId: string;
  stage: WorkflowStage;
  procedure: WorkflowProcedure;
  documents: WorkflowDocument[];
  onOpenTemplate: () => void;
  onAddTask: () => void;
  onRemoveStage?: () => void;
  canManage: boolean;
}) {
  // v1.1 UI（方案 C/D）：本案数据（记录+材料）置顶，指导文字收折到底部
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const guide = stageGuideFor(stage.name);
  const relevantDeadlines = guide.deadlineCategories.length > 0
    ? procedure.deadlines
        .filter((d) => guide.deadlineCategories.includes(d.category))
        .slice(0, 4)
    : [];
  const relevantDocs = documents.filter((d) => documentMatchesStage(d, stage));
  const stageHearings = guide.includeHearings ? procedure.hearings.slice(0, 3) : [];
  const recordCount = stage.tasks.length + relevantDeadlines.length + stageHearings.length;
  const nearestDue = relevantDeadlines
    .filter((d) => !d.completed)
    .map((d) => daysUntil(d.dueAt))
    .sort((a, b) => a - b)[0];

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StageStatusIcon status={stage.status} large />
          <h3 className="text-[15px] font-medium">{stage.name}</h3>
          {nearestDue !== undefined && nearestDue <= 30 ? (
            <Badge
              variant="outline"
              className={cn(
                "font-mono tabular",
                nearestDue <= 7
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700"
              )}
            >
              {nearestDue < 0 ? `逾期 ${-nearestDue} 天` : nearestDue === 0 ? "今天到期" : `剩 ${nearestDue} 天`}
            </Badge>
          ) : (
            <StageStatusBadge status={stage.status} />
          )}
        </div>
        {onRemoveStage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemoveStage}
            className="h-7 px-2 text-[11px] text-muted-foreground"
          >
            移除
          </Button>
        )}
      </div>

      <section className="rounded-md border border-border bg-background/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle icon={<CalendarClock className="h-3.5 w-3.5" />}>
            本环节记录
            {recordCount > 0 && (
              <span className="ml-1 font-mono text-[10.5px] text-muted-foreground tabular">
                {recordCount}
              </span>
            )}
          </SectionTitle>
          {canManage && recordCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={onAddTask} className="h-7 gap-1 px-2 text-[11px]">
                <Plus className="h-3 w-3" />
                任务
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeadlineOpen(true)}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Scale className="h-3 w-3" />
                法定期限
              </Button>
            </div>
          )}
        </div>
        {recordCount === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-5">
            <p className="text-xs text-muted-foreground">本环节还没有任务或时间记录</p>
            {canManage && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={onAddTask} className="h-7 gap-1 px-2.5 text-[11px]">
                  <Plus className="h-3 w-3" />
                  添加任务
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeadlineOpen(true)}
                  className="h-7 gap-1 px-2.5 text-[11px]"
                >
                  <Scale className="h-3 w-3" />
                  按法定期限生成
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {relevantDeadlines.map((deadline) => (
              <DeadlineMiniRow key={deadline.id} deadline={deadline} />
            ))}
            {stage.tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-2 py-2 text-xs">
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    task.completed
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input"
                  )}
                >
                  {task.completed && <Check className="h-2.5 w-2.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate font-medium", task.completed && "text-muted-foreground line-through")}>
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[10.5px] text-muted-foreground">
                    {task.dueAt && <span>{formatDate(task.dueAt)}</span>}
                    {task.priority > 0 && <span>{task.priority === 2 ? "紧急" : "高优先级"}</span>}
                  </div>
                </div>
              </li>
            ))}
            {stageHearings.map((hearing) => (
              <li key={hearing.id} className="flex items-center gap-2 py-2 text-xs">
                <Gavel className="h-3.5 w-3.5 text-primary" />
                <span className="min-w-0 flex-1 truncate">{hearing.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  {formatDate(hearing.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StageMaterialsPanel
        matterId={matterId}
        procedure={procedure}
        stage={stage}
        documents={relevantDocs}
        canManage={canManage}
        onOpenTemplate={onOpenTemplate}
      />

      <StageGuideDisclosure guide={guide} />

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
    </div>
  );
}

/** v1.1 UI（方案 D）：办案指引默认折叠——指导性内容对熟手是噪音，收成一行 */
function StageGuideDisclosure({ guide }: { guide: StageGuide }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-dashed border-border/80 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="font-medium text-foreground/75">办案指引</span>
        {!open && <span className="min-w-0 flex-1 truncate">{guide.summary}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-4">
          <ul className="space-y-1.5">
            {guide.checklist.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs leading-5">
                <Circle className="mt-[6px] h-2 w-2 shrink-0 fill-primary/70 text-primary/70" />
                <span className="text-foreground/85">{item}</span>
              </li>
            ))}
          </ul>
          {guide.actions.length > 0 && (
            <p className="text-[11px] leading-5 text-muted-foreground">
              常用文书：{guide.actions.join("、")}（在「模板」弹窗内选用）
            </p>
          )}
        </div>
      )}
    </section>
  );
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
  onRemoveStage
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="text-[15px] font-medium">财产保全</h3>
            {expiringCount > 0 ? (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700">
                30天内到期 {expiringCount} 项
              </Badge>
            ) : (
              <Badge variant="outline">专项工作包</Badge>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            申请、担保、裁定、续封和解除统一归到当前程序。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRemoveStage && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRemoveStage}
              className="h-7 px-2 text-[11px] text-muted-foreground"
            >
              移除
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={onAddTask} className="h-7 gap-1 px-2 text-[11px]">
                <Plus className="h-3 w-3" />
                任务
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="h-7 gap-1 px-2 text-[11px]">
                <Plus className="h-3 w-3" />
                新建保全
              </Button>
            </>
          )}
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background/60 px-4 py-8 text-center">
          <Shield className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">该程序尚无财产保全记录</p>
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-3 h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              新建保全
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {cases.map((item) => (
            <div key={item.id} className="rounded-md border border-border bg-background/60">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2">
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

      <StageMaterialsPanel
        matterId={matter.id}
        procedure={procedure}
        stage={stage}
        documents={relevantDocs}
        canManage={canManage}
        onOpenTemplate={onOpenTemplate}
      />

      <StageGuideDisclosure guide={stageGuideFor("财产保全")} />

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
    </div>
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
    <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card px-2.5 py-2 text-[11px]">
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
          expiry.tone === "danger" && "text-destructive",
          expiry.tone === "warn" && "text-amber-600",
          expiry.tone === "ok" && "text-emerald-700"
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
  onOpenTemplate
}: {
  matterId: string;
  procedure: WorkflowProcedure;
  stage: WorkflowStage;
  documents: WorkflowDocument[];
  canManage: boolean;
  /** v1.1 UI（方案 D）：模板生成收口到材料区的单一入口 */
  onOpenTemplate?: () => void;
}) {
  const router = useRouter();
  const stageName = stage.name;
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [customName, setCustomName] = useState("");
  const [sourceParty, setSourceParty] = useState("");
  const [category, setCategory] = useState<DocumentCategory>(defaultCategoryForStage(stageName));
  const [isPending, startTransition] = useTransition();
  const stageTag = stageMaterialTag(stageName);
  const sourceOptions = useMemo(() => buildSourceOptions(procedure), [procedure]);

  function openUploadDialog() {
    setCategory(defaultCategoryForStage(stageName));
    setSourceParty("");
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
        await uploadDocument(fd);
        toast.success("阶段材料已上传");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error("上传失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <section className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<FileText className="h-3.5 w-3.5" />}>
          阶段材料
          <span className="ml-1 font-mono text-[10.5px] text-muted-foreground tabular">
            {documents.length}
          </span>
        </SectionTitle>
        {canManage && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={openUploadDialog}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Upload className="h-3 w-3" />
              上传
            </Button>
            {onOpenTemplate && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenTemplate}
                className="h-7 gap-1 px-2 text-[11px] text-primary hover:text-primary"
              >
                <Sparkles className="h-3 w-3" />
                从模板生成
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-[10.5px] text-muted-foreground">
        上传后仍写入本程序材料数据，并自动标记为 {stageTag}。
      </p>

      {documents.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border bg-card/60 px-3 py-5 text-center">
          <p className="text-xs text-muted-foreground">暂无该阶段材料</p>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={openUploadDialog}
              className="mt-3 h-7 gap-1 px-2 text-[11px]"
            >
              <Upload className="h-3 w-3" />
              上传材料
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-1.5 xl:grid-cols-2">
          {documents.map((doc) => {
            const icon = iconForDocument(doc);
            const pUrl = documentPreviewUrl(doc);
            return (
              <li key={doc.id} className="group flex min-w-0 items-center gap-2 rounded border border-border bg-card px-2.5 py-2">
                <Image src={icon.src} alt={icon.alt} width={20} height={20} className="h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  {pUrl ? (
                    <a
                      href={pUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs hover:text-primary hover:underline"
                    >
                      {doc.name}
                    </a>
                  ) : (
                    <span className="block truncate text-xs">{doc.name}</span>
                  )}
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {documentCategoryLabel[doc.category]} · {formatDate(doc.createdAt)}
                    {doc.sourceParty ? ` · ${doc.sourceParty}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {pUrl && (
                    <a
                      href={pUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-muted-foreground hover:text-primary"
                      title="预览"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-muted-foreground hover:text-primary"
                    title="下载"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
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
    </section>
  );
}

function TaskQuickDialog({
  open,
  onOpenChange,
  matterId,
  procedureId,
  stage,
  onStageReady
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  procedureId: string;
  stage: WorkflowStage;
  onStageReady: (stageId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");

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
          priority: 0,
          assigneeId: "",
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
          <div className="space-y-1.5">
            <Label className="text-xs">截止日期</Label>
            <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
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
              {duplicate && <p className="text-[10px] text-amber-600">该环节已在列表中</p>}
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

function StageStatusIcon({ status, large = false }: { status: WorkflowStageStatus; large?: boolean }) {
  const sizeClass = large ? "h-5 w-5" : "h-4 w-4";
  if (status === "done") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground", sizeClass)}>
        <Check className={large ? "h-3 w-3" : "h-2.5 w-2.5"} />
      </span>
    );
  }
  if (status === "risk") return <AlertTriangle className={cn("shrink-0 text-amber-600", sizeClass)} />;
  if (status === "active") return <Circle className={cn("shrink-0 fill-primary text-primary", sizeClass)} />;
  if (status === "not_applicable") return <Minus className={cn("shrink-0 text-muted-foreground", sizeClass)} />;
  return <Circle className={cn("shrink-0 text-muted-foreground/50", sizeClass)} />;
}

function StageStatusBadge({ status }: { status: WorkflowStageStatus }) {
  const map: Record<WorkflowStageStatus, { label: string; className: string }> = {
    done: { label: "已完成", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" },
    active: { label: "进行中", className: "border-primary/30 bg-primary/10 text-primary" },
    risk: { label: "临期/风险", className: "border-amber-500/30 bg-amber-500/10 text-amber-700" },
    todo: { label: "待处理", className: "border-border bg-muted/40 text-muted-foreground" },
    not_applicable: { label: "不适用", className: "border-border bg-muted/40 text-muted-foreground" }
  };
  const item = map[status];
  return <Badge variant="outline" className={item.className}>{item.label}</Badge>;
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {children}
    </h4>
  );
}

function DeadlineMiniRow({ deadline }: { deadline: WorkflowDeadline }) {
  const days = daysUntil(deadline.dueAt);
  const tone = !deadline.completed && days <= deadline.remindDays
    ? days <= 3 ? "danger" : "warn"
    : undefined;
  return (
    <li className="flex items-center gap-2 py-2 text-xs">
      <CalendarClock
        className={cn(
          "h-3.5 w-3.5",
          tone === "danger" && "text-destructive",
          tone === "warn" && "text-amber-600",
          !tone && "text-primary"
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", deadline.completed && "text-muted-foreground line-through")}>
        {deadline.title}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
        {deadline.completed ? "已完成" : days < 0 ? `逾期 ${Math.abs(days)}d` : `${days}d`}
      </span>
    </li>
  );
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

function iconForDocument(document: Pick<WorkflowDocument, "mimeType" | "name">) {
  const mime = document.mimeType?.toLowerCase() ?? "";
  const ext = document.name.split(".").pop()?.toLowerCase() ?? "";

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) {
    return { src: "/file-icons/image.svg", alt: "图片文件" };
  }
  if (mime.includes("pdf") || ext === "pdf") {
    return { src: "/file-icons/pdf.svg", alt: "PDF 文件" };
  }
  if (mime.includes("word") || mime.includes("msword") || ["doc", "docx"].includes(ext)) {
    return { src: "/file-icons/word.svg", alt: "Word 文件" };
  }
  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xls", "xlsx", "csv"].includes(ext)) {
    return { src: "/file-icons/excel.svg", alt: "Excel 文件" };
  }
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx"].includes(ext)) {
    return { src: "/file-icons/presentation.svg", alt: "演示文稿" };
  }
  if (mime.includes("json") || ext === "json") {
    return { src: "/file-icons/json.svg", alt: "JSON 文件" };
  }
  if (
    mime.includes("xml") ||
    ["xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "java", "py", "go", "rb", "php", "sh", "yml", "yaml"].includes(ext)
  ) {
    return { src: "/file-icons/code.svg", alt: "代码文件" };
  }
  if (mime.startsWith("text/") || ["txt", "md", "rtf", "log"].includes(ext)) {
    return { src: "/file-icons/text.svg", alt: "文本文件" };
  }
  if (mime.includes("zip") || mime.includes("rar") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return { src: "/file-icons/archive.svg", alt: "压缩包" };
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac"].includes(ext)) {
    return { src: "/file-icons/audio.svg", alt: "音频文件" };
  }
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv"].includes(ext)) {
    return { src: "/file-icons/video.svg", alt: "视频文件" };
  }
  return { src: "/file-icons/generic.svg", alt: "文件" };
}

const documentCategoryLabel: Record<DocumentCategory, string> = {
  EVIDENCE: "证据",
  PLEADING: "诉辩文件",
  PROCEDURE: "程序文件",
  JUDGMENT: "裁决",
  CONTRACT: "合同",
  OTHER: "其他"
};
